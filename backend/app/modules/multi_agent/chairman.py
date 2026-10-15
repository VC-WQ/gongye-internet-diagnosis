"""会诊主席：检测各诊断 Agent 之间的结论冲突。

检测两类冲突：
1. 信号主导峰（dominant_peak）与 CNN 分类是否指向同一故障类型；
2. 物理残差严重度（residual_severity）与健康分等级（health_level）是否一致。

输出结构化冲突信息，供决策 Agent 决定以哪个结论为主。
"""
from __future__ import annotations

from .base import AgentContext
from .schemas import AgentResult
from .signal_agent import DOMINANT_TO_FAULT

# 物理残差严重度 -> 期望健康分等级
_SEVERITY_TO_LEVEL = {"normal": "healthy", "mild": "warning", "severe": "abnormal"}


def _find(agent_results: list[AgentResult], role: str) -> AgentResult | None:
    """从 Agent 结论列表中按 role 查找。"""
    for r in agent_results:
        if r.agent_role == role:
            return r
    return None


class Chairman:
    """会诊主席：负责冲突检测与裁决建议。"""

    def detect(self, ctx: AgentContext, agent_results: list[AgentResult]) -> dict:
        cnn = ctx.anomaly.get("cnn") or {}
        health = ctx.anomaly.get("health") or {}
        cnn_fault = str(cnn.get("fault_type", "normal"))
        health_level = str(health.get("health_level", "healthy"))

        signal_result = _find(agent_results, "signal_analyst")
        physics_result = _find(agent_results, "physical_residual")

        conflicts: list[str] = []

        # 冲突1：信号主导峰 vs CNN 分类
        if signal_result is not None:
            signal_evidence = signal_result.details.get("signal_evidence") or {}
            dominant = signal_evidence.get("dominant_peak", "none")
            reliability = signal_evidence.get("signal_reliability", "low")
            signal_fault = DOMINANT_TO_FAULT.get(dominant, "normal")
            # 仅当信号证据可靠（非 low）且确有主导峰时参与冲突判定
            if reliability != "low" and dominant != "none" and signal_fault != cnn_fault:
                conflicts.append(
                    f"信号主导峰 {dominant} 指向 {signal_fault}，与 CNN 分类 {cnn_fault} 不一致"
                )

        # 冲突2：物理残差严重度 vs 健康分等级
        if physics_result is not None:
            severity = physics_result.details.get("residual_severity", "normal")
            expected_level = _SEVERITY_TO_LEVEL.get(severity)
            if expected_level is not None and expected_level != health_level:
                conflicts.append(
                    f"物理残差严重度 {severity} 与健康分等级 {health_level} 不一致"
                )

        conflict_detected = len(conflicts) > 0
        resolution = self._resolve(conflicts, cnn_fault)

        return {
            "conflict_detected": conflict_detected,
            "conflicts": conflicts,
            "resolution": resolution,
        }

    @staticmethod
    def _resolve(conflicts: list[str], cnn_fault: str) -> str:
        if not conflicts:
            return "各诊断 Agent 结论一致，无需仲裁"
        return (
            f"检测到 {len(conflicts)} 处冲突，以 CNN 分类结果（{cnn_fault}）为主判断，"
            f"其余证据作为交叉验证参考"
        )


__all__ = ["Chairman"]