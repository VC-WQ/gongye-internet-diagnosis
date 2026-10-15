"""模块5 多智能体会诊的 Agent 基类与会诊上下文。

将 AgentContext 与 BaseAgent 抽离到独立文件，避免 signal_agent 与
agents 之间的循环导入。
"""
from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from .schemas import AgentResult, SensorWindow

logger = logging.getLogger(__name__)


@dataclass
class AgentContext:
    """多智能体会诊共享上下文（未来可映射为 LangGraph State）。"""

    device_id: str
    sensor_window: SensorWindow
    anomaly: dict = field(default_factory=dict)  # 模块4 detect() 结果


class BaseAgent(ABC):
    """诊断 Agent 抽象基类。"""

    role: str = "base"
    name: str = "基础 Agent"

    @abstractmethod
    def analyze(self, ctx: AgentContext) -> AgentResult:
        """基于会诊上下文产出诊断结论。"""

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__} role={self.role}>"


__all__ = ["AgentContext", "BaseAgent"]