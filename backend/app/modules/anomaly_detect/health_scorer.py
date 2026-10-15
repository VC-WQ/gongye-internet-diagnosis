"""健康评分引擎。

综合 PINN 物理残差与 1D-CNN 分类结果，输出 0-100 健康分与健康等级：

    正常   > 85 分
    预警   60 ~ 85 分
    异常   < 60 分

评分逻辑：
1. 物理一致性分数(pinn_score)：残差越小越健康，用相对残差 + 指数衰减映射到 0-100
2. 分类健康分数(cnn_score)：正常类别置信度直接映射到 0-100
3. 加权综合：health = w_pinn * pinn_score + w_cnn * cnn_score
"""
from __future__ import annotations

import logging
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

# 健康分级阈值
HEALTHY_THRESHOLD = 85.0
WARNING_THRESHOLD = 60.0

# 各通道残差归一化基准（用于相对残差计算，避免量纲差异导致的偏置）
# vibration 基准已用训练后的 PINN 实测标定：
#   Normal 残差 RMS ≈ 0.019，故障残差 RMS ≈ 0.13~0.42（分离度 ~15x）
#   取 0.4 使 Normal 的 pinn_score ≈ 95，故障显著下降。
RESIDUAL_SCALE = {
    "vibration": 0.4,
    "temperature": 10.0,
    "current": 1.0,
    "pressure": 0.5,
    "speed": 50.0,
    "acoustic": 5.0,
}


def _clamp_score(value: float) -> float:
    """将分数裁剪到 [0, 100]。"""
    return float(max(0.0, min(100.0, value)))


class HealthScorer:
    """健康评分引擎。"""

    def __init__(self, weight_pinn: float = 0.5, weight_cnn: float = 0.5) -> None:
        self.weight_pinn = weight_pinn
        self.weight_cnn = weight_cnn

    # ------------------------------------------------------------------
    # 主评分入口
    # ------------------------------------------------------------------
    def score(
        self, pinn_result: Optional[dict] = None, cnn_result: Optional[dict] = None
    ) -> dict:
        """综合 PINN 残差与 CNN 分类结果计算健康分。

        Args:
            pinn_result: PinnResidualGenerator.predict_window 的返回（含 mean_residual）
            cnn_result: FaultClassifier.classify 的返回（含 probabilities）

        Returns:
            health_score / health_level / pinn_score / cnn_score / level_label
        """
        pinn_score = self._pinn_score(pinn_result)
        cnn_score = self._cnn_score(cnn_result)

        if pinn_result is None and cnn_result is None:
            health = 100.0
        elif pinn_result is None:
            health = cnn_score
        elif cnn_result is None:
            health = pinn_score
        else:
            health = self.weight_pinn * pinn_score + self.weight_cnn * cnn_score

        health = _clamp_score(health)
        level, label = self.classify_level(health)

        return {
            "health_score": round(health, 2),
            "health_level": level,  # healthy / warning / abnormal
            "level_label": label,   # 正常 / 预警 / 异常
            "pinn_score": round(pinn_score, 2),
            "cnn_score": round(cnn_score, 2),
        }

    # ------------------------------------------------------------------
    # 子分数计算
    # ------------------------------------------------------------------
    def _pinn_score(self, pinn_result: Optional[dict]) -> float:
        """由 PINN 残差计算物理一致性分数（残差越小分数越高）。

        兼容两种输入：
        - 新统一入口 compute_residual 返回 {"residual": float}
        - 旧接口返回 {"mean_residual": {"vibration": float}}
        """
        if not pinn_result:
            return 100.0
        residual = pinn_result.get("residual")
        if residual is None:
            mean_residual = pinn_result.get("mean_residual")
            if isinstance(mean_residual, dict):
                residual = mean_residual.get("vibration")
        if residual is None:
            return 100.0
        scale = RESIDUAL_SCALE.get("vibration", 1.0)
        # 指数衰减：残差接近 0 时分数趋近 100，残差增大时快速下降
        return 100.0 * float(np.exp(-abs(float(residual)) / max(scale, 1e-6)))

    def _cnn_score(self, cnn_result: Optional[dict]) -> float:
        """由 CNN 分类结果计算健康分数（正常置信度映射）。"""
        if not cnn_result:
            return 100.0
        probs = cnn_result.get("probabilities") or {}
        normal_prob = probs.get("normal", 1.0)
        # 正常类别置信度直接作为健康度
        return 100.0 * float(normal_prob)

    # ------------------------------------------------------------------
    # 分级
    # ------------------------------------------------------------------
    @staticmethod
    def classify_level(health_score: float) -> tuple[str, str]:
        """按分数返回健康等级与中文标签。"""
        if health_score > HEALTHY_THRESHOLD:
            return "healthy", "正常"
        if health_score >= WARNING_THRESHOLD:
            return "warning", "预警"
        return "abnormal", "异常"


health_scorer = HealthScorer()