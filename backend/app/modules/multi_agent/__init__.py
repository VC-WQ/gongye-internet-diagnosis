"""模块5：多智能体会诊。

子模块：
- schemas      : FaultType(6类) 与 SensorWindow(多通道) 数据契约
- base         : AgentContext 与 BaseAgent 基类
- signal_tools : FFT 频谱 / 包络谱 / 特征频率提取（纯函数）
- signal_agent : 信号分析 Agent（包络谱特征频率判断）
- agents       : 物理残差 / 故障分类 / 决策 Agent 池
- service      : 多智能体会诊编排（consult）

当前基于 4 类单通道（CWRU）跑通，接口预留 6 类 + 6 通道扩展能力。
"""
from . import signal_tools  # noqa: F401
from .agents import (  # noqa: F401
    DecisionAgent,
    FaultDiagnosisAgent,
    PhysicalResidualAgent,
    build_agent_pool,
)
from .base import AgentContext, BaseAgent  # noqa: F401
from .chairman import Chairman  # noqa: F401
from .graph import ConsultationGraph, consultation_graph, run_consultation  # noqa: F401
from .knowledge_agent import KnowledgeAgent  # noqa: F401
from .schemas import (  # noqa: F401
    FAULT_TYPE_AVAILABILITY,
    FAULT_TYPE_LABELS_ZH,
    AgentResult,
    ConsultResult,
    FaultType,
    SensorWindow,
)
from .service import MultiAgentService, multi_agent_service  # noqa: F401
from .signal_agent import SignalAnalysisAgent  # noqa: F401

__all__ = [
    "FaultType",
    "FAULT_TYPE_LABELS_ZH",
    "FAULT_TYPE_AVAILABILITY",
    "SensorWindow",
    "AgentResult",
    "ConsultResult",
    "AgentContext",
    "BaseAgent",
    "SignalAnalysisAgent",
    "PhysicalResidualAgent",
    "FaultDiagnosisAgent",
    "KnowledgeAgent",
    "DecisionAgent",
    "Chairman",
    "build_agent_pool",
    "ConsultationGraph",
    "consultation_graph",
    "run_consultation",
    "MultiAgentService",
    "multi_agent_service",
]