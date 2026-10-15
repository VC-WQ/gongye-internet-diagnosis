"""信号分析工具：FFT 频谱 + 包络谱 + 轴承特征频率提取。

面向 CWRU 驱动端单通道振动数据（采样率 12kHz）。

核心能力：
1. FFT 频谱（去直流 + Hanning 窗 + 单边幅值谱 + 主峰）
2. 包络谱（hilbert 包络 -> 去均值 -> Hanning -> rfft 零填充）
3. 轴承特征频率匹配（BPFO / BPFI / BSF / 2×BSF）
4. 基于特征频率峰值显著度的故障类型判断

转速解析优先级：rpm > horsepower 推算 > 默认 0HP(1797rpm)。
"""
from __future__ import annotations

from typing import Optional

import numpy as np
from scipy.signal import find_peaks, hilbert

from .schemas import SensorWindow

# CWRU 驱动端采样率（Hz）
SAMPLE_RATE = 12000.0

# SKF 6205 轴承特征频率系数（乘以转频 fr）
K_BPFO = 3.5848   # 外圈故障 BPFO
K_BPFI = 5.4152   # 内圈故障 BPFI
K_BSF = 2.3567    # 滚动体自旋频率 BSF
K_FTF = 0.3983    # 保持架 FTF

# horsepower -> 转速(rpm) 映射（CWRU 驱动端 0/1/2/3 HP）
RPM_BY_HORSEPOWER: dict[int, float] = {0: 1797.0, 1: 1772.0, 2: 1750.0, 3: 1730.0}
DEFAULT_RPM = 1797.0  # 0 HP


# ---------------------------------------------------------------------------
# 转速解析
# ---------------------------------------------------------------------------
def rpm_from_horsepower(hp: Optional[int]) -> float:
    """由马力映射到转速(rpm)，未知取值回退到默认 0HP。"""
    if hp is None:
        return DEFAULT_RPM
    try:
        return RPM_BY_HORSEPOWER.get(int(hp), DEFAULT_RPM)
    except (TypeError, ValueError):
        return DEFAULT_RPM


def resolve_rpm(sensor_window: SensorWindow) -> float:
    """统一解析转速：rpm > horsepower 推算 > 默认 0HP(1797rpm)。"""
    if sensor_window.rpm is not None:
        return float(sensor_window.rpm)
    if sensor_window.horsepower is not None:
        return rpm_from_horsepower(sensor_window.horsepower)
    return DEFAULT_RPM


def bearing_fault_frequencies(rpm: float) -> dict[str, float]:
    """由转速计算轴承理论特征频率（Hz）。

    返回：fr(转频) / bpfo / bpfi / bsf / bsf2x(2×BSF) / ftf。
    """
    fr = rpm / 60.0
    return {
        "fr": fr,
        "bpfo": K_BPFO * fr,
        "bpfi": K_BPFI * fr,
        "bsf": K_BSF * fr,
        "bsf2x": 2.0 * K_BSF * fr,
        "ftf": K_FTF * fr,
    }


# ---------------------------------------------------------------------------
# 频谱计算
# ---------------------------------------------------------------------------
def _single_sided_spectrum(
    x: np.ndarray,
    fs: float,
    nfft: Optional[int] = None,
) -> tuple[np.ndarray, np.ndarray]:
    """去直流 + Hanning + rfft 单边幅值谱（窗相干增益校正）。

    Returns:
        (freqs, magnitudes)
    """
    x = np.asarray(x, dtype=np.float64)
    n_win = x.shape[0]
    if nfft is None:
        nfft = n_win
    x = x - x.mean()          # 去直流
    w = np.hanning(n_win)
    xw = x * w
    X = np.fft.rfft(xw, n=nfft)
    freqs = np.fft.rfftfreq(nfft, 1.0 / fs)
    sum_w = float(w.sum())
    mag = np.abs(X) * 2.0 / max(sum_w, 1e-12)  # 单边幅值（窗增益校正）
    mag[0] /= 2.0            # DC 分量不需 ×2
    if nfft % 2 == 0:
        mag[-1] /= 2.0       # Nyquist 分量不需 ×2
    return freqs, mag


def _envelope_magnitudes(x: np.ndarray, fs: float, nfft: int) -> tuple[np.ndarray, np.ndarray]:
    """hilbert 包络 -> 去均值 -> Hanning -> rfft 零填充，返回 (freqs, mag)。"""
    x = np.asarray(x, dtype=np.float64)
    envelope = np.abs(hilbert(x))
    envelope = envelope - envelope.mean()
    return _single_sided_spectrum(envelope, fs, nfft=nfft)


def _top_peaks(
    freqs: np.ndarray,
    mag: np.ndarray,
    top_n: int,
    min_freq: float = 1.0,
) -> list[dict]:
    """从幅值谱中提取前 top_n 个局部峰（排除 DC 附近的低频成分）。"""
    mask = freqs >= min_freq
    if not mask.any():
        return []
    f = freqs[mask]
    m = mag[mask]
    idxs, _ = find_peaks(m, distance=1)
    if len(idxs) == 0:
        idxs = np.argsort(m)[-top_n:][::-1]
    order = idxs[np.argsort(m[idxs])[::-1]]
    peaks: list[dict] = []
    for i in order[:top_n]:
        peaks.append({
            "frequency": round(float(f[i]), 3),
            "amplitude": round(float(m[i]), 5),
        })
    return peaks


# ---------------------------------------------------------------------------
# 对外接口
# ---------------------------------------------------------------------------
def compute_spectrum(x: np.ndarray, fs: float, top_n: int = 5) -> dict:
    """FFT 频谱：返回频域坐标、幅值谱与主峰列表。"""
    freqs, mag = _single_sided_spectrum(x, fs)
    return {
        "frequencies": freqs.tolist(),
        "magnitudes": mag.tolist(),
        "peaks": _top_peaks(freqs, mag, top_n),
    }


def compute_envelope_spectrum(
    x: np.ndarray,
    fs: float,
    nfft: int = 16384,
    top_n: int = 5,
) -> dict:
    """包络谱：返回频域坐标、包络幅值谱与前 top_n 峰。"""
    freqs, mag = _envelope_magnitudes(x, fs, nfft)
    return {
        "frequencies": freqs.tolist(),
        "magnitudes": mag.tolist(),
        "peaks": _top_peaks(freqs, mag, top_n),
    }


def find_characteristic_peaks(
    x: np.ndarray,
    fs: float,
    rpm: float,
    nfft: int = 16384,
    tol: float = 3.0,
) -> dict:
    """在包络谱中匹配各轴承特征频率的实测峰值。

    Args:
        x: 振动序列
        fs: 采样率
        rpm: 转速（用于计算理论特征频率）
        nfft: 零填充点数（分辨率 = fs/nfft）
        tol: 特征频率匹配容差（Hz）

    Returns:
        dict: 含 rpm/fr/noise_floor 与 bpfo/bpfi/bsf/bsf2x 各峰的
        {theoretical, measured, amplitude, deviation_pct}，以及
        bsf_effective（bsf 与 2×bsf 中幅值大者）与 bsf_harmonic。
    """
    freqs, mag = _envelope_magnitudes(x, fs, nfft)
    theo = bearing_fault_frequencies(rpm)
    # 噪声基线：包络谱总能量归一化（替代全局 median）
    total_energy = float(np.sum(mag))
    noise_floor = float(np.median(mag)) / max(total_energy, 1e-12)

    result: dict = {
        "rpm": round(float(rpm), 1),
        "fr": round(theo["fr"], 4),
        "noise_floor": round(noise_floor, 6),
    }

    for key in ("bpfo", "bpfi", "bsf", "bsf2x"):
        f_theo = float(theo[key])
        lo, hi = f_theo - tol, f_theo + tol
        mask = (freqs >= lo) & (freqs <= hi)
        if mask.any():
            local_idx = int(np.argmax(mag[mask]))
            global_idx = int(np.where(mask)[0][local_idx])
            measured = float(freqs[global_idx])
            amp = float(mag[global_idx])
        else:
            measured = f_theo
            amp = 0.0
        dev = abs(measured - f_theo) / f_theo * 100.0 if f_theo else 0.0
        result[key] = {
            "theoretical": round(f_theo, 3),
            "measured": round(measured, 3),
            "amplitude": round(amp, 6),
            "deviation_pct": round(dev, 3),
        }

    # 球故障取 1×BSF 与 2×BSF 中幅值大者，并标注谐波阶次
    if result["bsf2x"]["amplitude"] >= result["bsf"]["amplitude"]:
        result["bsf_effective"] = dict(result["bsf2x"])
        result["bsf_harmonic"] = "2x"
    else:
        result["bsf_effective"] = dict(result["bsf"])
        result["bsf_harmonic"] = "1x"
    return result


def extract_signal_evidence(
    x: np.ndarray,
    fs: float,
    rpm: float,
    nfft: int = 16384,
    tol: float = 3.0,
    mag_threshold: float = 0.05,
) -> dict:
    """从包络谱提取信号证据（特征频率峰值 + 显著度 + 可靠性）。

    与旧版 classify_from_peaks 的区别：
    - 不再用全局 median 噪声地板判断显著性（过于脆弱），改用归一化后的
      绝对幅值阈值（mag_threshold）。
    - 不做 IR 边带 / Ball 谐波族扩展（这两类由 CNN 负责）。
    - 输出主导峰、各特征频率实测数据、显著度比值与可靠性等级。

    Returns:
        {
          "dominant_peak": "BPFO|BPFI|BSF|2xBSF|none",
          "peaks": {"BPFO": {...}, "BPFI": {...}, "BSF": {...}, "2xBSF": {...}},
          "significance_ratio": float,
          "evidence": [str],
          "signal_reliability": "high|medium|low",
        }
    """
    cp = find_characteristic_peaks(x, fs, rpm, nfft=nfft, tol=tol)
    eps = 1e-9

    # 四个候选特征频率（BSF 与 2×BSF 独立看待）
    peak_order = [("BPFO", "bpfo"), ("BPFI", "bpfi"), ("BSF", "bsf"), ("2xBSF", "bsf2x")]

    peaks: dict = {}
    for label, key in peak_order:
        p = cp[key]
        magnitude = float(p["amplitude"])
        peaks[label] = {
            "freq": p["measured"],
            "theoretical": p["theoretical"],
            "deviation_pct": p["deviation_pct"],
            "magnitude": round(magnitude, 6),
            "significant": magnitude >= mag_threshold,
        }

    # 主导 / 次主导
    ordered = sorted(peak_order, key=lambda lk: cp[lk[1]]["amplitude"], reverse=True)
    dom_label, dom_key = ordered[0]
    second_key = ordered[1][1]
    dom_mag = float(cp[dom_key]["amplitude"])
    second_mag = float(cp[second_key]["amplitude"])
    significance_ratio = dom_mag / (second_mag + eps)

    # 主导峰判定：幅值<阈值视为无显著峰
    if dom_mag < mag_threshold:
        dominant_peak = "none"
        signal_reliability = "low"
    else:
        dominant_peak = dom_label
        if significance_ratio > 2.0:
            signal_reliability = "high"
        elif significance_ratio >= 1.2:
            signal_reliability = "medium"
        else:
            signal_reliability = "low"

    # 证据列表
    evidence: list[str] = []
    for label, key in peak_order:
        p = cp[key]
        evidence.append(
            f"{label}={p['measured']}Hz 幅值{p['amplitude']}"
            f"（理论{p['theoretical']}Hz，偏差{p['deviation_pct']}%）"
        )

    return {
        "dominant_peak": dominant_peak,
        "peaks": peaks,
        "significance_ratio": round(significance_ratio, 4),
        "evidence": evidence,
        "signal_reliability": signal_reliability,
    }


__all__ = [
    "SAMPLE_RATE",
    "DEFAULT_RPM",
    "RPM_BY_HORSEPOWER",
    "rpm_from_horsepower",
    "resolve_rpm",
    "bearing_fault_frequencies",
    "compute_spectrum",
    "compute_envelope_spectrum",
    "find_characteristic_peaks",
    "extract_signal_evidence",
]