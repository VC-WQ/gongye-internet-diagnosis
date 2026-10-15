# -*- coding: utf-8 -*-
"""SmartFactory 产线级异常态势分析脚本。

数据：datasets/SmartFactory/industrial_smart_factory_automation_2026.csv
  - 10 万条记录，500 台机器 × 8 个工段（产线级多机组）
  - 每行 = 某机器某时刻的 6 类传感器快照 + 故障/维护标签

纯 numpy + csv 实现。输出「系统层 / 产线级异常态势」证据链 JSON：

  1. overview        数据规模 + 整体故障率/维护率
  2. section_health  8 工段的故障率排名（玫瑰图）
  3. sensor_anomaly  故障 vs 正常 6 传感器归一化异常度（分组条形）
  4. machine_health  500 台机器的单机故障率分布（直方图）

用法：
    python scripts/analyze_smartfactory.py
"""
from __future__ import annotations

import csv
import json
import os
from collections import defaultdict

import numpy as np

DATA_PATH = r"d:\企业云系统\工业互联网系统\datasets\SmartFactory\industrial_smart_factory_automation_2026.csv"
OUT_DIR = r"d:\企业云系统\工业互联网系统\backend\app\data"
OUT_FILE = os.path.join(OUT_DIR, "smartfactory.json")

# 工段 / 传感器中文映射
SECTION_LABEL = {
    "Welding": "焊接",
    "Cooling_System": "冷却系统",
    "CNC": "数控机床",
    "Logistics": "物流",
    "Robotics": "机器人",
    "Assembly": "装配",
    "Inspection": "检测",
    "Packaging": "包装",
}
SENSOR_LABEL = {
    "temperature_sensor": "温度",
    "vibration_level": "振动",
    "motor_speed_rpm": "转速",
    "energy_consumption": "能耗",
    "pressure_level": "压力",
    "humidity_level": "湿度",
}
SENSOR_ORDER = ["vibration_level", "temperature_sensor", "energy_consumption",
                "motor_speed_rpm", "pressure_level", "humidity_level"]


def load() -> list[dict]:
    with open(DATA_PATH, encoding="utf-8") as f:
        return list(csv.DictReader(f))


def build_overview(rows: list[dict]) -> dict:
    n_fail = sum(1 for x in rows if x["machine_failure"] == "1")
    n_maint = sum(1 for x in rows if x["maintenance_needed"] == "1")
    machines = set(x["machine_id"] for x in rows)
    sections = set(x["factory_section"] for x in rows)
    return {
        "n_samples": len(rows),
        "n_machines": len(machines),
        "n_sections": len(sections),
        "failure_rate": round(n_fail / len(rows), 4),
        "maintenance_rate": round(n_maint / len(rows), 4),
    }


def build_section_health(rows: list[dict]) -> dict:
    """8 工段故障率（玫瑰图数据）。"""
    agg = defaultdict(lambda: [0, 0])
    for x in rows:
        agg[x["factory_section"]][1] += 1
        if x["machine_failure"] == "1":
            agg[x["factory_section"]][0] += 1
    items = [
        {
            "name": s,
            "label": SECTION_LABEL.get(s, s),
            "failures": f,
            "total": t,
            "failure_rate": round(f / t, 4),
        }
        for s, (f, t) in agg.items()
    ]
    items.sort(key=lambda d: -d["failure_rate"])
    return {"items": items}


def build_sensor_anomaly(rows: list[dict]) -> dict:
    """6 传感器在故障/正常样本上的均值 + 归一化异常度（相对正常均值变化 %）。"""
    feats = SENSOR_ORDER
    acc_fail = defaultdict(list)
    acc_norm = defaultdict(list)
    for x in rows:
        target = acc_fail if x["machine_failure"] == "1" else acc_norm
        for k in feats:
            target[k].append(float(x[k]))

    items = []
    for k in feats:
        n_mean = np.mean(acc_norm[k])
        f_mean = np.mean(acc_fail[k])
        delta = f_mean - n_mean
        # 转速下降也是异常，取绝对偏差率统一语义；湿度/压力变化小
        delta_pct = (delta / n_mean) * 100.0 if n_mean else 0.0
        items.append({
            "name": k,
            "label": SENSOR_LABEL.get(k, k),
            "normal": round(float(n_mean), 2),
            "fault": round(float(f_mean), 2),
            "delta_pct": round(float(delta_pct), 2),
        })
    return {"columns": feats, "items": items}


def build_machine_health(rows: list[dict]) -> dict:
    """500 台机器的单机故障率分布（直方图）。"""
    agg = defaultdict(lambda: [0, 0])
    for x in rows:
        agg[x["machine_id"]][1] += 1
        if x["machine_failure"] == "1":
            agg[x["machine_id"]][0] += 1
    rates = [f / t for f, t in agg.values()]

    # 分桶 0~30% 每 2% 一档
    bins = np.arange(0.0, 0.30, 0.02)
    hist, _ = np.histogram(rates, bins=bins)
    return {
        "bins": [round(float(b), 3) for b in bins],
        "counts": [int(h) for h in hist],
        "mean_rate": round(float(np.mean(rates)), 4),
        "max_rate": round(float(np.max(rates)), 4),
    }


def main() -> None:
    rows = load()
    print(f"[数据] {len(rows)} 条记录")

    result = {
        "overview": build_overview(rows),
        "section_health": build_section_health(rows),
        "sensor_anomaly": build_sensor_anomaly(rows),
        "machine_health": build_machine_health(rows),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[完成] 工段故障率: {[(d['label'], d['failure_rate']) for d in result['section_health']['items']]}")
    print(f"[完成] 传感器异常度: {[(d['label'], d['delta_pct']) for d in result['sensor_anomaly']['items']]}")
    print(f"[完成] 输出 -> {OUT_FILE}")


if __name__ == "__main__":
    main()