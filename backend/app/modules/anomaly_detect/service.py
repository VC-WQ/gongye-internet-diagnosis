"""PINN + 1D-CNN 异常检测服务：串联物理残差、故障分类与健康评分。"""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np

from .cnn_classifier import SEQ_LEN, cnn_classifier
from .health_scorer import health_scorer
from .pinn_residual import pinn_residual_generator

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# CNN 输入构造
# ---------------------------------------------------------------------------
def convert_to_cnn_input(window: list[dict]) -> Optional[np.ndarray]:
    """从传感器窗口提取振动序列，构造 CNN 输入 (1, 1, 2048)。

    兼容字段名：vibration（扁平或 observations 嵌套）与 CWRU 原始通道名 DE。
    长度不足补零，超过 2048 取最近 2048 点。
    """
    def _vibration(rec) -> Optional[float]:
        if not isinstance(rec, dict):
            return None
        for key in ("vibration", "DE"):
            if isinstance(rec.get(key), (int, float)):
                return float(rec[key])
        obs = rec.get("observations")
        if isinstance(obs, dict):
            for key in ("vibration", "DE"):
                if isinstance(obs.get(key), (int, float)):
                    return float(obs[key])
        return None

    if not window:
        return None
    vib: list[float] = []
    for rec in window:
        v = _vibration(rec)
        if v is not None:
            vib.append(v)
    if not vib:
        return None
    arr = np.asarray(vib, dtype=np.float32)
    if arr.shape[0] >= SEQ_LEN:
        arr = arr[-SEQ_LEN:]
    else:
        arr = np.pad(arr, (0, SEQ_LEN - arr.shape[0]))
    return arr.reshape(1, 1, SEQ_LEN)


class AnomalyDetectService:
    """PINN + 1D-CNN 异常检测服务。

    流程：传感器窗口 -> PINN 物理残差 + 1D-CNN 故障分类 -> 健康评分。
    """

    def __init__(self) -> None:
        self.pinn = pinn_residual_generator
        self.cnn = cnn_classifier
        self.scorer = health_scorer

    # ------------------------------------------------------------------
    # 主检测入口
    # ------------------------------------------------------------------
    def detect(self, device_id: str, window: list[dict]) -> dict:
        """对设备时间窗口数据进行异常检测。

        Args:
            device_id: 设备 ID
            window: 传感器窗口数据（list[dict]，每条含振动/温度/电流/压力/转速等）

        Returns:
            device_id / pinn(pinn残差) / cnn(分类结果) / health(健康评分)
        """
        # 1. PINN 物理残差（统一入口：训练模型优先，失败降级）
        pinn_result = self.pinn.compute_residual(window)

        # 2. 1D-CNN 故障分类（真实 2048 点窗口推理）
        cnn_result = self.cnn.classify(convert_to_cnn_input(window))

        # 3. 健康评分
        health = self.scorer.score(pinn_result, cnn_result)

        result = {
            "device_id": device_id,
            "pinn": pinn_result,
            "cnn": cnn_result,
            "health": health,
            "cnn_source": cnn_result.get("cnn_source"),
            "pinn_source": pinn_result.get("pinn_source"),
        }
        logger.info(
            "设备 %s 异常检测完成：健康分=%.2f (%s) 故障=%s 置信度=%.3f",
            device_id,
            health["health_score"],
            health["level_label"],
            cnn_result["fault_label"],
            cnn_result["confidence"],
        )
        return result

    # ------------------------------------------------------------------
    # 便捷方法
    # ------------------------------------------------------------------
    def compute_anomaly_score(self, window: list[dict]) -> float:
        """计算综合异常分数（0~1，健康分数取反）。"""
        pinn = self.pinn.compute_residual(window)
        cnn = self.cnn.classify(convert_to_cnn_input(window))
        health = self.scorer.score(pinn, cnn)
        return round((100.0 - health["health_score"]) / 100.0, 4)

    def physical_residual(self, sample: dict) -> dict:
        """计算单条样本的物理残差（PINN 约束）。"""
        return self.pinn.predict(sample)


anomaly_detect_service = AnomalyDetectService()