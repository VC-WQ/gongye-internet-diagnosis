# -*- coding: utf-8 -*-
"""补跑 RT-DETR 剩余 epoch 并完成双模型评测导出（无人值守）。

背景：全量训练时 RT-DETR 在 98/200 epoch 因关机中断，best.pt/last.pt 已保存，
但 RT-DETR 的曲线图/样例图未导出、comparison.json 未生成。

本脚本做三件事：
  1. resume RT-DETR 到 200 epoch（从 last.pt 续训，不改数据划分）
  2. 对 YOLOv8s + RT-DETR 分别评测导出（曲线图 / 样例图 / best.pt 归集）
  3. 写出双模型 comparison.json

依赖：与 train_neu_det.py 同目录（import 其 _evaluate_and_collect / collect_sample_images）。
"""
from __future__ import annotations

import glob
import json
import os

from train_neu_det import _evaluate_and_collect, collect_sample_images

# 远程工作目录（与 remote_helper.py 的 REMOTE_WORK 一致）
WORK = "/root/autodl-tmp/neu_det"
OUT = os.path.join(WORK, "out")
EXPORT = os.path.join(WORK, "export")
YAML = os.path.join(OUT, "data.yaml")

# 训练保存目录（ultralytics 在 project="runs" 下再嵌套 detect/runs/）
RUNS = os.path.join(WORK, "runs", "detect", "runs")


def main() -> None:
    from ultralytics import YOLO

    # ---- 1) resume RT-DETR 到 200 epoch ----
    rtdetr_last = glob.glob(os.path.join(RUNS, "rtdetr_neu", "weights", "last.pt"))
    if not rtdetr_last:
        raise SystemExit("未找到 RT-DETR last.pt，无法 resume")
    print(f"[resume] RT-DETR from {rtdetr_last[0]}")
    m = YOLO(rtdetr_last[0])
    m.train(resume=True)

    # ---- 2) 收集样例图 + 定位两个 best.pt ----
    samples = collect_sample_images(OUT)

    yolo_dirs = glob.glob(os.path.join(RUNS, "yolov8s_neu*", "weights", "best.pt"))
    # 优先用 export 已归集的 YOLOv8s best.pt；否则用训练目录里的
    yolo_best = os.path.join(EXPORT, "weights", "yolov8s_best.pt")
    if not os.path.isfile(yolo_best) and yolo_dirs:
        yolo_best = sorted(yolo_dirs)[-1]
    yolo_savedir = os.path.dirname(os.path.dirname(sorted(yolo_dirs)[-1])) if yolo_dirs else ""

    rtdetr_best = glob.glob(os.path.join(RUNS, "rtdetr_neu", "weights", "best.pt"))[0]
    rtdetr_savedir = os.path.dirname(os.path.dirname(rtdetr_best))

    # ---- 3) 评测导出双模型 + 写 comparison.json ----
    records = []
    records.append(_evaluate_and_collect(
        yolo_best, yolo_savedir, YAML, OUT, EXPORT, 200, 16, "yolov8s", samples,
    ))
    records.append(_evaluate_and_collect(
        rtdetr_best, rtdetr_savedir, YAML, OUT, EXPORT, 640, 8, "rtdetr", samples,
    ))

    with open(os.path.join(EXPORT, "comparison.json"), "w", encoding="utf-8") as fp:
        json.dump({"models": records}, fp, ensure_ascii=False, indent=2)

    print("\n===== 双模型指标对比 =====")
    for r in records:
        print(f"{r['name']}: mAP50={r['mAP50']} mAP50-95={r['mAP50_95']} "
              f"P={r['precision']} R={r['recall']} FPS={r['fps']} 参数={r['params_M']}M")
    print("\n[完成] comparison.json 已写出")


if __name__ == "__main__":
    main()