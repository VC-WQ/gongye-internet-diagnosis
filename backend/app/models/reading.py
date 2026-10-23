"""传感器采样。健康分不写在采样行上，会诊分数只来自模型输出。"""
from __future__ import annotations

from sqlalchemy import Column, Float, Integer, String

from .base import Base


class SensorReading(Base):
    """一条设备采样。"""

    __tablename__ = "sensor_readings"

    id = Column(Integer, primary_key=True, autoincrement=True)
    device_id = Column(String(64), index=True, nullable=False)
    timestamp = Column(Float, nullable=False)
    original_timestamp = Column(Float)
    vibration = Column(Float)
    temperature = Column(Float)
    current = Column(Float)
    pressure = Column(Float)
    speed = Column(Float)
    acoustic = Column(Float)
    source = Column(String(32))
    dataset = Column(String(64))
    sample_note = Column(String(256))
    health_score = Column(Float)
    health_basis = Column(String(32))
    fault_label = Column(String(128))
    edge_anomaly_score = Column(Float)
