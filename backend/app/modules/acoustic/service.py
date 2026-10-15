"""多模态声音融合模块：融合声学与振动信号到诊断流程。

声学信号与振动信号是同源（同一旋转机械）的两个模态：
  - 振动：固体结构传振，早期故障特征敏感
  - 声学：空气传声，声压级随振动增大而升高
二者融合可提升诊断的鲁棒性与可解释性（互为印证）。
"""
from __future__ import annotations

import numpy as np


class AcousticService:
    """声学信号处理服务。"""

    def extract_features(self, audio: bytes, sample_rate: int) -> list[float]:
        """从原始音频字节提取时域/频域特征。

        假设输入为 16-bit 单声道 PCM 原始样本。返回 6 维特征向量：
        [RMS能量, 过零率, 频谱质心, 峰值频率, 标准差, 峰值幅值]。
        """
        arr = np.frombuffer(audio, dtype=np.int16).astype(np.float32) / 32768.0
        if arr.size == 0:
            return []
        rms = float(np.sqrt(np.mean(arr ** 2)))
        zcr = float(np.mean(np.abs(np.diff(np.sign(arr)))) / 2.0)
        spec = np.abs(np.fft.rfft(arr))
        freqs = np.fft.rfftfreq(arr.size, 1.0 / sample_rate)
        centroid = float(np.sum(freqs * spec) / (np.sum(spec) + 1e-9))
        peak_freq = float(freqs[int(np.argmax(spec))])
        return [
            round(rms, 4),
            round(zcr, 4),
            round(centroid, 2),
            round(peak_freq, 2),
            round(float(np.std(arr)), 4),
            round(float(np.max(np.abs(arr))), 4),
        ]

    def spectrum(self, device_id: str) -> dict:
        """返回模拟的声学频谱热力图数据（演示版）。

        生成「频率 × 时间」二维频谱矩阵，供前端 ECharts heatmap 渲染。
        用 device_id 做稳定种子，保证同一设备结果一致；特征峰模拟
        轴承故障相关频段（1.2kHz 转频区 + 3.6kHz 特征频区）。
        """
        n_freq, n_time = 64, 64
        freqs = np.linspace(0, 6000, n_freq)
        seed = sum((i + 1) * ord(c) for i, c in enumerate(device_id)) % (2**31)
        rng = np.random.RandomState(seed)
        spectrum = np.zeros((n_time, n_freq))
        for t in range(n_time):
            spectrum[t] = (
                0.5 * np.exp(-((freqs - 1200) / 300) ** 2)
                + 0.35 * np.exp(-((freqs - 3600) / 200) ** 2)
                + rng.uniform(0.0, 0.15, n_freq)
            )
        return {
            "device_id": device_id,
            "freq": [round(float(f), 1) for f in freqs],
            "time": list(range(n_time)),
            "spectrum": spectrum.round(4).tolist(),
            "coherence": round(0.86 + (seed % 10) / 100, 3),  # 声学与振动吻合度（演示值）
        }

    def fuse(self, vibration_features: list[float], acoustic_features: list[float]) -> dict:
        """振动与声学特征融合（多模态）。

        将两路特征对齐后加权融合，并计算跨模态一致性（余弦相似度）
        与融合异常分数。一致性越高，说明两路信号越"彼此印证"，诊断越可信。
        """
        v = np.asarray([float(x) for x in vibration_features], dtype=float)
        a = np.asarray([float(x) for x in acoustic_features], dtype=float)
        if v.size == 0 or a.size == 0:
            return {
                "fused_features": [],
                "cross_modal_agreement": 0.0,
                "anomaly_score": 0.0,
            }

        n = max(v.size, a.size)

        def _pad(x: np.ndarray) -> np.ndarray:
            out = np.zeros(n)
            out[: x.size] = x
            return out

        v, a = _pad(v), _pad(a)

        # 同源信号相关性强，故振动权重略高于声学
        fused = 0.6 * v + 0.4 * a
        denom = (np.linalg.norm(v) * np.linalg.norm(a)) or 1.0
        agreement = float(np.dot(v, a) / denom)
        anomaly_score = float(np.mean(np.abs(fused)))

        return {
            "fused_features": [round(float(x), 4) for x in fused],
            "cross_modal_agreement": round(agreement, 4),
            "anomaly_score": round(anomaly_score, 4),
        }

    @staticmethod
    def _series_features(series: list[float]) -> list[float]:
        """从一段信号序列提取 5 维统计特征（均值/RMS/峰值/标准差/平均差分）。"""
        if not series or len(series) < 2:
            return []
        arr = np.asarray([float(x) for x in series], dtype=float)
        return [
            round(float(np.mean(arr)), 4),
            round(float(np.sqrt(np.mean(arr ** 2))), 4),
            round(float(np.max(arr)), 4),
            round(float(np.std(arr)), 4),
            round(float(np.mean(np.abs(np.diff(arr)))), 4),
        ]

    def fuse_device(self, window: list[dict]) -> dict:
        """融合某设备实时窗口内的振动与声学两路信号。

        从窗口提取振动/声学序列 → 各自统计特征 → 跨模态融合，
        返回跨模态一致性与融合异常分数（一致性越高，诊断越可信）。
        """
        vib = [r.get("vibration") for r in window if isinstance(r.get("vibration"), (int, float))]
        acu = [r.get("acoustic") for r in window if isinstance(r.get("acoustic"), (int, float))]
        vib_feats = self._series_features(vib)
        acu_feats = self._series_features(acu)
        fusion = self.fuse(vib_feats, acu_feats)
        fusion["vibration_features"] = vib_feats
        fusion["acoustic_features"] = acu_feats
        return fusion


acoustic_service = AcousticService()