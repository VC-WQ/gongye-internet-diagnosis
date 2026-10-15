# -*- coding: utf-8 -*-
"""第五章公平性核准：基线 NaN 点的处理口径对对比结论的影响。

rul_sde_pf.py 的 evaluate 中，基线返回 nan（局部增长率 k<=0，无法外推）时，
该点以 0.0 计入 all_base —— 等价于判定"此刻已失效"，是一种偏严格的口径。
本脚本统计：
    1. 基线 nan 点的数量与占比
    2. 在「基线与 PF 均有效」的公共子集上重新计算两者的 R²/RMSE/MAE
    3. 口径切换后，PF 是否仍然占优

输出：scripts/_ch5_fair.txt
"""
from __future__ import annotations

import io
import json
import os

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUL_FILE = os.path.join(BASE, "backend", "app", "data", "xjtu_rul.json")
PF_FILE = os.path.join(BASE, "backend", "app", "data", "rul_sde_pf.json")
OUT = os.path.join(BASE, "scripts", "_ch5_fair.txt")


def met(yt, yp):
    yt = np.asarray(yt, float)
    yp = np.asarray(yp, float)
    mse = float(np.mean((yt - yp) ** 2))
    ss_res = float(np.sum((yt - yp) ** 2))
    ss_tot = float(np.sum((yt - yt.mean()) ** 2))
    return (
        np.sqrt(mse),
        float(np.mean(np.abs(yt - yp))),
        1 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0,
    )


def main() -> None:
    lines = []
    with open(RUL_FILE, encoding="utf-8") as f:
        rul = json.load(f)
    with open(PF_FILE, encoding="utf-8") as f:
        pf = json.load(f)

    lt = {b["id"]: len(b["series"]) for b in rul["bearings"]}

    all_t, all_pf, all_bl = [], [], []
    com_t, com_pf, com_bl = [], [], []
    n_nan = 0

    for cv in pf["curves"]:
        actual = cv["actual"]
        for t in range(len(actual)):
            p = cv["sde_pf"][t]
            b = cv["baseline"][t]
            if p is None and b is None:
                continue
            all_t.append(actual[t])
            all_pf.append(p if p is not None else 0.0)
            all_bl.append(b if b is not None else 0.0)
            if b is None:
                n_nan += 1
            if p is not None and b is not None:
                com_t.append(actual[t])
                com_pf.append(p)
                com_bl.append(b)

    lines.append("=== 口径 1：全部预测点（NaN 记 0.0，脚本原始口径） ===")
    r_p, m_p, r2_p = met(all_t, all_pf)
    r_b, m_b, r2_b = met(all_t, all_bl)
    lines.append(f"n={len(all_t)}")
    lines.append(f"PF    : RMSE={r_p:.4f}  MAE={m_p:.4f}  R2={r2_p:.4f}")
    lines.append(f"基线  : RMSE={r_b:.4f}  MAE={m_b:.4f}  R2={r2_b:.4f}")
    lines.append(f"基线 NaN 点数={n_nan}  占比={n_nan/len(all_t)*100:.2f}%")

    lines.append("\n=== 口径 2：仅取「两者均有效」的公共子集（对基线更宽松） ===")
    r_p2, m_p2, r2_p2 = met(com_t, com_pf)
    r_b2, m_b2, r2_b2 = met(com_t, com_bl)
    lines.append(f"n={len(com_t)}")
    lines.append(f"PF    : RMSE={r_p2:.4f}  MAE={m_p2:.4f}  R2={r2_p2:.4f}")
    lines.append(f"基线  : RMSE={r_b2:.4f}  MAE={m_b2:.4f}  R2={r2_b2:.4f}")
    lines.append(f"RMSE 差值={r_b2-r_p2:+.4f}  MAE 差值={m_b2-m_p2:+.4f}")

    lines.append("\n=== 逐轴承 NaN 占比 ===")
    for cv in pf["curves"]:
        arr = cv["baseline"]
        vals = [v for v in arr if v is not None]
        nn = sum(1 for v in arr if v is None)
        tot = len(arr) - sum(1 for v in arr if v is None and False)
        lines.append(f"{cv['id']:<14} 起点后点数~{len(vals)+0:>5}  NaN(全序列内)={nn:>5}")

    with io.open(OUT, "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    print("ok")


if __name__ == "__main__":
    main()
