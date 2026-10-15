# -*- coding: utf-8 -*-
"""NEU-DET 钢铁表面缺陷检测 — 训练脚本（YOLOv8 主模型 + RT-DETR 对比）。

在 GPU 机器上运行（推荐 AutoDL 等）。依赖 ultralytics：
    pip install ultralytics

设计目标：**无人值守** —— 训练完自动完成三件事，一次跑完即可把整个
产物目录 scp 回本地，供答辩 PPT / 前端"视觉智能体"直接使用：

  1. 解析 NEU-DET 的 VOC 格式 XML 标注，转 YOLO txt 并按 85%/15% 划分
  2. 训练 YOLOv8s（一阶段、轻量、边缘实时部署主模型）+ RT-DETR-l（Transformer SOTA 对比）
  3. 自动评测（val）：mAP50 / mAP50-95 / Precision / Recall / 推理 FPS / 参数量
  4. 自动生成检测可视化样例图（原图叠加预测框 + 置信度，每类至少 1 张）
  5. 归集 best.pt / PR 曲线 / 混淆矩阵 / 损失曲线 / 对比 JSON 到 export 目录

用法（在 GPU 机上）：
    python train_neu_det.py --data-root /path/to/NEU-DET --epochs 200 --batch 16
    # 只训 YOLOv8，跳过 RT-DETR（本地 CPU 验证流程用）：
    python train_neu_det.py --data-root /path/to/NEU-DET --skip-rtdetr --epochs 1

产物（--export 目录，默认 ./neu_det_export）：
    weights/yolov8s_best.pt      # 部署用检测器权重
    weights/rtdetr_best.pt       # 对比用权重
    samples_yolo/*.jpg           # YOLOv8 检测可视化样例
    samples_rtdetr/*.jpg         # RT-DETR 检测可视化样例
    curves_yolo/*.png / curves_rtdetr/*.png   # PR / F1 / 混淆矩阵 / 损失曲线
    comparison.json              # 双模型 mAP / FPS / 参数量 对比表
"""
from __future__ import annotations

import argparse
import json
import os
import random
import shutil
import xml.etree.ElementTree as ET
from collections import defaultdict

# 6 类缺陷，顺序固定（class id 与之一一对应）
CLASSES = ["crazing", "inclusion", "patches", "pitted_surface", "rolled-in_scale", "scratches"]


def locate_dirs(data_root: str) -> tuple[str, str]:
    """返回 (IMAGES目录, ANNOTATIONS目录)，兼容 NEU-DET/NEU-DET 嵌套结构。"""
    img = os.path.join(data_root, "IMAGES")
    ann = os.path.join(data_root, "ANNOTATIONS")
    if not (os.path.isdir(img) and os.path.isdir(ann)):
        nested = os.path.join(data_root, "NEU-DET")
        img = os.path.join(nested, "IMAGES")
        ann = os.path.join(nested, "ANNOTATIONS")
    if not (os.path.isdir(img) and os.path.isdir(ann)):
        raise SystemExit(f"未找到 IMAGES/ANNOTATIONS，请检查 --data-root={data_root}")
    return img, ann


def convert_xml(xml_path: str) -> list[str]:
    """单个 XML 转 YOLO txt 行（class cx cy w h，归一化）。"""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    size = root.find("size")
    w = float(size.find("width").text)
    h = float(size.find("height").text)
    lines = []
    for obj in root.findall("object"):
        name = obj.find("name").text
        cls = CLASSES.index(name)
        box = obj.find("bndbox")
        xmin, ymin = float(box.find("xmin").text), float(box.find("ymin").text)
        xmax, ymax = float(box.find("xmax").text), float(box.find("ymax").text)
        cx = (xmin + xmax) / 2 / w
        cy = (ymin + ymax) / 2 / h
        bw = (xmax - xmin) / w
        bh = (ymax - ymin) / h
        lines.append(f"{cls} {cx:.6f} {cy:.6f} {bw:.6f} {bh:.6f}")
    return lines


def _primary_class(xml_path: str) -> int | None:
    """返回标注文件的第一个目标类别 id（用于分层划分），无目标返回 None。"""
    tree = ET.parse(xml_path)
    root = tree.getroot()
    obj = root.find("object")
    if obj is not None:
        name = obj.find("name").text
        if name in CLASSES:
            return CLASSES.index(name)
    return None


def prep_dataset(data_root: str, out_dir: str, val_ratio: float = 0.15, seed: int = 42) -> str:
    """转换标注并按类别分层划分数据集，返回 data.yaml 路径。

    分层（stratified）划分：每类独立按 val_ratio 抽出验证集，保证 6 类缺陷在
    train / val 中都出现，评测对各类的 mAP 才完整、严谨。
    """
    img_dir, ann_dir = locate_dirs(data_root)
    # 清空旧输出目录，避免残留脏数据（重复运行 / 中途失败后重跑）
    if os.path.exists(out_dir):
        shutil.rmtree(out_dir)
    for split in ("train", "val"):
        os.makedirs(os.path.join(out_dir, "images", split), exist_ok=True)
        os.makedirs(os.path.join(out_dir, "labels", split), exist_ok=True)

    samples: list[tuple[str, str]] = []
    for f in sorted(os.listdir(img_dir)):
        if not f.lower().endswith(".jpg"):
            continue
        stem = os.path.splitext(f)[0]
        xml = os.path.join(ann_dir, stem + ".xml")
        if os.path.isfile(xml):
            samples.append((f, xml))

    # 按主类别分组，逐类分层抽验证集
    groups: dict[int, list[tuple[str, str]]] = defaultdict(list)
    for f, xml in samples:
        groups[_primary_class(xml)].append((f, xml))

    random.seed(seed)
    val_set: set[tuple[str, str]] = set()
    for _cls, items in groups.items():
        random.shuffle(items)
        n_val = max(1, int(len(items) * val_ratio))
        val_set.update(items[:n_val])

    for f, xml in samples:
        stem = os.path.splitext(f)[0]
        split = "val" if (f, xml) in val_set else "train"
        shutil.copy(os.path.join(img_dir, f), os.path.join(out_dir, "images", split, f))
        lines = convert_xml(xml)
        with open(os.path.join(out_dir, "labels", split, stem + ".txt"), "w", encoding="utf-8") as fp:
            fp.write("\n".join(lines) + "\n")

    n_val = len(val_set)
    n_train = len(samples) - n_val
    print(f"[数据集] 总 {len(samples)} 张，train {n_train} / val {n_val}（按类别分层）")

    yaml_path = os.path.join(out_dir, "data.yaml")
    with open(yaml_path, "w", encoding="utf-8") as fp:
        fp.write(f"path: {os.path.abspath(out_dir)}\n")
        fp.write("train: images/train\n")
        fp.write("val: images/val\n")
        fp.write(f"nc: {len(CLASSES)}\n")
        fp.write(f"names: {CLASSES}\n")
    return yaml_path


def collect_sample_images(out_dir: str, per_class: int = 1, max_total: int = 8) -> list[str]:
    """从 val 集挑检测样例图：每类至少 per_class 张，其余随机补足，最多 max_total 张。"""
    val_img = os.path.join(out_dir, "images", "val")
    val_lbl = os.path.join(out_dir, "labels", "val")
    class_pool: dict[int, list[str]] = {}
    others: list[str] = []
    for f in sorted(os.listdir(val_img)):
        stem = os.path.splitext(f)[0]
        label = os.path.join(val_lbl, stem + ".txt")
        cls_id = None
        if os.path.isfile(label):
            try:
                with open(label, encoding="utf-8") as fp:
                    first = fp.readline().strip()
                    if first:
                        cls_id = int(first.split()[0])
            except (ValueError, IndexError):
                cls_id = None
        if cls_id is not None:
            class_pool.setdefault(cls_id, []).append(os.path.join(val_img, f))
        else:
            others.append(os.path.join(val_img, f))

    picked: list[str] = []
    for cls_id in sorted(class_pool):
        picked.extend(class_pool[cls_id][:per_class])
    # 类别不足时用其余图补足
    for p in others:
        if len(picked) >= max_total:
            break
        picked.append(p)
    return picked[:max_total]


def _model_params(model) -> int:
    """统计可训练参数量（返回个数）。"""
    return sum(p.numel() for p in model.model.parameters())


def _evaluate_and_collect(
    best_pt: str,
    train_save_dir: str,
    yaml_path: str,
    out_dir: str,
    export_dir: str,
    imgsz: int,
    batch: int,
    tag: str,
    samples: list[str],
) -> dict:
    """加载 best.pt → val 评测 + 生成样例图 + 归集产物，返回单模型指标 dict。"""
    from ultralytics import YOLO

    model = YOLO(best_pt)

    # 1) val 评测（plots 同步生成 PR/F1/混淆矩阵图）
    metrics = model.val(
        data=yaml_path,
        split="val",
        imgsz=imgsz,
        batch=batch,
        plots=True,
        project=export_dir,
        name=f"curve_tmp_{tag}",
        exist_ok=True,
    )
    box = metrics.box
    speed = metrics.speed or {}
    inference_ms = float(speed.get("inference", 0.0) or 0.0)
    fps = round(1000.0 / inference_ms, 1) if inference_ms > 0 else 0.0
    params_m = round(_model_params(model) / 1e6, 2)

    # 2) 归集曲线图 + 损失曲线（兼容新旧 ultralytics 的 PR/F1 曲线命名）
    curve_dir = os.path.join(export_dir, f"curves_{tag}")
    os.makedirs(curve_dir, exist_ok=True)
    for name in (
        "PR_curve.png", "BoxPR_curve.png",
        "F1_curve.png", "BoxF1_curve.png",
        "P_curve.png", "BoxP_curve.png",
        "R_curve.png", "BoxR_curve.png",
        "confusion_matrix.png", "results.png",
    ):
        src = os.path.join(metrics.save_dir, name)
        if os.path.isfile(src):
            shutil.copy(src, os.path.join(curve_dir, name))
    train_results = os.path.join(train_save_dir, "results.png")
    if os.path.isfile(train_results):
        shutil.copy(train_results, os.path.join(curve_dir, "train_loss_curve.png"))

    # 3) val 样例图（叠加预测框）
    if samples:
        model.predict(
            source=samples,
            save=True,
            imgsz=imgsz,
            conf=0.25,
            project=export_dir,
            name=f"samples_{tag}",
            exist_ok=True,
        )

    # 4) 归集 best.pt
    weight_dir = os.path.join(export_dir, "weights")
    os.makedirs(weight_dir, exist_ok=True)
    dst_weight = os.path.join(weight_dir, f"{tag}_best.pt")
    if os.path.abspath(best_pt) != os.path.abspath(dst_weight):
        shutil.copy(best_pt, dst_weight)

    return {
        "name": tag,
        "mAP50": round(float(box.map50), 4),
        "mAP50_95": round(float(box.map), 4),
        "precision": round(float(box.mp), 4),
        "recall": round(float(box.mr), 4),
        "fps": fps,
        "params_M": params_m,
        "imgsz": imgsz,
        "weight": os.path.relpath(dst_weight, export_dir),
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data-root", required=True, help="NEU-DET 数据集根目录")
    parser.add_argument("--out", default="./neu_det_yolo", help="YOLO 数据集输出目录")
    parser.add_argument("--export", default="./neu_det_export", help="最终产物输出目录")
    parser.add_argument("--epochs", type=int, default=200)
    parser.add_argument("--imgsz", type=int, default=200, help="YOLOv8 输入尺寸")
    parser.add_argument("--rtdetr-imgsz", type=int, default=640, help="RT-DETR 输入尺寸（Transformer 对分辨率敏感）")
    parser.add_argument("--batch", type=int, default=16)
    parser.add_argument("--model", default="yolov8s.pt", help="YOLOv8 主模型权重")
    parser.add_argument("--device", default=None, help="训练设备，默认自动（GPU 机留空即可）")
    parser.add_argument("--skip-rtdetr", action="store_true", help="跳过 RT-DETR 对比训练")
    args = parser.parse_args()

    from ultralytics import YOLO

    export_dir = os.path.abspath(args.export)
    os.makedirs(export_dir, exist_ok=True)
    yaml_path = prep_dataset(args.data_root, args.out)
    samples = collect_sample_images(args.out)

    records = []

    # ===== 训练 YOLOv8（主模型）=====
    print("\n===== 训练 YOLOv8（主模型） =====")
    base = os.path.basename(args.model).split(".")[0]
    r = YOLO(args.model).train(
        data=yaml_path,
        epochs=args.epochs,
        imgsz=args.imgsz,
        batch=args.batch,
        project="runs",
        name=f"{base}_neu",
        verbose=False,
    )
    yolo_best = os.path.join(r.save_dir, "weights", "best.pt")
    records.append(
        _evaluate_and_collect(
            yolo_best, r.save_dir, yaml_path, args.out, export_dir,
            args.imgsz, args.batch, base, samples,
        )
    )

    # ===== 训练 RT-DETR（Transformer 检测对比）=====
    if not args.skip_rtdetr:
        print("\n===== 训练 RT-DETR（Transformer 检测对比） =====")
        try:
            r2 = YOLO("rtdetr-l.pt").train(
                data=yaml_path,
                epochs=args.epochs,
                imgsz=args.rtdetr_imgsz,
                batch=max(1, args.batch // 2),
                project="runs",
                name="rtdetr_neu",
                verbose=False,
            )
            rtdetr_best = os.path.join(r2.save_dir, "weights", "best.pt")
            records.append(
                _evaluate_and_collect(
                    rtdetr_best, r2.save_dir, yaml_path, args.out, export_dir,
                    args.rtdetr_imgsz, max(1, args.batch // 2), "rtdetr", samples,
                )
            )
        except Exception as e:  # 无人值守：RT-DETR 失败不影响 YOLO 产物
            print(f"[警告] RT-DETR 训练/评测失败，保留 YOLOv8 产物继续导出：{e}")

    # ===== 写出对比 JSON =====
    comparison_path = os.path.join(export_dir, "comparison.json")
    with open(comparison_path, "w", encoding="utf-8") as fp:
        json.dump({"models": records}, fp, ensure_ascii=False, indent=2)

    print("\n===== 双模型指标对比 =====")
    print(f"{'模型':<12}{'mAP50':>10}{'mAP50-95':>11}{'Precision':>11}{'Recall':>9}{'FPS':>8}{'参数(M)':>9}")
    for m in records:
        print(
            f"{m['name']:<12}{m['mAP50']:>10}{m['mAP50_95']:>11}{m['precision']:>11}"
            f"{m['recall']:>9}{m['fps']:>8}{m['params_M']:>9}"
        )
    print(f"\n[完成] 全部产物已归集到：{export_dir}")
    print(f"  把整个目录 scp 回本地即可（best.pt、样例图、曲线图、comparison.json 均在内）。")


if __name__ == "__main__":
    main()