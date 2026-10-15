# -*- coding: utf-8 -*-
"""数字孪生 SDE + 粒子滤波的剩余寿命(RUL)预测 —— 与基线方法的对比评估。

技术增量说明
------------
基线方法（原实现）：「健康指标退化建模 + 指数外推」
    - 用历史窗口拟合指数增长率后直接外推
    - 对局部噪声极敏感，单个异常点即可让外推发散
    - 在本数据集上评估为 R² = -0.478（差于均值基线）

本方法：数字孪生 SDE + 粒子滤波（Particle Filter）
    - 将**退化量**与**退化速率**同时作为隐状态，用随机微分方程(SDE)描述其演化
      * 状态方程来自退化机理：磨损呈自加速增长（正反馈），故 dw/dt = a·w
      * 该机理约束相当于给数据驱动的估计加了物理正则，抑制噪声导致的发散
    - 用粒子滤波在线估计状态后验（含退化速率 a），自动适应不同工况与个体差异
    - 由首穿时间（w 达到失效阈值）解析外推 RUL，输出剩余寿命而非单点拟合值
    - 状态设计（磨损/速率）与数字孪生模块的隐状态（磨损/热积累/效率）同源

状态方程（Euler-Maruyama 离散，dt=1 个采样间隔）
    w_{k+1} = w_k + a_k · w_k · dt + σ_w · sqrt(dt) · ξ
    a_{k+1} = a_k                        + σ_a · sqrt(dt) · ξ   （随机游走自适应）

观测方程
    z_k = 1 + c · w_k + ε,   ε ~ N(0, σ_z)
    其中 z = RMS / RMS_baseline（相对健康基线的放大倍数）

RUL 外推（首穿时间）
    w(t) = w_0 · exp(a·t)  →  w(T_fail) = 1  →  RUL = ln(1 / w_0) / a

评估协议
    留一法：预测某根轴承时，失效阈值由其**同工况其他轴承**的末期水平确定，
    绝不泄露该轴承自身的未来信息；从寿命 20% 处开始逐步预测。

用法
    python scripts/rul_sde_pf.py
输出
    backend/app/data/rul_sde_pf.json
"""
from __future__ import annotations

import json
import os

import numpy as np

BASE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC_FILE = os.path.join(BASE, "backend", "app", "data", "xjtu_rul.json")
OUT_FILE = os.path.join(BASE, "backend", "app", "data", "rul_sde_pf.json")

# 粒子滤波超参数
N_PARTICLES = 300
SIGMA_W = 0.020      # 退化量过程噪声
SIGMA_A = 0.0040     # 退化速率过程噪声（需足够大，才能在退化突变期快速自适应）
SIGMA_Z = 0.060      # 观测噪声
W0 = 0.010           # 初始磨损量
A0 = 0.010           # 初始退化速率
A_MIN = 2e-3         # 退化速率下限（防止 RUL ∝ 1/a 重尾爆炸）
W_FAIL = 1.0         # 失效阈值（磨损量归一化）
Z_EPS = 1e-2         # 对数观测下限：z-1 小于该值时按"退化极微"处理

START_FRAC = 0.20    # 不早于寿命 20% 处开始预测
ONSET_Z = 1.15       # 退化起始判据：RMS 超过健康基线 1.15 倍后才启动 RUL 预测
                     # （工程上合理：设备尚未表现出可观测退化时，预测无依据）
BASELINE_FRAC = 0.05  # 健康基线取前 5% 均值


# ---------------------------------------------------------------------------
# 粒子滤波 RUL 预测器
# ---------------------------------------------------------------------------
class SdeParticleFilter:
    """基于 SDE 状态方程 + 粒子滤波的在线 RUL 预测器。

    状态取**磨损量的对数** lw = ln(w)（几何布朗运动的标准形式）：

        lw_{k+1} = lw_k + a_k·dt + σ_lw·sqrt(dt)·ξ
        a_{k+1}  = a_k                + σ_a·sqrt(dt)·ξ

    在对数域建模的好处：
      1. 指数退化 w(t)=w₀·e^{at} 在 log 域是**线性**的，状态方程精确匹配；
      2. 观测动态范围大（RMS 放大倍数 1→10 倍），log 域观测噪声更接近同方差；
      3. 数值稳定，w 恒正由构造保证，无需截断。

    观测方程（log 域）：
        y_k = ln(z_k - 1) = lw_k + ln(c) + ε,   ε ~ N(0, σ_y)

    首穿时间（w 达到 W_FAIL=1，即 lw 达到 0）：
        RUL = (ln(W_FAIL) - lw) / a = -lw / a
    """

    def __init__(
        self,
        c: float,
        n_particles: int = N_PARTICLES,
        sigma_w: float = SIGMA_W,
        sigma_a: float = SIGMA_A,
        sigma_z: float = SIGMA_Z,
        seed: int = 42,
        a0: float | None = None,
    ) -> None:
        self.c = c
        self.log_c = float(np.log(max(c, 1e-6)))
        self.n = n_particles
        self.sigma_lw = sigma_w      # 对数域过程噪声
        self.sigma_a = sigma_a
        self.sigma_y = sigma_z       # 对数域观测噪声
        # a0 可由「同工况设备的寿命先验」解析给出：a0 = ln(W_FAIL/W0)/T_prior。
        # 早期（尚无退化观测）预测退化为群体寿命先验，随后由个体观测逐步修正。
        self.a0 = float(a0) if a0 is not None else A0
        self.rng = np.random.default_rng(seed)
        self.lw = np.full(n_particles, np.log(W0))
        self.a = np.full(n_particles, self.a0)
        self.log_weights = np.zeros(n_particles)

    def reset(self) -> None:
        self.lw = np.log(W0) + 0.25 * self.rng.standard_normal(self.n)
        self.a = np.clip(
            self.a0 * (1.0 + 0.3 * self.rng.standard_normal(self.n)), A_MIN, None
        )
        self.log_weights = np.zeros(self.n)

    def _resample_if_needed(self) -> None:
        """有效样本数过低时做系统重采样，避免粒子退化。"""
        wts = np.exp(self.log_weights - self.log_weights.max())
        wts /= wts.sum()
        ess = 1.0 / np.sum(wts ** 2)
        if ess < self.n / 3.0:
            positions = (self.rng.random(self.n) + np.arange(self.n)) / self.n
            cumsum = np.cumsum(wts)
            idx = np.searchsorted(cumsum, positions)
            idx = np.clip(idx, 0, self.n - 1)
            self.lw = self.lw[idx]
            self.a = self.a[idx]
            self.log_weights = np.zeros(self.n)

    def step(self, z_obs: float, dt: float = 1.0) -> None:
        """推进一个采样间隔：状态传播 -> 观测更新 -> 必要时重采样。"""
        sq = np.sqrt(dt)
        # 状态传播（对数域 SDE，Euler-Maruyama）
        self.lw = self.lw + self.a * dt + self.sigma_lw * sq * self.rng.standard_normal(self.n)
        self.a = self.a + self.sigma_a * sq * self.rng.standard_normal(self.n)
        # 退化速率恒正（单调退化假设）；下限 A_MIN 不能过小，
        # 否则 RUL ∝ 1/a 会产生重尾，使估计严重偏高。
        self.a = np.clip(self.a, A_MIN, 0.5)
        # w 的合理范围 [1e-4, 5] 对应 lw ∈ [ln1e-4, ln5]
        self.lw = np.clip(self.lw, np.log(1e-4), np.log(5.0))

        # 观测更新（对数域）：y = ln(z-1) ~ N(lw + ln c, σ_y)
        # z-1 用下限截断：z<1 表示尚未偏离健康基线，此时观测视为"退化极小"
        y_obs = float(np.log(max(z_obs - 1.0, Z_EPS)))
        residual = y_obs - (self.lw + self.log_c)
        self.log_weights += -0.5 * (residual / self.sigma_y) ** 2
        self.log_weights -= self.log_weights.max()   # 数值稳定
        self._resample_if_needed()

    def estimate_rul(self) -> float:
        """由当前状态粒子估计剩余寿命（采样点数）。

        RUL_i = ln(W_FAIL / w_i) / a_i。

        注意：这里必须取**加权中位数**而非加权均值。因为 RUL_i 关于 a 是
        双曲型（RUL ∝ 1/a），当个别粒子的 a 趋近下限时 RUL_i 会爆炸，
        少量极小权重粒子即可把加权均值拉高数倍（重尾失真）。
        加权中位数对这类重尾稳健。
        """
        wts = np.exp(self.log_weights - self.log_weights.max())
        wts /= wts.sum()
        # ln(W_FAIL) = ln(1) = 0，故 RUL = (0 - lw)/a = -lw/a
        rul_i = (np.log(W_FAIL) - self.lw) / np.clip(self.a, 1e-6, None)
        rul_i = np.clip(rul_i, 0.0, 1e6)
        order = np.argsort(rul_i)
        cum = np.cumsum(wts[order])
        pos = np.searchsorted(cum, 0.5)
        pos = int(min(pos, len(rul_i) - 1))
        return float(rul_i[order[pos]])


# ---------------------------------------------------------------------------
# 基线方法：健康指标退化建模 + 指数外推（原实现的等价复现）
# ---------------------------------------------------------------------------
def baseline_predict(z_hist: np.ndarray, t_hist: np.ndarray, z_fail: float, window: int = 50) -> float:
    """基线：对 ln(z-1) 做局部线性回归得增长率 â，再指数外推到 z_fail。

    这正是原实现「健康指标退化建模 + 指数外推」的做法：
    对局部噪声敏感，窗口内出现回落时 â 甚至可能为负，导致外推发散。
    """
    z = z_hist[-window:]
    t = t_hist[-window:]
    y = np.log(np.clip(z - 1.0, 1e-6, None))
    if len(y) < 3:
        return float("nan")
    # 线性拟合 y = k·t + b
    t_mean, y_mean = t.mean(), y.mean()
    denom = np.sum((t - t_mean) ** 2)
    if denom < 1e-9:
        return float("nan")
    k = np.sum((t - t_mean) * (y - y_mean)) / denom
    if k <= 1e-9:      # 增长率非正 -> 无法外推
        return float("nan")
    z_now = float(z[-1])
    if z_now >= z_fail:
        return 0.0
    return float(np.log((z_fail - 1.0) / max(z_now - 1.0, 1e-6)) / k)


# ---------------------------------------------------------------------------
# 评估主流程
# ---------------------------------------------------------------------------
def condition_fail_level(bearings: list[dict], exclude_id: str, condition: str) -> float:
    """同工况其他轴承的末期放大倍数中位数（留一法，避免泄露自身信息）。"""
    levels = []
    for b in bearings:
        if b["id"] == exclude_id or b["condition"] != condition:
            continue
        rms = np.array([p["rms"] for p in b["series"]], dtype=float)
        if len(rms) < 10:
            continue
        base = rms[: max(3, int(len(rms) * BASELINE_FRAC))].mean()
        end = rms[-max(3, int(len(rms) * BASELINE_FRAC)) :].mean()
        if base > 1e-9:
            levels.append(end / base)
    return float(np.median(levels)) if levels else 6.0


def condition_life_prior(bearings: list[dict], exclude_id: str, condition: str) -> float:
    """同工况其他轴承的寿命中位数（留一法），作为该设备的**寿命先验**。

    工程含义：同一工况（转速×载荷）下的同类设备，其全寿命存在统计规律。
    在没有个体退化观测之前，最合理的预测就是群体先验；
    随着个体观测累积，粒子滤波会把预测逐步修正到该个体的真实退化速率上。
    """
    lives = [
        len(b["series"])
        for b in bearings
        if b["id"] != exclude_id and b["condition"] == condition
    ]
    return float(np.median(lives)) if lives else 200.0


def evaluate(bearings: list[dict]) -> dict:
    curves = []
    all_true: list[float] = []
    all_pf: list[float] = []
    all_base: list[float] = []

    for b in bearings:
        series = b["series"]
        rms = np.array([p["rms"] for p in series], dtype=float)
        n = len(rms)
        if n < 30:
            continue

        # 健康基线：前 5% 采样均值
        base = rms[: max(3, int(n * BASELINE_FRAC))].mean()
        z = rms / base if base > 1e-9 else rms

        # 失效阈值（留一法，取自同工况其他轴承）
        z_fail = condition_fail_level(bearings, b["id"], b["condition"])
        c = max(z_fail - 1.0, 0.5)

        # 由同工况寿命先验解析初始化退化速率：
        #   a0 = ln(W_FAIL/W0) / T_prior  →  初始预测 RUL ≈ T_prior（群体先验）
        t_prior = condition_life_prior(bearings, b["id"], b["condition"])
        a0 = float(np.log(W_FAIL / W0) / max(t_prior, 1.0))
        pf = SdeParticleFilter(c=c, seed=42, a0=a0)
        pf.reset()

        # 预测起点：既不早于寿命 START_FRAC，也不早于"退化起始点"（z 首次超过 ONSET_Z）
        start = max(3, int(n * START_FRAC))
        if np.any(z > ONSET_Z):
            start = max(start, int(np.argmax(z > ONSET_Z)))
        pred_pf: list[float | None] = []
        pred_base: list[float | None] = []

        for t in range(n):
            pf.step(float(z[t]))
            if t < start:
                pred_pf.append(None)
                pred_base.append(None)
                continue
            # --- SDE + PF 预测 ---
            # 说明：曾尝试在总寿命层面融合「同工况寿命先验」与「个体外推」，
            # 但本数据集同工况内寿命差异可达 10 倍以上（如 40Hz10kN 组 114~2538），
            # 群体中位数先验反而引入更大偏差（R² 由 -0.46 恶化到 -1.05）。
            # 故群体先验只用于**初始化退化速率 a0**，后续完全交由个体观测更新。
            rul_steps = pf.estimate_rul()
            rul_norm = rul_steps / (t + rul_steps) if rul_steps > 0 else 0.0
            pred_pf.append(round(float(np.clip(rul_norm, 0.0, 1.0)), 4))

            # --- 基线预测 ---
            bsteps = baseline_predict(z[: t + 1], np.arange(t + 1), z_fail)
            if np.isnan(bsteps):
                pred_base.append(None)
            else:
                bnorm = bsteps / (t + bsteps) if bsteps > 0 else 0.0
                pred_base.append(round(float(np.clip(bnorm, 0.0, 1.0)), 4))

        # 真实 RUL（与 xjtu_rul.json 保持同一口径）
        actual = [round(float(p["rul"]), 4) for p in series]

        # 收集有效预测点用于整体指标
        for t in range(start, n):
            all_true.append(actual[t])
            all_pf.append(pred_pf[t] if pred_pf[t] is not None else 0.0)
            all_base.append(pred_base[t] if pred_base[t] is not None else 0.0)

        curves.append(
            {
                "id": b["id"],
                "condition": b["condition"],
                "actual": actual,
                "sde_pf": pred_pf,
                "baseline": pred_base,
            }
        )

    def metrics(y_true: list[float], y_pred: list[float]) -> dict:
        yt = np.array(y_true, dtype=float)
        yp = np.array(y_pred, dtype=float)
        mse = float(np.mean((yt - yp) ** 2))
        rmse = float(np.sqrt(mse))
        mae = float(np.mean(np.abs(yt - yp)))
        ss_res = float(np.sum((yt - yp) ** 2))
        ss_tot = float(np.sum((yt - yt.mean()) ** 2))
        r2 = 1.0 - ss_res / ss_tot if ss_tot > 1e-12 else 0.0
        return {
            "mse": round(mse, 4),
            "rmse": round(rmse, 4),
            "mae": round(mae, 4),
            "r2": round(float(r2), 4),
            "n_points": int(len(yt)),
        }

    return {
        "method": "数字孪生 SDE + 粒子滤波（磨损自加速状态方程 + 在线速率估计）",
        "baseline_method": "健康指标退化建模 + 指数外推（原实现）",
        "metrics": {
            "sde_pf": metrics(all_true, all_pf),
            "baseline": metrics(all_true, all_base),
        },
        "curves": curves,
        "config": {
            "n_particles": N_PARTICLES,
            "sigma_lw": SIGMA_W,
            "sigma_a": SIGMA_A,
            "sigma_y": SIGMA_Z,
            "start_frac": START_FRAC,
            "onset_z": ONSET_Z,
            "note": (
                "留一法确定失效阈值（同工况其他轴承），不使用被预测轴承自身的未来信息；"
                "预测起点取「不早于寿命 20%」且「不早于退化起始点（RMS 超基线 1.15 倍）」；"
                "状态取磨损量对数（几何布朗运动形式），观测取 ln(RMS 放大倍数-1)。"
            ),
        },
    }


def main() -> None:
    with open(SRC_FILE, encoding="utf-8") as f:
        data = json.load(f)
    bearings = data.get("bearings", [])
    print(f"载入 {len(bearings)} 根轴承，开始评估 ...")

    result = evaluate(bearings)

    os.makedirs(os.path.dirname(OUT_FILE), exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    m = result["metrics"]
    print("\n===== RUL 预测评估结果 =====")
    print(f"基线（指数外推） : R²={m['baseline']['r2']:.4f}  RMSE={m['baseline']['rmse']:.4f}  MAE={m['baseline']['mae']:.4f}")
    print(f"SDE+粒子滤波     : R²={m['sde_pf']['r2']:.4f}  RMSE={m['sde_pf']['rmse']:.4f}  MAE={m['sde_pf']['mae']:.4f}")
    print(f"评估点数: {m['sde_pf']['n_points']}")
    print(f"\n输出: {OUT_FILE}")
    print(f"体积: {os.path.getsize(OUT_FILE)/1024:.1f} KB")


if __name__ == "__main__":
    main()
