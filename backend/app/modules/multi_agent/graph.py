"""模块5 会诊编排（LangGraph StateGraph）。

状态用 ConsultState(TypedDict) 定义，节点流：
    normalize -> detect(模块4) -> [signal, physics, knowledge] 并行
    -> chairman -> decision -> assemble

优先使用 langgraph StateGraph 编排；若未安装（或构建失败）则回退为
纯 Python 顺序调用。两种路径共享同一组节点函数与状态契约。
"""
from __future__ import annotations

from dataclasses import asdict
from typing import Any, TypedDict

from app.modules.anomaly_detect.service import anomaly_detect_service

from .agents import DecisionAgent, FaultDiagnosisAgent, PhysicalResidualAgent
from .base import AgentContext
from .chairman import Chairman
from .knowledge_agent import KnowledgeAgent
from .schemas import (
    FAULT_TYPE_LABELS_ZH,
    AgentResult,
    ConsultResult,
    SensorWindow,
)
from .signal_agent import SignalAnalysisAgent
from .vision_agent import VisionInspectionAgent

try:  # langgraph 可选依赖
    from langgraph.graph import END, START, StateGraph

    _HAS_LANGGRAPH = True
except ImportError:  # pragma: no cover
    _HAS_LANGGRAPH = False


class ConsultState(TypedDict, total=False):
    """会诊编排状态（LangGraph State 契约）。"""

    device_id: str
    window: Any                      # 原始输入窗口（list[dict] / SensorWindow）
    sensor_window: SensorWindow      # 归一化后的多通道窗口
    ctx: AgentContext                # 会诊共享上下文
    anomaly: dict                    # 模块4 异常检测结果
    vision: dict                     # 部件表面视觉检测结果（可选，第五路证据）
    signal_result: AgentResult       # 信号分析 Agent 结论
    physics_result: AgentResult      # 物理残差 Agent 结论
    knowledge_result: AgentResult    # 知识检索 Agent 结论
    vision_result: AgentResult       # 视觉检测 Agent 结论（第五路证据）
    agent_results: list              # 各诊断 Agent 结论列表
    chairman_result: dict            # 会诊主席冲突检测结果
    decision: AgentResult            # 决策 Agent 结论
    result: dict                     # 最终会诊结果（ConsultResult asdict）


def _to_sensor_window(window: Any) -> SensorWindow:
    """将外部窗口归一化为 SensorWindow（兼容 list[dict] / dict / SensorWindow）。"""
    if isinstance(window, SensorWindow):
        return window
    if isinstance(window, dict):
        window = [window]
    if isinstance(window, list):
        return SensorWindow.from_records(window)
    return SensorWindow(vibration=[])


class ConsultationGraph:
    """LangGraph 风格的多智能体会诊编排图。

    节点函数遵循 LangGraph 规范：入参为完整 state，返回本次节点产出的
    部分 state（键级合并），便于并行节点正确汇聚。
    """

    def __init__(self) -> None:
        self.signal_agent = SignalAnalysisAgent()
        self.physics_agent = PhysicalResidualAgent()
        self.fault_agent = FaultDiagnosisAgent()
        self.knowledge_agent = KnowledgeAgent()
        self.vision_agent = VisionInspectionAgent()
        self.chairman = Chairman()
        self.decision_agent = DecisionAgent()

        # 注册的会诊 Agent 池（供状态查询/展示）
        self.agents = [
            self.signal_agent,
            self.physics_agent,
            self.fault_agent,
            self.knowledge_agent,
            self.vision_agent,
        ]

        # 顺序回退用的节点顺序（与 LangGraph 拓扑一致）
        self._node_sequence = [
            self._normalize,
            self._detect,
            self._signal,
            self._physics,
            self._knowledge,
            self._vision,
            self._chairman,
            self._decision,
            self._assemble,
        ]

        self._compiled = self._build_graph() if _HAS_LANGGRAPH else None

    # ------------------------------------------------------------------
    # 节点函数（返回部分 state，供 LangGraph 键级合并）
    # ------------------------------------------------------------------
    @staticmethod
    def _normalize(state: ConsultState) -> ConsultState:
        return {"sensor_window": _to_sensor_window(state["window"])}

    @staticmethod
    def _detect(state: ConsultState) -> ConsultState:
        records = state["sensor_window"].to_records()
        anomaly = anomaly_detect_service.detect(state["device_id"], records)
        # 部件表面视觉检测结果（若提供）并入 anomaly，供视觉 Agent 与 D-S 融合消费
        vision = state.get("vision")
        if vision:
            anomaly["vision"] = vision
        ctx = AgentContext(
            device_id=state["device_id"],
            sensor_window=state["sensor_window"],
            anomaly=anomaly,
        )
        return {"anomaly": anomaly, "ctx": ctx}

    def _signal(self, state: ConsultState) -> ConsultState:
        return {"signal_result": self.signal_agent.analyze(state["ctx"])}

    def _physics(self, state: ConsultState) -> ConsultState:
        return {"physics_result": self.physics_agent.analyze(state["ctx"])}

    def _knowledge(self, state: ConsultState) -> ConsultState:
        return {"knowledge_result": self.knowledge_agent.analyze(state["ctx"])}

    def _vision(self, state: ConsultState) -> ConsultState:
        """视觉检测 Agent（第五路证据）：部件表面损伤识别。"""
        return {"vision_result": self.vision_agent.analyze(state["ctx"])}

    def _chairman(self, state: ConsultState) -> ConsultState:
        # 四路证据并行汇聚：组装完整 agent_results（含 CNN 分类透传）
        agent_results = [
            state["signal_result"],
            state["physics_result"],
            state["knowledge_result"],
            state.get("vision_result"),
            self.fault_agent.analyze(state["ctx"]),
        ]
        agent_results = [r for r in agent_results if r is not None]
        chairman_result = self.chairman.detect(state["ctx"], agent_results)
        return {"agent_results": agent_results, "chairman_result": chairman_result}

    def _decision(self, state: ConsultState) -> ConsultState:
        decision = self.decision_agent.decide(
            state["ctx"], state["agent_results"], state.get("chairman_result")
        )
        return {"decision": decision}

    @staticmethod
    def _assemble(state: ConsultState) -> ConsultState:
        decision = state["decision"]
        chairman_result = state["chairman_result"] or {
            "conflicts": [],
            "conflict_detected": False,
        }
        anomaly = state["anomaly"] or {}
        health = anomaly.get("health") or {}
        report = decision.details.get("report") or {}

        result = ConsultResult(
            device_id=state["device_id"],
            fault_type=decision.fault_type,
            fault_label=FAULT_TYPE_LABELS_ZH.get(decision.fault_type, decision.fault_type),
            confidence=decision.confidence,
            health_score=float(health.get("health_score", 100.0)),
            health_level=str(health.get("health_level", "healthy")),
            level_label=str(health.get("level_label", "正常")),
            available_channels=state["sensor_window"].available_channels,
            agent_results=state["agent_results"] + [decision],
            recommendation=report.get("recommendation", ""),
            report=report,
            conflicts=chairman_result["conflicts"],
            conflict_detected=chairman_result["conflict_detected"],
        )
        return {"result": asdict(result)}

    # ------------------------------------------------------------------
    # 图构建与运行
    # ------------------------------------------------------------------
    def _build_graph(self):
        """构建 LangGraph StateGraph。"""
        g = StateGraph(ConsultState)
        g.add_node("normalize", self._normalize)
        g.add_node("detect", self._detect)
        g.add_node("signal", self._signal)
        g.add_node("physics", self._physics)
        g.add_node("knowledge", self._knowledge)
        # 节点名不能与 state 键重名（langgraph 约束），故用 vision_inspect
        g.add_node("vision_inspect", self._vision)
        g.add_node("chairman", self._chairman)
        g.add_node("decide", self._decision)
        g.add_node("assemble", self._assemble)

        g.add_edge(START, "normalize")
        g.add_edge("normalize", "detect")
        # [signal, physics, knowledge, vision] 四路并行
        g.add_edge("detect", "signal")
        g.add_edge("detect", "physics")
        g.add_edge("detect", "knowledge")
        g.add_edge("detect", "vision_inspect")
        # 四路汇聚到 chairman
        g.add_edge("signal", "chairman")
        g.add_edge("physics", "chairman")
        g.add_edge("knowledge", "chairman")
        g.add_edge("vision_inspect", "chairman")
        g.add_edge("chairman", "decide")
        g.add_edge("decide", "assemble")
        g.add_edge("assemble", END)
        return g.compile()

    def run(self, device_id: str, window: Any, vision: dict | None = None) -> dict:
        """执行完整会诊编排，返回最终结果 dict。

        Args:
            vision: 可选的部件表面视觉检测结果
                {"available": bool, "damage_type": str|None, "confidence": float, "count": int}
                提供后作为第五路证据参与 D-S 融合与交叉验证。
        """
        initial: ConsultState = {"device_id": device_id, "window": window}
        if vision:
            initial["vision"] = vision
        if self._compiled is not None:
            final = self._compiled.invoke(initial)
            return final["result"]

        # 回退：纯 Python 顺序调用（同一状态节点序列）
        state: ConsultState = dict(initial)
        for node in self._node_sequence:
            state.update(node(state))
        return state["result"]


consultation_graph = ConsultationGraph()


def run_consultation(device_id: str, window: Any) -> dict:
    """模块级会诊入口（对外）。"""
    return consultation_graph.run(device_id, window)


__all__ = [
    "ConsultState",
    "ConsultationGraph",
    "consultation_graph",
    "run_consultation",
]