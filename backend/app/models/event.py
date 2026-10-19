"""诊断事件主表模型。

事件同时承载：原始传感器窗口、多智能体会诊结论、反馈结果与闭环状态。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import JSON, Column, DateTime, Integer, String

from .base import Base


class Event(Base):
    """诊断事件（一次触发 → 会诊 → 处置 → 反馈的完整记录）。"""

    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(64), index=True, comment="设备ID")
    event_type = Column(String(64), default="diagnosis_event", comment="事件类型")
    status_state = Column(String(32), nullable=True, comment="闭环状态机当前状态")
    severity = Column(String(32), default="info", comment="严重度：info/warning/critical")
    timestamp = Column(DateTime, default=datetime.utcnow, index=True, comment="触发时间")
    sensor_data = Column(JSON, comment="原始多通道传感器窗口")
    agent_diagnosis = Column(JSON, comment="多智能体会诊结果")
    feedback_result = Column(JSON, comment="反馈评估结果")
    pinn_residual = Column(JSON, nullable=True, comment="PINN 物理残差（预留列）")
    cnn_result = Column(JSON, nullable=True, comment="CNN 分类结果（预留列）")

    def __repr__(self) -> str:
        return f"<Event id={self.id} device={self.device_id} state={self.status_state}>"
