"""物理频率先验引导的 1D-CNN（FP-CNN）—— 技术增量：数据驱动 × 物理知识 的特征级结合。

动机
----
原 FaultCNN 为纯数据驱动黑箱；轴承故障的物理知识（理论特征频率 BPFO/BPFI/BSF/FTF）
在**另一个 Agent 里单独计算**，两者仅在决策层"投票"拼接，并未真正结合。

本模块把物理先验**嵌入网络内部**，实现特征级融合：
1. 由轴承几何参数解析计算四类理论特征频率（外圈/内圈/滚动体/保持架）；
2. 以这些频率为中心构造**可学习的高斯频带**（中心偏移与带宽可微调）；
3. 频带响应同时用于：
   - 生成频域掩码，对输入信号做物理频带增强（抑制无关频段）；
   - 提取 4 维**频带能量特征**，与卷积特征拼接后送入分类器；
4. 训练后可将"学到的频带中心"与"理论频率"对照可视化 —— 提供可解释性证据。

因为先验频带是"软"的（可学习且带残差 1.0），网络既能利用物理先验，
又保留从数据中偏离先验的能力，不会因先验不准而受损。

轴承几何（CWRU 驱动端 SKF-6205 深沟球轴承）
    滚珠数 n=9, 滚珠直径 d=7.94mm, 节径 D=39.04mm
    BPFO = n/2·(1-d/D)·fr      外圈
    BPFI = n/2·(1+d/D)·fr      内圈
    BSF  = D/(2d)·(1-(d/D)²)·fr 滚动体
    FTF  = 1/2·(1-d/D)·fr      保持架
"""
from __future__ import annotations

import math

import numpy as np

try:  # PyTorch 可选依赖：缺失时本模块仅提供频率计算（不实例化网络）
    import torch
    import torch.nn as nn

    _HAS_TORCH = True
except Exception:  # pragma: no cover
    torch = None  # type: ignore
    nn = None  # type: ignore
    _HAS_TORCH = False


# ---------------------------------------------------------------------------
# 轴承理论特征频率（与 multi_agent/signal_tools 保持同一套几何参数）
# ---------------------------------------------------------------------------
N_BALLS = 9
BALL_DIAM_MM = 7.94
PITCH_DIAM_MM = 39.04


def theoretical_frequencies(shaft_rpm: float = 1797.0) -> dict[str, float]:
    """计算四类轴承理论特征频率（Hz）。"""
    fr = shaft_rpm / 60.0
    ratio = BALL_DIAM_MM / PITCH_DIAM_MM
    return {
        "BPFO": N_BALLS / 2.0 * (1.0 - ratio) * fr,
        "BPFI": N_BALLS / 2.0 * (1.0 + ratio) * fr,
        "BSF": (PITCH_DIAM_MM / (2.0 * BALL_DIAM_MM)) * (1.0 - ratio ** 2) * fr,
        "FTF": 0.5 * (1.0 - ratio) * fr,
    }


def normalized_centers(shaft_rpm: float = 1797.0, fs: float = 12000.0) -> list[float]:
    """理论频率归一化到 [0, 0.5]（rfft 频率轴），作为频带中心初值。"""
    f = theoretical_frequencies(shaft_rpm)
    return [f["BPFO"] / fs, f["BPFI"] / fs, f["BSF"] / fs, f["FTF"] / fs]


BAND_ORDER = ("BPFO", "BPFI", "BSF", "FTF")

# 频带能量特征缩放系数：把"相对频带能量占比"（O(0.1)）放大到与卷积特征同量级（O(1)），
# 避免 4 维物理特征因量纲过小而在分类器中被 128 维卷积特征淹没。
ENERGY_SCALE = 10.0


# ---------------------------------------------------------------------------
# 物理频率先验层
# ---------------------------------------------------------------------------
if _HAS_TORCH:

    class PhysicsFrequencyPrior(nn.Module):
        """可学习的轴承特征频率先验层。

        输入  (B, 1, L) 时域振动
        输出  (x_enh, energy)
            x_enh  (B, 1, L) 频带增强后的时域信号（送 CNN 主干）
            energy (B, 4)    四个物理频带的能量特征（送分类器拼接）
        """

        def __init__(
            self,
            fs: float = 12000.0,
            shaft_rpm: float = 1797.0,
            # 归一化带宽初值 0.0012（12kHz 下约 14Hz）：窄于相邻特征频率间隔，
            # 保证四个频带在初始化时互不重叠，否则它们会退化为"同一段低频能量"而失去物理选择性。
            init_bandwidth: float = 0.0012,
        ) -> None:
            super().__init__()
            centers = normalized_centers(shaft_rpm, fs)
            self.fs = fs
            self.shaft_rpm = shaft_rpm
            # 频带中心（可学习，初值=理论频率；训练中允许小幅偏移以适应实际工况）
            self.centers = nn.Parameter(torch.tensor(centers, dtype=torch.float32))
            # 频带带宽（对数参数化保证恒正）
            self.log_bandwidth = nn.Parameter(
                torch.log(torch.tensor([init_bandwidth] * 4, dtype=torch.float32))
            )
            # 各频带增强强度（可学习，初值 1）
            self.band_gain = nn.Parameter(torch.ones(4, dtype=torch.float32))
            self.theory_centers = torch.tensor(centers, dtype=torch.float32)

        def forward(self, x):
            length = x.shape[-1]
            spec = torch.fft.rfft(x, dim=-1)          # (B,1,F) 复数
            mag = spec.abs()                          # (B,1,F)
            n_freq = mag.shape[-1]
            freq_axis = torch.linspace(0.0, 0.5, n_freq, device=x.device, dtype=x.dtype)

            # 频带中心钳制在 [0, 0.5]：归一化频率不允许为负（物理约束）
            centers = self.centers.clamp(0.0, 0.5)
            # 带宽上限 0.02（12kHz 下约 240Hz），避免频带退化成"全通"而失去物理选择性
            bandwidth = torch.exp(self.log_bandwidth).clamp(1e-4, 0.02)
            # 高斯频带响应 (4, F)
            resp = torch.exp(
                -0.5
                * ((freq_axis.unsqueeze(0) - centers.unsqueeze(1)) / bandwidth.unsqueeze(1)) ** 2
            )

            # 1) 频带能量特征 (B, 4)：各理论频率处的**相对**能量占比。
            #    必须除以全频带总能量做归一化 —— 否则绝对谱幅值可达数百量级，
            #    与 O(1) 的卷积特征量纲失配，会把 4 维物理特征变成噪声并拖垮训练。
            raw_energy = torch.einsum("bcf,kf->bck", mag, resp).squeeze(1)   # (B,4) 绝对能量
            total_energy = mag.sum(dim=-1)                                    # (B,1) 全频带总能量
            energy = raw_energy / (total_energy + 1e-8) * ENERGY_SCALE        # (B,4) 相对占比

            # 2) 频域掩码：以 1.0 为基底 + 可学习增益的频带增强（软先验）
            mask = 1.0 + torch.einsum("k,kf->f", torch.relu(self.band_gain), resp)
            spec_enh = spec * mask.unsqueeze(0).unsqueeze(0)
            x_enh = torch.fft.irfft(spec_enh, n=length, dim=-1)

            return x_enh, energy

        @torch.no_grad()
        def learned_vs_theory(self) -> dict[str, dict[str, float]]:
            """返回"学到的频带中心 vs 理论频率"对照（Hz），用于可解释性展示。"""
            out: dict[str, dict[str, float]] = {}
            # 与 forward 一致：展示钳制后的频带中心（保证物理上非负）
            centers = self.centers.detach().clamp(0.0, 0.5).cpu().numpy()
            theory = self.theory_centers.detach().cpu().numpy()
            for i, name in enumerate(BAND_ORDER):
                out[name] = {
                    "theory_hz": round(float(theory[i] * self.fs), 2),
                    "learned_hz": round(float(centers[i] * self.fs), 2),
                    "bandwidth_hz": round(float(math.exp(float(self.log_bandwidth[i])) * self.fs), 2),
                    "gain": round(float(self.band_gain[i]), 3),
                }
            return out

    class FPFaultCNN(nn.Module):
        """物理频率先验引导的故障分类器（基线 FaultCNN + PhysicsFrequencyPrior）。

        输入 (B, 1, 2048) → 输出 (B, 4)
        """

        def __init__(self, n_channels: int = 1, n_classes: int = 4, fs: float = 12000.0) -> None:
            super().__init__()
            self.prior = PhysicsFrequencyPrior(fs=fs)
            self.conv = nn.Sequential(
                nn.Conv1d(n_channels, 32, kernel_size=15, stride=1, padding=7),
                nn.BatchNorm1d(32),
                nn.ReLU(),
                nn.MaxPool1d(2),  # 2048 -> 1024
                nn.Conv1d(32, 64, kernel_size=9, padding=4),
                nn.BatchNorm1d(64),
                nn.ReLU(),
                nn.MaxPool1d(2),  # 1024 -> 512
                nn.Conv1d(64, 128, kernel_size=5, padding=2),
                nn.BatchNorm1d(128),
                nn.ReLU(),
                nn.AdaptiveAvgPool1d(1),  # 512 -> 1
            )
            # 128 维卷积特征 + 4 维物理频带能量
            self.classifier = nn.Sequential(
                nn.Flatten(),
                nn.Dropout(0.3),
                nn.Linear(128 + 4, n_classes),
            )

        def forward(self, x):
            x_enh, energy = self.prior(x)
            feat = self.conv(x_enh)             # (B,128,1)
            feat = torch.cat([feat, energy.unsqueeze(-1)], dim=1)  # (B,132,1)
            return self.classifier(feat)


__all__ = [
    "theoretical_frequencies",
    "normalized_centers",
    "PhysicsFrequencyPrior",
    "FPFaultCNN",
    "BAND_ORDER",
]
