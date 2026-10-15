# -*- coding: utf-8 -*-
"""两个新数据集的快速画像（纯标准库，供后续可视化方案使用）"""
import os
import csv
from collections import Counter, defaultdict

BASE = r"d:\企业云系统\工业互联网系统\datasets"

# 修正 SmartFactory CSV 文件名（下载包内带 " (1)"）
old = os.path.join(BASE, "SmartFactory", "industrial_smart_factory_2026 (1).csv")
new = os.path.join(BASE, "SmartFactory", "industrial_smart_factory_automation_2026.csv")
if os.path.exists(old):
    os.rename(old, new)
    print(f"已重命名 -> {os.path.basename(new)}")

print("\n========== 数据集1：SmartFactory ==========")
with open(new, encoding="utf-8") as f:
    reader = csv.DictReader(f)
    n = 0
    machines, sections, conveyors, failures, maint = set(), set(), Counter(), Counter(), Counter()
    ts_min, ts_max = None, None
    for row in reader:
        n += 1
        machines.add(row["machine_id"])
        sections.add(row["factory_section"])
        conveyors[row["conveyor_status"]] += 1
        failures[row["machine_failure"]] += 1
        maint[row["maintenance_needed"]] += 1
        ts = row["timestamp"]
        ts_min = ts if ts_min is None or ts < ts_min else ts_min
        ts_max = ts if ts_max is None or ts > ts_max else ts_max
print(f"数据行数: {n:,}")
print(f"时间范围: {ts_min} ~ {ts_max}")
print(f"设备数: {len(machines)}  车间区段: {sorted(sections)}")
print(f"传送带状态: {dict(conveyors)}")
fail_n = failures.get("1", 0)
print(f"machine_failure: {dict(failures)}  故障率={fail_n/n*100:.2f}%")
print(f"maintenance_needed: {dict(maint)}")

print("\n========== 数据集2：DigitalTwin ==========")
with open(os.path.join(BASE, "DigitalTwin", "industrial_pump_failure_dataset.csv"), encoding="utf-8") as f:
    reader = csv.DictReader(f)
    n = 0
    traj_steps = Counter()
    traj_killer = set()
    fail_events = 0
    fail_types, statuses, urgency = Counter(), Counter(), Counter()
    ttf_min, ttf_max = None, None
    for row in reader:
        n += 1
        tid = row["trajectory_id"]
        traj_steps[tid] += 1
        if row["killer_trajectory"] == "1":
            traj_killer.add(tid)
        if row["failure_event"] == "1":
            fail_events += 1
        if row["failure_type"]:
            fail_types[row["failure_type"]] += 1
        statuses[row["machine_status"]] += 1
        urgency[row["urgency_level"]] += 1
        ttf = row["time_to_failure_hours"]
        if ttf:
            v = float(ttf)
            ttf_min = v if ttf_min is None else min(ttf_min, v)
            ttf_max = v if ttf_max is None else max(ttf_max, v)
print(f"数据行数: {n:,}")
print(f"轨迹数(虚拟泵台数): {len(traj_steps)}  其中最终失效轨迹: {len(traj_killer)}")
print(f"failure_event 总数: {fail_events}")
print(f"故障类型: {dict(fail_types)}")
print(f"machine_status: {dict(statuses)}")
print(f"urgency_level: {dict(urgency)}")
print(f"time_to_failure_hours: min={ttf_min}, max={ttf_max}")
import statistics
print(f"单轨迹平均步数: {statistics.mean(traj_steps.values()):.0f}")
