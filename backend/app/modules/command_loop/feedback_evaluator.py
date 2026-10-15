"""模块7 诊断效果闭环（闭环1）：恢复曲线对比式反馈评估。

升级自模块6 简单版（health_score > 85 判断），保留原有 evaluate 语义，
新增曲线级评估：

- predict_recovery_curve：简化 PINN 线性恢复曲线预测
- evaluate_recovery：实际曲线 vs 预测曲线，输出判定与偏差
- start_observation：假观察期计时器，新增 curve_provider 回调注入实际曲线

偏差判定（相对于恢复目标健康分做归一化）：
    < 15%  -> recovered（diagnosis_confirmed=True）
    15~30% -> extend（延长观察期一次）
    > 30%  -> relapsed（trigger_rediagnosis=True / diagnosis_confirmed=False）
"""
from __future__ import annotations

import logging
import threading
from typing import Callable, Optional

logger = logging.getLogger(__name__)

RECOVERY_THRESHOLD = 85.0       # 恢复目标健康分
OBSERVATION_INTERVAL = 5.0      # 采样间隔（秒），语义占位，实际曲线由外部注入
DEVIATION_CONFIRM = 0.15        # 偏差 <15% 判定诊断确认
DEVIATION_REDIAGNOSIS = 0.30    # 偏差 >30% 判定需再诊断


class FeedbackEvaluator:
    """反馈评估器：恢复曲线对比 + 观察期计时。"""

    def __init__(
        self,
        recovery_threshold: float = RECOVERY_THRESHOLD,
        observation_interval: float = OBSERVATION_INTERVAL,
    ) -> None:
        self.recovery_threshold = recovery_threshold
        self.observation_interval = observation_interval

    # ------------------------------------------------------------------
    # 单点兼容入口（模块6 原语义：health_score 是否回升 > 阈值）
    # ------------------------------------------------------------------
    def evaluate(self, health_score: float) -> bool:
        """单点判定是否恢复（保留模块6 原签名语义）。"""
        return float(health_score) > self.recovery_threshold

    # ------------------------------------------------------------------
    # 闭环1 曲线级评估
    # ------------------------------------------------------------------
    def predict_recovery_curve(
        self,
        current_health: float,
        recovery_target: Optional[float] = None,
        steps: int = 5,
    ) -> list[float]:
        """简化 PINN 预测恢复曲线：当前值线性回升到恢复目标。

        Args:
            current_health: 观察期起始健康分。
            recovery_target: 恢复目标（默认 85）。
            steps: 采样点数（与实际曲线等长）。

        Returns:
            线性插值的预测曲线，长度 == steps，首点=current_health，末点=target。
        """
        target = recovery_target if recovery_target is not None else self.recovery_threshold
        steps = max(int(steps), 2)
        return [
            float(current_health) + (float(target) - float(current_health)) * i / (steps - 1)
            for i in range(steps)
        ]

    def evaluate_recovery(
        self,
        actual_curve: list[float],
        recovery_target: Optional[float] = None,
    ) -> dict:
        """对比实际恢复曲线与预测曲线，输出判定。

        Args:
            actual_curve: 实际健康分采样序列（每5秒一点，验收注入）。
            recovery_target: 恢复目标（默认 85）。

        Returns:
            {
                deviation_pct, verdict, diagnosis_confirmed, trigger_rediagnosis,
                actual_curve, predicted_curve,
            }
        """
        target = recovery_target if recovery_target is not None else self.recovery_threshold
        if not actual_curve:
            return self._verdict(1.0, [], [], "relapsed")

        predicted = self.predict_recovery_curve(
            float(actual_curve[0]), target, steps=len(actual_curve)
        )
        # 逐点归一化绝对偏差（相对恢复目标），再取均值
        total_abs = sum(abs(float(a) - p) for a, p in zip(actual_curve, predicted))
        deviation = total_abs / (float(target) * len(actual_curve)) if target else 1.0

        if deviation < DEVIATION_CONFIRM:
            verdict = "recovered"
        elif deviation > DEVIATION_REDIAGNOSIS:
            verdict = "relapsed"
        else:
            verdict = "extend"

        return self._verdict(deviation, actual_curve, predicted, verdict)

    @staticmethod
    def _verdict(
        deviation: float,
        actual_curve: list[float],
        predicted_curve: list[float],
        verdict: str,
    ) -> dict:
        """组装判定结果。"""
        return {
            "deviation_pct": round(deviation * 100, 2),
            "verdict": verdict,                                        # recovered / extend / relapsed
            "diagnosis_confirmed": verdict == "recovered",
            "trigger_rediagnosis": verdict == "relapsed",
            "actual_curve": [float(v) for v in actual_curve],
            "predicted_curve": [float(v) for v in predicted_curve],
        }

    # ------------------------------------------------------------------
    # 假观察期（curve_provider 注入实际曲线，不做真实数据采集）
    # ------------------------------------------------------------------
    @staticmethod
    def start_observation(
        callback: Callable[[list[float]], None],
        duration_seconds: float = 30.0,
        curve_provider: Optional[Callable[[], list[float]]] = None,
    ):
        """启动假观察期计时器。

        duration_seconds 后调用 curve_provider 采集实际恢复曲线，并把曲线
        传入 callback 供后续 evaluate_recovery 使用。

        Args:
            callback: 收到实际曲线后执行的回调，签名 callback(actual_curve)。
            duration_seconds: 观察期时长（假计时，默认 30 秒）。
            curve_provider: 实际曲线提供者，无返回默认 []。

        Returns:
            threading.Timer 实例（daemon）。
        """
        def _fire() -> None:
            curve = curve_provider() if curve_provider else []
            callback(curve)

        timer = threading.Timer(duration_seconds, _fire)
        timer.daemon = True
        timer.start()
        return timer


feedback_evaluator = FeedbackEvaluator()