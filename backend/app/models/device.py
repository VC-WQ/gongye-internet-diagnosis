"""设备目录模型。"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import Column, DateTime, Float, String

from .base import Base


class Device(Base):
    """设备主数据（离心泵 / 驱动电机 / 空压机）。"""

    __tablename__ = "devices"

    id = Column(String(64), primary_key=True, comment="设备ID")
    name = Column(String(128), nullable=False, comment="设备名称")
    device_type = Column(String(32), default="pump", comment="设备类型")
    status = Column(String(32), default="healthy", comment="状态：healthy/degraded/alarm")
    health_score = Column(Float, default=100.0, comment="健康评分 0-100")
    edge_anomaly_score = Column(Float, default=0.0, comment="边缘端异常度 0-1")
    threshold_vibration = Column(Float, default=4.5, comment="振动阈值")
    threshold_temp = Column(Float, default=85.0, comment="温度阈值")
    created_at = Column(DateTime, default=datetime.utcnow, comment="创建时间")

    def __repr__(self) -> str:
        return f"<Device id={self.id} name={self.name} status={self.status}>"
