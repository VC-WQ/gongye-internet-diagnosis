"""模块6 指令闭环数据模型：状态枚举、指令记录、事件时间线。

复用 app/models/event.py 的 Event 表作为事件主表（用其 status_state
存当前状态、agent_diagnosis 存诊断报告、sensor_data 存原始窗口）。
本文件新增：
- EventState：9 状态枚举（存库时用 .value 字符串）
- CommandRecord：可执行指令记录
- EventTimeline：状态变更审计日志（who/when/why）
"""
from __future__ import annotations

from datetime import datetime
from enum import Enum

from sqlalchemy import JSON, Boolean, Column, DateTime, Float, Integer, String, Text

from app.models import Base


class EventState(str, Enum):
    """指令闭环事件状态机（9 个状态）。"""

    NORMAL = "normal"            # 正常
    WARNING = "warning"          # 预警
    ALARM = "alarm"              # 告警
    CONSULTING = "consulting"    # 会诊中
    PENDING = "pending"          # 待确认
    HANDLING = "handling"        # 处置中
    OBSERVING = "observing"      # 观察中
    RECOVERED = "recovered"      # 恢复
    RELAPSED = "relapsed"        # 复发（→ 再诊断）


class CommandRecord(Base):
    """可执行指令记录：一次指令下发与执行跟踪。"""

    __tablename__ = "command_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(64), index=True, comment="设备ID")
    event_id = Column(Integer, index=True, comment="关联事件ID")
    command = Column(String(256), comment="指令内容")
    params = Column(JSON, default=dict, comment="指令参数")
    status = Column(String(32), default="pending", comment="指令状态")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")

    def __repr__(self) -> str:
        return f"<CommandRecord id={self.id} event_id={self.event_id} status={self.status}>"


class EventTimeline(Base):
    """事件状态变更审计日志（who/when/why）。"""

    __tablename__ = "event_timelines"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(Integer, index=True, comment="关联事件ID")
    device_id = Column(String(64), index=True, comment="设备ID")
    from_state = Column(String(32), nullable=True, comment="来源状态（初始为 None）")
    to_state = Column(String(32), comment="目标状态")
    reason = Column(Text, default="", comment="变更原因（why）")
    operator = Column(String(64), default="system", comment="操作人（who）")
    created_at = Column(DateTime, default=datetime.utcnow, index=True, comment="变更时间（when）")

    def __repr__(self) -> str:
        return f"<EventTimeline id={self.id} {self.from_state}->{self.to_state}>"


class ThresholdSuggestion(Base):
    """阈值调整建议（闭环2 输出）：AI 生成、人工采纳/拒绝。

    字段即审计：old_value/new_value 为前后值，reason 为调整原因，
    status 为建议状态，accepted_by/accepted_at 记录采纳人与时间戳。
    """

    __tablename__ = "threshold_suggestions"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(64), index=True, comment="设备ID")
    old_value = Column(Float, comment="调整前阈值")
    new_value = Column(Float, comment="调整后阈值")
    reason = Column(Text, default="", comment="调整原因")
    status = Column(String(32), default="pending", comment="pending/accepted/rejected")
    accepted_by = Column(String(64), nullable=True, comment="采纳人")
    created_at = Column(DateTime, default=datetime.utcnow, index=True, comment="创建时间")
    accepted_at = Column(DateTime, nullable=True, comment="采纳时间")

    def __repr__(self) -> str:
        return (
            f"<ThresholdSuggestion id={self.id} device={self.device_id} "
            f"{self.old_value}->{self.new_value} status={self.status}>"
        )


class DiagnosisRecord(Base):
    """诊断记录（闭环3）：一次诊断结论的准确率跟踪。

    predicted_fault 为系统诊断结论，actual_fault 为人工确认的实际根因
    （ground truth），is_correct 在注入根因时计算（predicted==actual）。
    """

    __tablename__ = "diagnosis_records"

    id = Column(Integer, primary_key=True, autoincrement=True)
    event_id = Column(Integer, index=True, comment="关联事件ID")
    predicted_fault = Column(String(64), comment="系统诊断的故障类型")
    actual_fault = Column(String(64), nullable=True, comment="人工确认实际根因")
    is_correct = Column(Boolean, nullable=True, comment="诊断是否正确（根因注入后计算）")
    latency_seconds = Column(Float, default=0.0, comment="诊断延迟（触发到结束）")
    created_at = Column(DateTime, default=datetime.utcnow, index=True, comment="创建时间")

    def __repr__(self) -> str:
        return (
            f"<DiagnosisRecord id={self.id} event_id={self.event_id} "
            f"predicted={self.predicted_fault} actual={self.actual_fault} "
            f"correct={self.is_correct}>"
        )