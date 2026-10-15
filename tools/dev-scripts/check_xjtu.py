# -*- coding: utf-8 -*-
"""校验 XJTU-SY 解压后的数据完整性与结构"""
import os

BASE = r"d:\企业云系统\工业互联网系统\datasets\XJTU-SY_Bearing_Datasets\Data\XJTU-SY_Bearing_Datasets"

conds = ["35Hz12kN", "37.5Hz11kN", "40Hz10kN"]
total_csv = 0
total_bytes = 0
summary = []

print("工况目录 | 轴承 | CSV文件数 | 大小(MB)")
print("-" * 55)
sample_path = None
for cond in conds:
    cond_path = os.path.join(BASE, cond)
    if not os.path.isdir(cond_path):
        print(f"!! 缺少工况目录: {cond}")
        continue
    bearings = sorted(os.listdir(cond_path))
    for b in bearings:
        bpath = os.path.join(cond_path, b)
        if not os.path.isdir(bpath):
            continue
        csvs = [f for f in os.listdir(bpath) if f.endswith(".csv")]
        n = len(csvs)
        size = sum(os.path.getsize(os.path.join(bpath, f)) for f in csvs)
        total_csv += n
        total_bytes += size
        summary.append((cond, b, n))
        if sample_path is None and csvs:
            sample_path = os.path.join(bpath, csvs[0])
        print(f"{cond} | {b} | {n} | {size/1024/1024:.1f}")

print("-" * 55)
print(f"合计: {total_csv} 个 CSV, {total_bytes/1024/1024/1024:.2f} GB")

# 读一个样例 CSV 确认结构（两列：水平/垂直振动）
if sample_path:
    print(f"\n样例文件: {os.path.basename(sample_path)}")
    with open(sample_path, encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f):
            if i >= 5:
                break
            print("  ", line.rstrip())
    with open(sample_path, encoding="utf-8", errors="replace") as f:
        rows = sum(1 for _ in f) - 1  # 减表头
    # 看看有表头吗
    with open(sample_path, encoding="utf-8", errors="replace") as f:
        first = f.readline().strip()
    print(f"首行(可能是表头): {first}")
    print(f"数据行数: {rows:,} (每行 32768 采样点? 见 pdf)")