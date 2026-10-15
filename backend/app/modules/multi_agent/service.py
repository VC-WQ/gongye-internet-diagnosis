"""模块5 多智能体会诊服务。

编排流程已抽离到 graph.py（LangGraph 风格 State + 纯 Python 节点流）：
    normalize -> detect(模块4) -> evidence([signal, physics, knowledge] 并行)
    -> chairman -> decision

本服务作为对外门面，负责委托编排与 Agent 状态查询。
"""
from __future__ import annotations

import logging
from typing import Any

from .graph import consultation_graph

logger = logging.getLogger(__name__)


class MultiAgentService:
    """多智能体会诊服务（门面）。"""

    def __init__(self) -> None:
        self.graph = consultation_graph

    # ------------------------------------------------------------------
    # 会诊主入口
    # ------------------------------------------------------------------
    def consult(self, device_id: str, window: Any, vision: dict | None = None) -> dict:
        """发起多智能体会诊，返回最终结果 dict（含 8 部分诊断报告）。

        Args:
            device_id: 设备 ID
            window: 传感器窗口（list[dict] / dict / SensorWindow）
            vision: 可选的部件表面视觉检测结果（第五路证据）

        Returns:
            会诊结果 dict（见 ConsultResult 结构，含 report 字段）
        """
        result = self.graph.run(device_id, window, vision)
        logger.info(
            "设备 %s 会诊完成：%s（%.4f）健康分 %.2f channels=%s",
            device_id,
            result["fault_label"],
            result["confidence"],
            result["health_score"],
            result["available_channels"],
        )
        return result

    # ------------------------------------------------------------------
    # Agent 状态
    # ------------------------------------------------------------------
    def get_agent_status(self) -> list[dict]:
        """返回各诊断 Agent 的注册状态（含决策 Agent）。"""
        pool = [
            {"role": a.role, "name": a.name, "type": type(a).__name__, "active": True}
            for a in self.graph.agents
        ]
        pool.append(
            {
                "role": self.graph.decision_agent.role,
                "name": self.graph.decision_agent.name,
                "type": type(self.graph.decision_agent).__name__,
                "active": True,
            }
        )
        return pool


multi_agent_service = MultiAgentService()