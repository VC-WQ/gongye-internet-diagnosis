# -*- coding: utf-8 -*-
"""数据资产总览（A）—— 统计 8 个公开数据集的真实规模 / 维度 / 任务类型。

纯标准库实现（csv + os + 快速文件/表头统计，不读全量大数据）。
输出 dataset_registry.json 供前端「数据资产」目录页绘制：

  1. summary          总量（数据集数 / 样本总量 / 总占用 / 覆盖任务类型数）
  2. task_dist        按「信号分类 / 寿命预测 / 缺陷检测 / 回归 / 表格分类」归类
  3. datasets         每个数据集的详细信息（名称/规模/维度/任务/模态/来源）

用法：
    python scripts/generate_dataset_registry.py
"""
from __future__ import annotations

import csv
import json
import os

import numpy as np  # 仅用于读 CWRU npz 取 shape

BASE = r"d:\企业云系统\工业互联网系统\datasets"
OUT_DIR = r"d:\企业云系统\工业互联网系统\backend\app\data"
OUT_FILE = os.path.join(OUT_DIR, "dataset_registry.json")


def _csv_shape(path: str) -> tuple[int, int]:
    """读 CSV 返回 (行数, 列数)。"""
    with open(path, encoding="utf-8", errors="replace") as f:
        r = csv.reader(f)
        header = next(r)
        n = sum(1 for _ in r)
        return n, len(header)


def _txt_shape(path: str) -> tuple[int, int]:
    with open(path, encoding="utf-8", errors="replace") as f:
        n = len(f.readlines()) - 1  # 去掉表头
    with open(path, encoding="utf-8", errors="replace") as f:
        cols = len(f.readline().strip().split())
    return n, cols


def _dir_stats(path: str) -> tuple[int, int]:
    """递归统计 (文件数, 总字节)。"""
    n_files = 0
    n_bytes = 0
    for root, _dirs, files in os.walk(path):
        for fn in files:
            n_files += 1
            try:
                n_bytes += os.path.getsize(os.path.join(root, fn))
            except OSError:
                pass
    return n_files, n_bytes


def _gb(b: int) -> float:
    return round(b / 1024 ** 3, 2)


def build_datasets() -> list[dict]:
    ds = []

    # 1. CWRU 轴承（信号分类）
    x = np.load(os.path.join(BASE, "CWRU", "processed.npz"))
    cwru_files, cwru_bytes = _dir_stats(os.path.join(BASE, "CWRU"))
    ds.append({
        "name": "CWRU",
        "label": "凯斯西储大学轴承故障数据集",
        "task": "signal_cls",
        "task_label": "信号故障分类",
        "modality": "振动信号（驱动端 12kHz）",
        "samples": int(x["X"].shape[0]),
        "dim": f"{x['X'].shape[2]} 点时域信号",
        "classes": 4,
        "class_names": ["正常", "内圈", "外圈", "滚动体"],
        "source": "Case Western Reserve University",
        "size_gb": _gb(cwru_bytes),
        "used_in": "信号诊断 / 特征可分性(t-SNE)",
    })

    # 2. DigitalTwin 泵（寿命预测）
    dt_path = os.path.join(BASE, "DigitalTwin", "industrial_pump_failure_dataset.csv")
    dt_rows, dt_cols = _csv_shape(dt_path)
    dt_files, dt_bytes = _dir_stats(os.path.join(BASE, "DigitalTwin"))
    ds.append({
        "name": "DigitalTwin",
        "label": "数字孪生泵全寿命失效数据集",
        "task": "rul",
        "task_label": "剩余寿命/PHM",
        "modality": "多传感器时序（振动/温度/压力）",
        "samples": dt_rows,
        "dim": f"{dt_cols} 维特征 · 150 条退化轨迹",
        "classes": 4,
        "class_names": ["轴承磨损", "气蚀", "密封失效", "电机烧毁"],
        "source": "数字孪生仿真生成（含维护价值字段）",
        "size_gb": _gb(dt_bytes),
        "used_in": "数字孪生预测性维护 / TTF 预测",
    })

    # 3. NEU-DET（缺陷检测）
    neu_dir = os.path.join(BASE, "NEU-DET")
    neu_files, neu_bytes = _dir_stats(neu_dir)
    img = sum(1 for _r, _d, fs in os.walk(neu_dir) for fn in fs if fn.lower().endswith((".jpg", ".png", ".bmp")))
    xml = sum(1 for _r, _d, fs in os.walk(neu_dir) for fn in fs if fn.lower().endswith(".xml"))
    ds.append({
        "name": "NEU-DET",
        "label": "带钢表面缺陷检测数据集",
        "task": "detection",
        "task_label": "目标检测/定位",
        "modality": "图像（200×200 灰度）+ VOC 标注框",
        "samples": img,
        "dim": f"{xml} 张 VOC 标注",
        "classes": 6,
        "class_names": ["裂纹", "夹杂", "斑块", "点蚀", "氧化铁皮", "划痕"],
        "source": "东北大学 NEU-DET",
        "size_gb": _gb(neu_bytes),
        "used_in": "视觉检测智能体（YOLOv8 / RT-DETR）",
    })

    # 4. SmartFactory（产线）
    sf_path = os.path.join(BASE, "SmartFactory", "industrial_smart_factory_automation_2026.csv")
    sf_rows, sf_cols = _csv_shape(sf_path)
    sf_files, sf_bytes = _dir_stats(os.path.join(BASE, "SmartFactory"))
    ds.append({
        "name": "SmartFactory",
        "label": "智能工厂产线多机组数据集",
        "task": "anomaly",
        "task_label": "产线异常检测",
        "modality": "多机组多传感器（8 工段 × 500 台）",
        "samples": sf_rows,
        "dim": f"{sf_cols} 维 · 6 类传感器 · 500 台设备",
        "classes": 2,
        "class_names": ["正常", "故障"],
        "source": "产线级仿真",
        "size_gb": _gb(sf_bytes),
        "used_in": "产线异常态势 / 工段故障率",
    })

    # 5. XJTU-SY 轴承全寿命（大数据量）
    xjtu_dir = os.path.join(BASE, "XJTU-SY_Bearing_Datasets")
    xjtu_files, xjtu_bytes = _dir_stats(xjtu_dir)
    ds.append({
        "name": "XJTU-SY",
        "label": "西安交大轴承全寿命加速退化数据集",
        "task": "rul",
        "task_label": "剩余寿命/退化建模",
        "modality": "全寿命振动信号（15 根轴承）",
        "samples": xjtu_files,
        "dim": "双通道振动 CSV（采样 25.6kHz）",
        "classes": 15,
        "class_names": ["Bearing1_1 ~ 3_5（3 工况 × 5 轴承）"],
        "source": "西安交通大学 XJTU-SY",
        "size_gb": _gb(xjtu_bytes),
        "used_in": "健康指标 HI 退化 / RUL 预测",
    })

    # 6. 机器故障（表格分类）
    mf_path = os.path.join(BASE, "机器故障数据集", "data.csv")
    mf_rows, mf_cols = _csv_shape(mf_path)
    mf_files, mf_bytes = _dir_stats(os.path.join(BASE, "机器故障数据集"))
    ds.append({
        "name": "MachineFault",
        "label": "机器故障预测数据集",
        "task": "tab_cls",
        "task_label": "表格二元分类",
        "modality": "结构化表格特征",
        "samples": mf_rows,
        "dim": f"{mf_cols} 维特征",
        "classes": 2,
        "class_names": ["正常", "故障"],
        "source": "公开比赛数据",
        "size_gb": _gb(mf_bytes),
        "used_in": "XGBoost 分类实证",
    })

    # 7. 制造缺陷（表格分类）
    md_path = os.path.join(BASE, "工业制造缺陷预测数据集", "manufacturing_defect_dataset.csv")
    md_rows, md_cols = _csv_shape(md_path)
    md_files, md_bytes = _dir_stats(os.path.join(BASE, "工业制造缺陷预测数据集"))
    ds.append({
        "name": "ManufacturingDefect",
        "label": "工业制造缺陷预测数据集",
        "task": "tab_cls",
        "task_label": "表格二元分类",
        "modality": "结构化表格特征",
        "samples": md_rows,
        "dim": f"{md_cols} 维特征",
        "classes": 2,
        "class_names": ["合格", "缺陷"],
        "source": "公开比赛数据",
        "size_gb": _gb(md_bytes),
        "used_in": "XGBoost 分类实证",
    })

    # 8. 蒸汽量（回归）
    steam_path = os.path.join(BASE, "工业蒸汽量预测", "zhengqi_train.txt")
    steam_rows, steam_cols = _txt_shape(steam_path)
    steam_files, steam_bytes = _dir_stats(os.path.join(BASE, "工业蒸汽量预测"))
    ds.append({
        "name": "Steam",
        "label": "工业蒸汽量预测数据集",
        "task": "regression",
        "task_label": "回归预测",
        "modality": "结构化表格特征（V0~V37）",
        "samples": steam_rows,
        "dim": f"{steam_cols - 1} 维特征 + 1 目标",
        "classes": 1,
        "class_names": ["连续目标 target"],
        "source": "天池工业赛",
        "size_gb": _gb(steam_bytes),
        "used_in": "sklearn/XGBoost 多模型回归",
    })
    return ds


def build_summary(ds: list[dict]) -> dict:
    total_samples = sum(d["samples"] for d in ds)
    total_size = round(sum(d["size_gb"] for d in ds), 2)
    task_count: dict[str, dict] = {}
    for d in ds:
        tk = d["task"]
        if tk not in task_count:
            task_count[tk] = {"task": tk, "task_label": d["task_label"], "count": 0}
        task_count[tk]["count"] += 1
    return {
        "n_datasets": len(ds),
        "total_samples": total_samples,
        "total_size_gb": total_size,
        "task_dist": list(task_count.values()),
    }


def main() -> None:
    datasets = build_datasets()
    result = {"summary": build_summary(datasets), "datasets": datasets}

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[完成] {result['summary']['n_datasets']} 个数据集, "
          f"样本总量 {result['summary']['total_samples']:,}, "
          f"占用 {result['summary']['total_size_gb']} GB")
    for d in datasets:
        print(f"  - {d['label']}: {d['samples']:,} 样本 · {d['size_gb']} GB · {d['task_label']}")
    print(f"[完成] 输出 -> {OUT_FILE}")


if __name__ == "__main__":
    main()