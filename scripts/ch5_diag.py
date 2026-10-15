# -*- coding: utf-8 -*-
"""第五章诊断脚本：解释为何部分轴承 SDE-PF 表现极差。

输出每个轴承的：寿命、预测起点、失效阈值 z_fail（留一法取同工况中位数）、
该轴承自身末期 RMS 放大倍数、以及末期水平与阈值的比值。

用法：python scripts/ch5_diag.py
输出：scripts/_ch5_diag.txt
"""
from __future__ import annotations

import io
import json
import os

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUL_FILE = os.path.join(BASE, "backend", "app", "data", "xjtu_rul.json")
PF_FILE = os.path.join(BASE, "backend", "app", "data", "rul_sde_pf.json")
OUT = os.path.join(BASE, "scripts", "_ch5_diag.txt")

BASELINE_FRAC = 0.05
ONSET_Z = 1.15


def main() -> None:
    lines = []
    with open(RUL_FILE, encoding="utf-8") as f:
        rul = json.load(f)
    with open(PF_FILE, encoding="utf-8") as f:
        pf = json.load(f)
    bearings = rul["bearings"]

    def base_end(b):
        rms = np.array([p["rms"] for p in b["series"]], float)
        k = max(3, int(len(rms) * BASELINE_FRAC))
        return rms[:k].mean(), rms[-k:].mean(), rms.max()

    lines.append("=== 退化起始点与失效阈值匹配情况 ===")
    lines.append(
        f"{'id':<14}{'cond':<12}{'寿命':>6}{'起点':>6}{'起点%':>7}{'有效点':>7}"
        f"{'z_fail(同工况)':>15}{'自身末期倍数':>14}{'比值':>8}"
    )

    cond_levels: dict[str, list[float]] = {}
    for b in bearings:
        b0, e0, _ = base_end(b)
        if b0 > 1e-9:
            cond_levels.setdefault(b["condition"], []).append(e0 / b0)

    rows = []
    for cv in pf["curves"]:
        b = next(x for x in bearings if x["id"] == cv["id"])
        rms = np.array([p["rms"] for p in b["series"]], float)
        n = len(rms)
        base = rms[: max(3, int(n * BASELINE_FRAC))].mean()
        z = rms / base if base > 1e-9 else rms

        start = next(t for t in range(n) if cv["sde_pf"][t] is not None)
        valid = sum(1 for v in cv["sde_pf"] if v is not None)

        levels = [v for x, v in zip(bearings, [None] * len(bearings))]  # placeholder
        # 留一法：同工况其他轴承的末期倍数中位数
        peers = []
        for x in bearings:
            if x["id"] == b["id"] or x["condition"] != b["condition"]:
                continue
            pb, pe, _ = base_end(x)
            if pb > 1e-9:
                peers.append(pe / pb)
        z_fail = float(np.median(peers)) if peers else 6.0
        pb, pe, _ = base_end(b)
        self_end = pe / pb if pb > 1e-9 else float("nan")
        ratio = self_end / z_fail if z_fail > 1e-9 else float("nan")

        rows.append((cv["id"], cv["condition"], n, start, start / n, valid, z_fail, self_end, ratio))
        lines.append(
            f"{cv['id']:<14}{cv['condition']:<12}{n:>6}{start:>6}{start/n*100:>6.1f}%{valid:>7}"
            f"{z_fail:>15.3f}{self_end:>14.3f}{ratio:>8.2f}"
        )

    lines.append("\n=== 起点晚于寿命 70% 的轴承（突发失效型） ===")
    for r in rows:
        if r[4] > 0.70:
            lines.append(f"{r[0]:<14}{r[1]:<12}寿命={r[2]:>5} 起点={r[3]:>5}({r[4]*100:.1f}%) 有效点={r[5]}")

    lines.append("\n=== 末期倍数偏离同工况阈值 >2x 或 <0.5x 的轴承（阈值不匹配） ===")
    for r in rows:
        if r[8] > 2.0 or r[8] < 0.5:
            lines.append(f"{r[0]:<14}{r[1]:<12}自身末期={r[7]:.2f} 同工况阈值={r[6]:.2f} 比值={r[8]:.2f}")

    # 预测偏差方向：PF 平均高估还是低估
    lines.append("\n=== 预测偏差方向（末段） ===")
    for cv in pf["curves"]:
        n = len(cv["actual"])
        pairs = [(cv["actual"][t], cv["sde_pf"][t]) for t in range(n) if cv["sde_pf"][t] is not None]
        if not pairs:
            continue
        yt = np.array([p[0] for p in pairs])
        yp = np.array([p[1] for p in pairs])
        early = slice(0, max(1, len(yt) // 3))
        late = slice(len(yt) - max(1, len(yt) // 3), len(yt))
        lines.append(
            f"{cv['id']:<14} 早期偏差均值={np.mean(yp[early]-yt[early]):+.3f}  "
            f"末段偏差均值={np.mean(yp[late]-yt[late]):+.3f}  (正=高估剩余寿命)"
        )

    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("written", OUT)


if __name__ == "__main__":
    main()
