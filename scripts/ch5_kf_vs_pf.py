# -*- coding: utf-8 -*-
"""第五章补充实验：对数域状态空间既已线性，为何用粒子滤波而非 Kalman 滤波？

做法
----
构造与 SDE-PF **完全同构**的线性 Kalman 滤波（同一状态方程、同一噪声参数、
同一观测方程、同一初始化），在完全相同的留一法协议下对比：

    KF  : 状态 x=[lw, a]，x_{k+1}=F x_k + w，y_k = H x_k + ln c + v，线性高斯
          RUL 点估计只能取 -Ê[lw]/Ê[a]（KF 不提供 RUL 的后验分布）
    PF  : 粒子云直接给出 RUL 的经验分布，可取中位数与分位数区间

除点估计精度外，额外报告 PF 独有的**不确定性量化能力**：
    PICP  预测区间覆盖概率（真实 RUL 落入 [5%, 95%] 粒子分位数区间的比例）
    MPIW  平均预测区间宽度

输出：backend/app/data/ch5_kf_vs_pf.json
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(BASE, "scripts"))

from rul_sde_pf import (  # noqa: E402
    A_MIN,
    BASELINE_FRAC,
    N_PARTICLES,
    ONSET_Z,
    SIGMA_A,
    SIGMA_W,
    SIGMA_Z,
    START_FRAC,
    W0,
    W_FAIL,
    Z_EPS,
    SdeParticleFilter,
    condition_fail_level,
    condition_life_prior,
)

RUL_FILE = os.path.join(BASE, "backend", "app", "data", "xjtu_rul.json")
OUT_FILE = os.path.join(BASE, "backend", "app", "data", "ch5_kf_vs_pf.json")


class LinearKalmanRUL:
    """与 SdeParticleFilter 同构的线性 Kalman 滤波（对数域）。"""

    def __init__(self, c: float, sigma_lw: float = SIGMA_W, sigma_a: float = SIGMA_A,
                 sigma_y: float = SIGMA_Z, a0: float = 0.01) -> None:
        self.log_c = float(np.log(max(c, 1e-6)))
        self.sigma_lw = sigma_lw
        self.sigma_a = sigma_a
        self.sigma_y = sigma_y
        self.x = np.array([np.log(W0), a0], dtype=float)
        self.P = np.diag([0.25 ** 2, (0.3 * a0) ** 2])
        self.F = np.array([[1.0, 1.0], [0.0, 1.0]])
        self.H = np.array([[1.0, 0.0]])

    def reset(self) -> None:
        pass

    def step(self, z_obs: float, dt: float = 1.0) -> None:
        Q = np.diag([(self.sigma_lw * np.sqrt(dt)) ** 2, (self.sigma_a * np.sqrt(dt)) ** 2])
        # 预测
        self.x = self.F @ self.x
        self.P = self.F @ self.P @ self.F.T + Q
        # 状态截断（与 PF 保持一致：a 恒正取下限，lw 限幅）
        self.x[1] = float(np.clip(self.x[1], A_MIN, 0.5))
        self.x[0] = float(np.clip(self.x[0], np.log(1e-4), np.log(5.0)))
        # 更新
        y_obs = float(np.log(max(z_obs - 1.0, Z_EPS)))
        resid = y_obs - (self.H @ self.x)[0] - self.log_c
        S = (self.H @ self.P @ self.H.T)[0, 0] + self.sigma_y ** 2
        K = (self.P @ self.H.T)[:, 0] / S
        self.x = self.x + K * resid
        self.P = self.P - np.outer(K, self.H @ self.P)[:, :]
        self.P = 0.5 * (self.P + self.P.T)  # 数值对称化
        self.x[1] = float(np.clip(self.x[1], A_MIN, 0.5))
        self.x[0] = float(np.clip(self.x[0], np.log(1e-4), np.log(5.0)))

    def estimate_rul(self) -> float:
        """线性 KF 只能给点估计：RUL = -E[lw] / E[a]。"""
        return float(np.clip((np.log(W_FAIL) - self.x[0]) / max(self.x[1], 1e-6), 0.0, 1e6))


def _quantile_rul(pf: SdeParticleFilter, q: float) -> float:
    """粒子云给出的 RUL 分位数（加权）。"""
    wts = np.exp(pf.log_weights - pf.log_weights.max())
    wts /= wts.sum()
    rul_i = (np.log(W_FAIL) - pf.lw) / np.clip(pf.a, 1e-6, None)
    rul_i = np.clip(rul_i, 0.0, 1e6)
    order = np.argsort(rul_i)
    cum = np.cumsum(wts[order])
    pos = int(min(np.searchsorted(cum, q), len(rul_i) - 1))
    return float(rul_i[order[pos]])


def metrics(y_true, y_pred):
    yt = np.asarray(y_true, float)
    yp = np.asarray(y_pred, float)
    mse = float(np.mean((yt - yp) ** 2))
    ss_res = float(np.sum((yt - yp) ** 2))
    ss_tot = float(np.sum((yt - yt.mean()) ** 2))
    return {
        "mse": round(mse, 4),
        "rmse": round(float(np.sqrt(mse)), 4),
        "mae": round(float(np.mean(np.abs(yt - yp))), 4),
        "r2": round(float(1 - ss_res / ss_tot) if ss_tot > 1e-12 else 0.0, 4),
        "n_points": int(len(yt)),
    }


def main() -> None:
    with open(RUL_FILE, encoding="utf-8") as f:
        bearings = json.load(f)["bearings"]

    all_true, all_pf, all_kf = [], [], []
    lo_list, hi_list = [], []
    per_bearing = []

    for b in bearings:
        series = b["series"]
        rms = np.array([p["rms"] for p in series], float)
        n = len(rms)
        if n < 30:
            continue
        base = rms[: max(3, int(n * BASELINE_FRAC))].mean()
        z = rms / base if base > 1e-9 else rms
        z_fail = condition_fail_level(bearings, b["id"], b["condition"])
        c = max(z_fail - 1.0, 0.5)
        t_prior = condition_life_prior(bearings, b["id"], b["condition"])
        a0 = float(np.log(W_FAIL / W0) / max(t_prior, 1.0))

        pf = SdeParticleFilter(c=c, seed=42, a0=a0)
        pf.reset()
        kf = LinearKalmanRUL(c=c, a0=a0)

        start = max(3, int(n * START_FRAC))
        if np.any(z > ONSET_Z):
            start = max(start, int(np.argmax(z > ONSET_Z)))

        actual = [(n - 1 - t) / (n - 1) for t in range(n)]
        for t in range(n):
            pf.step(float(z[t]))
            kf.step(float(z[t]))
            if t < start:
                continue
            lo = _quantile_rul(pf, 0.05)
            hi = _quantile_rul(pf, 0.95)
            med = pf.estimate_rul()
            steps = float(np.clip(med, 0.0, 1e6))
            rul_norm = steps / (t + steps) if steps > 0 else 0.0
            lo_n = lo / (t + lo) if lo > 0 else 0.0
            hi_n = hi / (t + hi) if hi > 0 else 0.0
            ksteps = kf.estimate_rul()
            k_norm = ksteps / (t + ksteps) if ksteps > 0 else 0.0

            all_true.append(actual[t])
            all_pf.append(float(np.clip(rul_norm, 0.0, 1.0)))
            all_kf.append(float(np.clip(k_norm, 0.0, 1.0)))
            lo_list.append(float(np.clip(lo_n, 0.0, 1.0)))
            hi_list.append(float(np.clip(hi_n, 0.0, 1.0)))

        yt = np.array(all_true[-max(1, n - start):])
        yp = np.array(all_pf[-max(1, n - start):])
        yk = np.array(all_kf[-max(1, n - start):])
        per_bearing.append({
            "id": b["id"],
            "condition": b["condition"],
            "lifetime": n,
            "start": int(start),
            "pf_r2": round(float(1 - np.sum((yt - yp) ** 2) / np.sum((yt - yt.mean()) ** 2)), 4),
            "kf_r2": round(float(1 - np.sum((yt - yk) ** 2) / np.sum((yt - yt.mean()) ** 2)), 4),
            "pf_rmse": round(float(np.sqrt(np.mean((yt - yp) ** 2))), 4),
            "kf_rmse": round(float(np.sqrt(np.mean((yt - yk) ** 2))), 4),
        })

    yt = np.asarray(all_true, float)
    lo = np.asarray(lo_list, float)
    hi = np.asarray(hi_list, float)
    inside = (yt >= lo) & (yt <= hi)

    payload = {
        "method": "对数域线性 Kalman 滤波 与 SDE-粒子滤波 的同构对比",
        "note": (
            "两者共用同一状态方程、噪声参数、观测方程、初始化与留一法协议；"
            "差异仅在于后验的表示方式（高斯矩 vs 粒子云）。"
        ),
        "metrics": {
            "sde_pf": metrics(all_true, all_pf),
            "kalman": metrics(all_true, all_kf),
        },
        "uncertainty": {
            "interval": "粒子云 RUL 的 [5%, 95%] 加权分位数区间",
            "picp": round(float(np.mean(inside)), 4),
            "mpiw": round(float(np.mean(hi - lo)), 4),
            "n_points": int(len(yt)),
        },
        "per_bearing": per_bearing,
    }
    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)

    m = payload["metrics"]
    u = payload["uncertainty"]
    print("=== KF vs PF ===")
    print(f"PF    : R2={m['sde_pf']['r2']} RMSE={m['sde_pf']['rmse']} MAE={m['sde_pf']['mae']} n={m['sde_pf']['n_points']}")
    print(f"Kalman: R2={m['kalman']['r2']} RMSE={m['kalman']['rmse']} MAE={m['kalman']['mae']} n={m['kalman']['n_points']}")
    print(f"PICP(90%)={u['picp']}  MPIW={u['mpiw']}")
    kf_win = sum(1 for p in per_bearing if p["kf_rmse"] < p["pf_rmse"])
    print(f"KF RMSE 更优的轴承数={kf_win}/{len(per_bearing)}")


if __name__ == "__main__":
    main()
