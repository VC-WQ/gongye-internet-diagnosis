"""模块10 动态阈值效果跟踪数据模型。

ThresholdEffect 表记录「阈值建议采纳后」的效果对比：
采纳前 vs 采纳后的误报次数与减少量。
与模块7 的 ThresholdSuggestion 表解耦，不改模块7/command_loop 的任何模型。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String

from app.models import Base


class ThresholdEffect(Base):
    """阈值调整效果（闭环2 采纳后的量化验证）。"""

    __tablename__ = "threshold_effects"

    id = Column(Integer, primary_key=True, autoincrement=True)
    suggestion_id = Column(Integer, index=True, unique=True, comment="关联阈值建议ID（ThresholdSuggestion.id）")
    device_id = Column(String(64), index=True, comment="设备ID")
    window_days = Column(Integer, default=7, comment="统计窗口天数")
    false_alarms_before = Column(Integer, default=0, comment="采纳前误报次数")
    false_alarms_after = Column(Integer, default=0, comment="采纳后误报次数")
    reduction = Column(Integer, default=0, comment="误报减少量（before-after，可为负）")
    computed_at = Column(DateTime, default=datetime.utcnow, comment="效果计算时间")

    def __repr__(self) -> str:
        return (
            f"<ThresholdEffect id={self.id} suggestion={self.suggestion_id} "
            f"before={self.false_alarms_before} after={self.false_alarms_after} "
            f"reduction={self.reduction}>"
        )