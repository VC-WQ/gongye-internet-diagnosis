# -*- coding: utf-8 -*-
"""XJTU-SY 轴承全寿命健康退化分析与剩余寿命(RUL)计算。

纯 numpy 实现，不依赖 pandas/sklearn。对每根轴承：
  1. 读取全寿命 CSV（水平/垂直两列振动，每文件 32768 点、间隔 1 分钟）
  2. 计算水平振动列的均方根 RMS，作为健康退化指标
  3. 滑动平均平滑后归一化为健康指标 HI（1=健康 -> 0=失效）
  4. 计算归一化剩余寿命 RUL = (寿命 - t) / 寿命

输出 JSON 文件，供前端 ECharts 直接绘制退化曲线 / RUL 预测对比图。

用法：
  python scripts/analyze_xjtu.py            # 处理全部 15 根轴承
  python scripts/analyze_xjtu.py --limit 3  # 只处理前 3 根（快速验证）
"""
from __future__ import annotations

import argparse
import json
import os

import numpy as np

# 数据目录与输出目录
DATA_BASE = r"d:\企业云系统\工业互联网系统\datasets\XJTU-SY_Bearing_Datasets\Data\XJTU-SY_Bearing_Datasets"
OUT_DIR = r"d:\企业云系统\工业互联网系统\backend\app\data"
OUT_FILE = os.path.join(OUT_DIR, "xjtu_rul.json")

CONDITIONS = ["35Hz12kN", "37.5Hz11kN", "40Hz10kN"]


def _file_sort_key(fname: str) -> int:
    """CSV 文件名排序键：按文件名的**数值**排序。

    关键修复：XJTU-SY 的采样文件以数字编号命名（1.csv, 2.csv, ..., 2538.csv）。
    若按字符串排序会得到 1, 10, 100, 1000, 11, ... 的顺序，导致整个时间序列错乱、
    退化轨迹失去单调性（表现为 RMS 峰值出现在寿命中段、末期反而回落），
    进而使任何 RUL 预测模型的评估指标失真（如 R² 为负）。
    """
    stem = os.path.splitext(fname)[0]
    try:
        return int(stem)
    except ValueError:
        return 10**9  # 非数字文件名排在末尾，保证主序列不受干扰


def load_bearing_rms(bearing_dir: str) -> np.ndarray:
    """读取一根轴承的全部 CSV，返回水平振动 RMS 序列（严格按时间顺序）。"""
    files = sorted(
        (f for f in os.listdir(bearing_dir) if f.endswith(".csv")),
        key=_file_sort_key,
    )
    rms = []
    for f in files:
        # skiprows=1 跳过表头；只取第一列（水平振动）
        data = np.loadtxt(os.path.join(bearing_dir, f), delimiter=",", skiprows=1)
        x = data[:, 0]
        rms.append(float(np.sqrt(np.mean(x ** 2))))
    return np.asarray(rms)


def smooth(x: np.ndarray, window: int = 11) -> np.ndarray:
    """滑动平均平滑，边界用最邻近填充。"""
    if len(x) < window:
        return x.copy()
    kernel = np.ones(window) / window
    pad = window // 2
    xp = np.pad(x, (pad, pad), mode="edge")
    return np.convolve(xp, kernel, mode="valid")


def normalize_hi(rms_smooth: np.ndarray) -> np.ndarray:
    """由平滑 RMS 构造健康指标 HI：初始(健康)趋近 1，失效趋近 0。

    RMS 随退化增大，故 HI = (rms_max - rms) / (rms_max - rms_min)。
    """
    rmin, rmax = float(rms_smooth.min()), float(rms_smooth.max())
    if rmax - rmin < 1e-12:
        return np.ones_like(rms_smooth)
    hi = (rmax - rms_smooth) / (rmax - rmin)
    return np.clip(hi, 0.0, 1.0)


def build_series(rms_raw: np.ndarray, rms_smooth: np.ndarray) -> list[dict]:
    """组装每根轴承的时间序列（含 RMS / 健康指标 / 归一化 RUL）。"""
    lifetime = len(rms_raw)
    hi = normalize_hi(rms_smooth)
    # 归一化 RUL：时刻 t 的剩余寿命比例，从 1 线性降到 0
    rul = (lifetime - 1 - np.arange(lifetime)) / (lifetime - 1) if lifetime > 1 else np.zeros(lifetime)
    rul = np.clip(rul, 0.0, 1.0)
    series = []
    for t in range(lifetime):
        series.append(
            {
                "t": t,  # 时间（分钟）
                "rms": round(float(rms_raw[t]), 6),
                "rms_smooth": round(float(rms_smooth[t]), 6),
                "hi": round(float(hi[t]), 4),
                "rul": round(float(rul[t]), 4),
            }
        )
    return series


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--limit", type=int, default=0, help="只处理前 N 根轴承（0=全部）")
    parser.add_argument("--window", type=int, default=11, help="滑动平均窗口")
    args = parser.parse_args()

    bearings = []
    for cond in CONDITIONS:
        cond_path = os.path.join(DATA_BASE, cond)
        if not os.path.isdir(cond_path):
            continue
        for name in sorted(os.listdir(cond_path)):
            bpath = os.path.join(cond_path, name)
            if os.path.isdir(bpath):
                bearings.append((cond, name, bpath))

    if args.limit > 0:
        bearings = bearings[: args.limit]

    results = []
    for cond, name, bpath in bearings:
        print(f"[处理] {cond} / {name} ...")
        rms_raw = load_bearing_rms(bpath)
        rms_smooth = smooth(rms_raw, args.window)
        results.append(
            {
                "id": name,
                "condition": cond,
                "lifetime_min": int(len(rms_raw)),
                "fault": "",  # 失效部件由 pdf 提供，脚本暂不标注
                "series": build_series(rms_raw, rms_smooth),
            }
        )

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump({"bearings": results}, f, ensure_ascii=False)

    total = sum(len(r["series"]) for r in results)
    print(f"\n[完成] 处理 {len(results)} 根轴承，共 {total} 个采样点")
    print(f"[输出] {OUT_FILE}")
    print(f"[体积] {os.path.getsize(OUT_FILE)/1024:.1f} KB")


if __name__ == "__main__":
    main()