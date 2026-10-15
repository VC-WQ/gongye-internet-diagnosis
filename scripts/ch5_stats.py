# -*- coding: utf-8 -*-
"""第五章核准脚本：输出 XJTU-SY 数据集与 RUL 预测的逐轴承实测统计量。

用法：python scripts/ch5_stats.py
输出：scripts/_ch5_stats.txt
"""
from __future__ import annotations

import io
import json
import os

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUL_FILE = os.path.join(BASE, "backend", "app", "data", "xjtu_rul.json")
PF_FILE = os.path.join(BASE, "backend", "app", "data", "rul_sde_pf.json")
OUT = os.path.join(BASE, "scripts", "_ch5_stats.txt")

# XJTU-SY 原始 CSV 抽样校验（每行点数 -> 采样时长）
SAMPLE_DIR = None
for cand in [
    r"d:\企业云系统\工业互联网系统\datasets\XJTU-SY_Bearing_Datasets\Data\XJTU-SY_Bearing_Datasets",
    r"D:\企业云系统\工业互联网系统\datasets\XJTU-SY_Bearing_Datasets\Data\XJTU-SY_Bearing_Datasets",
]:
    if os.path.isdir(cand):
        SAMPLE_DIR = cand
        break


def _m(y_true, y_pred):
    yt = np.asarray(y_true, float)
    yp = np.asarray(y_pred, float)
    mse = float(np.mean((yt - yp) ** 2))
    ss_res = float(np.sum((yt - yp) ** 2))
    ss_tot = float(np.sum((yt - yt.mean()) ** 2))
    return (
        np.sqrt(mse),
        float(np.mean(np.abs(yt - yp))),
        1.0 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0,
    )


def main() -> None:
    lines: list[str] = []

    with open(RUL_FILE, encoding="utf-8") as f:
        rul = json.load(f)
    with open(PF_FILE, encoding="utf-8") as f:
        pf = json.load(f)

    bearings = rul["bearings"]
    lines.append("=== XJTU-SY 轴承概览 ===")
    lines.append(f"轴承数={len(bearings)}")
    lives = []
    for b in bearings:
        lives.append(len(b["series"]))
    lines.append(f"采样点总数={sum(lives)}  寿命(min)={min(lives)}~{max(lives)}  均值={np.mean(lives):.1f}  中位={np.median(lives):.0f}")

    lines.append("\n=== 逐工况 ===")
    conds: dict[str, list[tuple[str, int]]] = {}
    for b in bearings:
        conds.setdefault(b["condition"], []).append((b["id"], len(b["series"])))
    for c, items in conds.items():
        ls = [n for _, n in items]
        lines.append(f"{c}: n={len(items)}  寿命={min(ls)}~{max(ls)}  倍数={max(ls)/min(ls):.2f}x  明细={sorted(ls)}")
        lines.append(f"   ids={[i for i, _ in items]}")

    # 原始 CSV 规格校验
    if SAMPLE_DIR:
        lines.append("\n=== 原始 CSV 规格校验 ===")
        b0 = os.path.join(SAMPLE_DIR, "35Hz12kN", "Bearing1_1")
        if os.path.isdir(b0):
            fs = sorted([f for f in os.listdir(b0) if f.endswith(".csv")],
                        key=lambda s: int(os.path.splitext(s)[0]))
            lines.append(f"Bearing1_1 文件数={len(fs)}  首={fs[0]}  末={fs[-1]}")
            with open(os.path.join(b0, fs[0]), encoding="utf-8", errors="ignore") as f:
                head = f.readline().strip()
                nrow = sum(1 for _ in f)
            lines.append(f"表头={head[:80]}  单个 CSV 数据行数={nrow}")
            lines.append(f"若 fs=25.6kHz -> 单次时长={nrow/25600:.4f} s")

    lines.append("\n=== 整体指标（核准） ===")
    for k in ("sde_pf", "baseline"):
        m = pf["metrics"][k]
        lines.append(f"{k}: R2={m['r2']}  RMSE={m['rmse']}  MAE={m['mae']}  MSE={m['mse']}  n={m['n_points']}")
    mb, mp = pf["metrics"]["baseline"], pf["metrics"]["sde_pf"]
    lines.append(f"RMSE 降幅={(mb['rmse']-mp['rmse'])/mb['rmse']*100:.2f}%  MAE 降幅={(mb['mae']-mp['mae'])/mb['mae']*100:.2f}%")

    lines.append("\n=== 逐轴承 RMSE / MAE(RUL比例) ===")
    lines.append(f"{'id':<14}{'cond':<12}{'寿命':>6}{'有效点':>7}{'PF_RMSE':>9}{'PF_MAE':>8}{'PF_R2':>8}{'BL_RMSE':>9}{'BL_MAE':>8}{'BL_R2':>8}{'预测起点':>8}")
    rows = []
    for cv in pf["curves"]:
        actual = cv["actual"]
        pairs_pf = [(actual[t], cv["sde_pf"][t]) for t in range(len(actual)) if cv["sde_pf"][t] is not None]
        pairs_bl = [(actual[t], cv["baseline"][t]) for t in range(len(actual)) if cv["baseline"][t] is not None]
        start = min(t for t in range(len(actual)) if cv["sde_pf"][t] is not None)
        r2p = None
        if pairs_pf:
            yt = np.array([p[0] for p in pairs_pf])
            yp = np.array([p[1] for p in pairs_pf])
            r_p, m_p, r2p = _m(yt, yp)
        else:
            r_p = m_p = float("nan")
        if pairs_bl:
            yt = np.array([p[0] for p in pairs_bl])
            yp = np.array([p[1] for p in pairs_bl])
            r_b, m_b, r2b = _m(yt, yp)
        else:
            r_b = m_b = r2b = float("nan")
        rows.append((cv["id"], cv["condition"], len(actual), len(pairs_pf), start, r_p, m_p, r2p, len(pairs_bl), r_b, m_b, r2b))
        lines.append(
            f"{cv['id']:<14}{cv['condition']:<12}{len(actual):>6}{len(pairs_pf):>7}"
            f"{r_p:>9.4f}{m_p:>8.4f}{(r2p if r2p is not None else float('nan')):>8.3f}"
            f"{r_b:>9.4f}{m_b:>8.4f}{(r2b if r2b is not None else float('nan')):>8.3f}{start:>8}"
        )

    pf_rmse = [r[5] for r in rows]
    bl_rmse = [r[9] for r in rows]
    win = sum(1 for a, b in zip(pf_rmse, bl_rmse) if a < b)
    lines.append(f"\nPF 优于基线的轴承数 = {win}/{len(rows)}")
    pf_mae = [r[6] for r in rows]
    bl_mae = [r[10] for r in rows]
    lines.append(f"PF MAE 优于基线的轴承数 = {sum(1 for a, b in zip(pf_mae, bl_mae) if a < b)}/{len(rows)}")
    lines.append(f"PF RMSE 中位数={np.median(pf_rmse):.4f}  基线 RMSE 中位数={np.median(bl_rmse):.4f}")

    lines.append("\n=== 三条代表曲线的关键采样点 ===")
    for tid in ["Bearing1_1", "Bearing2_3", "Bearing3_5"]:
        cv = next((c for c in pf["curves"] if c["id"] == tid), None)
        if not cv:
            lines.append(f"{tid}: 未找到")
            continue
        n = len(cv["actual"])
        ticks = [int(n * f) for f in (0.25, 0.5, 0.75, 0.9, 0.99)]
        lines.append(f"\n{tid} (n={n}, {cv['condition']})")
        lines.append(f"{'位置':<8}{'真实RUL':>9}{'PF预测':>9}{'基线预测':>10}")
        for t in ticks:
            a = cv["actual"][t]
            p = cv["sde_pf"][t]
            b = cv["baseline"][t]
            lines.append(
                f"{t/n*100:>5.0f}%  {a:>9.3f}{(p if p is not None else float('nan')):>9.3f}"
                f"{(b if b is not None else float('nan')):>10.3f}"
            )

    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("written", OUT)


if __name__ == "__main__":
    main()
