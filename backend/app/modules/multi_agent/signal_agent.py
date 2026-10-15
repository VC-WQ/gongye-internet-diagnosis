"""信号分析 Agent：FFT 频谱 + 包络谱特征频率提取。

基于 CWRU 驱动端单通道振动（12kHz），提取轴承特征频率
（BPFO / BPFI / BSF / 2×BSF），通过包络谱峰值显著度给出信号证据。

信号处理逻辑全部委托给 signal_tools（纯函数），本 Agent 仅负责编排与
结果组装。故障类型最终由决策 Agent 综合 CNN 判定，本 Agent 提供交叉验证
证据（dominant_peak 与 signal_reliability）。
"""
from __future__ import annotations

import numpy as np

from . import signal_tools
from .base import AgentContext, BaseAgent
from .llm_client import llm_client
from .schemas import FAULT_TYPE_LABELS_ZH, AgentResult

# 主导峰 -> 故障类型映射（供 chairman / decision 交叉验证使用）
DOMINANT_TO_FAULT = {
    "BPFO": "outer_race",
    "BPFI": "inner_race",
    "BSF": "ball",
    "2xBSF": "ball",
    "none": "normal",
}

# 信号可靠性 -> 信号证据置信度
_RELIABILITY_CONFIDENCE = {"high": 0.85, "medium": 0.60, "low": 0.40}


class SignalAnalysisAgent(BaseAgent):
    """信号分析 Agent：提取包络谱特征频率并给出信号证据。"""

    role = "signal_analyst"
    name = "信号分析 Agent"

    def analyze(self, ctx: AgentContext) -> AgentResult:
        window = ctx.sensor_window
        vib = window.channel("vibration")

        if not vib:
            return AgentResult(
                agent_role=self.role,
                agent_name=self.name,
                conclusion="无振动信号，无法进行信号分析",
                fault_type="normal",
                confidence=0.0,
                evidence="无振动通道数据",
                details={"signal_evidence": {"signal_reliability": "low", "dominant_peak": "none"}},
            )

        x = np.asarray(vib, dtype=np.float64)
        fs = signal_tools.SAMPLE_RATE
        rpm = signal_tools.resolve_rpm(window)

        # FFT 频谱与包络谱（用于 details 展示）
        spectrum = signal_tools.compute_spectrum(x, fs)
        envelope = signal_tools.compute_envelope_spectrum(x, fs)

        # 信号证据提取（重构后的判据）
        evidence = signal_tools.extract_signal_evidence(x, fs, rpm)

        dominant_peak = evidence["dominant_peak"]
        reliability = evidence["signal_reliability"]
        fault_type = DOMINANT_TO_FAULT.get(dominant_peak, "normal")
        label = FAULT_TYPE_LABELS_ZH.get(fault_type, fault_type)
        confidence = _RELIABILITY_CONFIDENCE.get(reliability, 0.40)

        # 结论文本
        if dominant_peak == "none":
            conclusion = "包络谱无显著特征频率峰值，提示正常工况"
        else:
            freq = evidence["peaks"][dominant_peak]["freq"]
            conclusion = (
                f"包络谱在 {dominant_peak}={freq}Hz 处出现显著峰值，"
                f"提示{label}（信号可靠性 {reliability}）"
            )

        # LLM 解读（失败降级为模板结论）
        if dominant_peak != "none":
            peak_freq = evidence["peaks"][dominant_peak]["freq"]
            llm_text = llm_client.chat(
                "你是振动信号分析专家，只负责把特征频率数据解读为自然语言，"
                "不要计算、不要编造数据。",
                f"包络谱分析结果：主导特征峰 {dominant_peak}（{peak_freq}Hz），"
                f"信号可靠性 {reliability}，初步指向{label}。请用 2-3 句通俗语言解读该信号证据。",
            )
            if llm_text:
                conclusion = llm_text

        details = {
            "rpm": rpm,
            "horsepower": window.horsepower,
            "spectrum_peaks": spectrum["peaks"],
            "envelope_peaks": envelope["peaks"],
            "signal_evidence": evidence,
        }

        return AgentResult(
            agent_role=self.role,
            agent_name=self.name,
            conclusion=conclusion,
            fault_type=fault_type,
            confidence=round(confidence, 4),
            evidence=" | ".join(evidence["evidence"]),
            details=details,
        )


__all__ = ["SignalAnalysisAgent", "DOMINANT_TO_FAULT"]