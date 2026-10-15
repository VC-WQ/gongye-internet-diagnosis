# -*- coding: utf-8 -*-
"""数字孪生泵 预测性维护（PHM）分析脚本。

数据：DigitalTwin/industrial_pump_failure_dataset.csv
  - 150 条「健康 → 退化 → 失效」完整运行轨迹（合计约 38 万时间步）
  - 每步含物理传感器（振动/温度）、数字孪生预测（hazard_score/故障概率/预测TTF）、
    维护事件与价值字段（维护成本/停机损失/预期节省）

纯 numpy + csv 实现（不依赖 pandas）。输出 4 块证据链 JSON 供前端绘制：

  1. overview        数据集规模 + 故障类型分布
  2. degradation     代表轨迹的退化演化（健康指标 hazard + 故障概率 + 振动物理退化）
  3. ttf_prediction  数字孪生的剩余寿命(TTF)预测精度（预测 vs 真实）
  4. maintenance_roi 预测性维护价值闭环（运行到失效 vs 及时干预）

用法：
    python scripts/analyze_pump.py [--limit N]
"""
from __future__ import annotations

import argparse
import csv
import json
import os
from collections import defaultdict

import numpy as np

DATA_PATH = r"d:\企业云系统\工业互联网系统\datasets\DigitalTwin\industrial_pump_failure_dataset.csv"
OUT_DIR = r"d:\企业云系统\工业互联网系统\backend\app\data"
OUT_FILE = os.path.join(OUT_DIR, "pump_phm.json")


def _f(v: str) -> float:
    """安全转 float，空串返回 0.0。"""
    v = v.strip()
    return float(v) if v else 0.0


def load_trajectories() -> dict[str, list[dict]]:
    """按 trajectory_id 分组读入全部轨迹。"""
    by: dict[str, list[dict]] = defaultdict(list)
    with open(DATA_PATH, encoding="utf-8") as f:
        for x in csv.DictReader(f):
            by[x["trajectory_id"]].append(x)
    return dict(by)


def failure_type_of(rows: list[dict]) -> str:
    """取该轨迹最后出现的非空故障类型。"""
    ft = ""
    for x in rows:
        if x["failure_type"].strip():
            ft = x["failure_type"].strip()
    return ft


def downsample(rows: list[dict], max_points: int = 240) -> list[dict]:
    """轨迹降采样（等间隔取索引），避免 38 万点撑爆前端 JSON。"""
    n = len(rows)
    if n <= max_points:
        return rows
    idx = np.linspace(0, n - 1, max_points, dtype=int)
    return [rows[i] for i in idx]


def build_overview(trajs: dict[str, list[dict]]) -> dict:
    ft_count: dict[str, int] = defaultdict(int)
    for rows in trajs.values():
        ft = failure_type_of(rows)
        if ft:
            ft_count[ft] += 1
    total_steps = sum(len(r) for r in trajs.values())
    return {
        "n_trajectories": len(trajs),
        "n_steps": total_steps,
        "failure_type_dist": [
            {"name": k, "value": v} for k, v in sorted(ft_count.items(), key=lambda kv: -kv[1])
        ],
    }


def build_degradation(trajs: dict[str, list[dict]]) -> dict:
    """选取 killer 轨迹（最长、完整走完退化-失效）输出三指标退化序列。

    x 轴=step（≈运行小时，因每步 TTF 递减 1 小时）。
    y 轴：
      - hazard  数字孪生健康风险指标 0~1
      - prob    未来 7 天故障概率 0~1
      - vib_n   振动归一化 0~1（物理退化证据）
    并标注关键事件：CRITICAL 起始 / 维护干预 / 失效。
    """
    killer = max(trajs.values(), key=len)
    rows = downsample(killer, 400)
    vib_all = [_f(x["vibration_g"]) for x in killer]
    vib_max = max(vib_all) or 1.0

    crit_step = next((int(x["step"]) for x in killer if x["machine_status"] == "CRITICAL"), None)
    maint_step = next((int(x["step"]) for x in killer if x["maintenance_event"] == "1"), None)
    fail_step = next((int(x["step"]) for x in killer if x["failure_event"] == "1"), None)

    series = [
        {
            "t": int(x["step"]),
            "hazard": round(_f(x["hazard_score"]), 4),
            "prob": round(_f(x["failure_probability_next_7d"]), 4),
            "vib": round(_f(x["vibration_g"]), 3),
            "vib_n": round(_f(x["vibration_g"]) / vib_max, 4),
        }
        for x in rows
    ]
    return {
        "id": killer[0]["trajectory_id"],
        "failure_type": failure_type_of(killer),
        "length": len(killer),
        "events": {"crit_at": crit_step, "maint_at": maint_step, "fail_at": fail_step},
        "series": series,
    }


def build_ttf_prediction(trajs: dict[str, list[dict]]) -> dict:
    """数字孪生剩余寿命(TTF)预测精度：预测值 vs 真实值（小时）。

    在维护干预前采样（故障前预警才值钱），每轨迹每 40 步取 1 点，
    用 [真实TTF, 预测TTF] 散点 + MAE/RMSE/相关系数衡量预测能力。
    """
    pts: list[list[float]] = []
    for rows in trajs.values():
        for x in rows[::40]:
            true = _f(x["time_to_failure_hours"])
            pred = _f(x["predicted_time_to_failure"])
            if true > 0:  # 排除已失效点
                pts.append([true, pred])
    arr = np.array(pts)
    true, pred = arr[:, 0], arr[:, 1]
    err = true - pred
    mae = float(np.abs(err).mean())
    rmse = float(np.sqrt((err ** 2).mean()))
    # 相关系数（预测与真实的一致性）
    tc, pc = true - true.mean(), pred - pred.mean()
    denom = np.sqrt((tc ** 2).sum() * (pc ** 2).sum())
    corr = float((tc * pc).sum() / denom) if denom > 0 else 0.0
    # 降采样散点（前端画太多点卡顿）
    if len(pts) > 600:
        idx = np.linspace(0, len(pts) - 1, 600, dtype=int)
        pts = [pts[i] for i in idx]
    return {
        "points": [[round(p[0], 1), round(p[1], 1)] for p in pts],
        "metrics": {
            "n": int(len(true)),
            "mae_hours": round(mae, 2),
            "rmse_hours": round(rmse, 2),
            "corr": round(corr, 4),
        },
    }


def build_maintenance_roi(trajs: dict[str, list[dict]]) -> dict:
    """预测性维护价值闭环统计。

    - 维护类型频次（preventive/scheduled/reactive/emergency）
    - 平均维护成本 vs 平均预期节省 vs 平均停机损失 vs 平均累计损失(不干预)
    """
    type_count: dict[str, int] = defaultdict(int)
    cost, savings, downtime, cumulative = [], [], [], []
    for rows in trajs.values():
        for x in rows:
            mt = x["maintenance_type"].strip()
            if mt:
                type_count[mt] += 1
            if _f(x["maintenance_cost_usd"]) > 0:
                cost.append(_f(x["maintenance_cost_usd"]))
            if _f(x["expected_savings_if_actioned"]) > 0:
                savings.append(_f(x["expected_savings_if_actioned"]))
            if _f(x["downtime_loss_usd"]) > 0:
                downtime.append(_f(x["downtime_loss_usd"]))
            if _f(x["cumulative_loss_usd"]) > 0:
                cumulative.append(_f(x["cumulative_loss_usd"]))

    avg = lambda a: round(float(np.mean(a)), 1) if a else 0.0
    avg_savings, avg_cost, avg_downtime, avg_cumulative = (
        avg(savings), avg(cost), avg(downtime), avg(cumulative),
    )
    roi = round(avg_savings / avg_cost, 1) if avg_cost > 0 else 0.0
    return {
        "maintenance_type_dist": [
            {"name": k, "value": v} for k, v in sorted(type_count.items(), key=lambda kv: -kv[1])
        ],
        "avg_maintenance_cost": avg_cost,
        "avg_expected_savings": avg_savings,
        "avg_downtime_loss": avg_downtime,
        "avg_cumulative_loss": avg_cumulative,
        "roi": roi,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--trajs", type=int, default=150, help="读取前 N 条轨迹")
    args = parser.parse_args()

    all_trajs = load_trajectories()
    trajs = dict(list(all_trajs.items())[: args.trajs])
    print(f"[数据] 读取 {len(trajs)} 条轨迹")

    result = {
        "overview": build_overview(trajs),
        "degradation": build_degradation(trajs),
        "ttf_prediction": build_ttf_prediction(trajs),
        "maintenance_roi": build_maintenance_roi(trajs),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[完成] 故障类型分布: {result['overview']['failure_type_dist']}")
    m = result["ttf_prediction"]["metrics"]
    print(f"[完成] TTF 预测: MAE={m['mae_hours']}h RMSE={m['rmse_hours']}h corr={m['corr']}")
    r = result["maintenance_roi"]
    print(f"[完成] 维护ROI: 平均成本${r['avg_maintenance_cost']} -> 平均节省${r['avg_expected_savings']} (ROI {r['roi']}x)")
    print(f"[完成] 输出 -> {OUT_FILE}")


if __name__ == "__main__":
    main()