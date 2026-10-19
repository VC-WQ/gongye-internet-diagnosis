"""Pico 只读工具：设备、实时窗口、事件与报告摘要。

安全边界：
- 只做 SELECT，不包含任何写操作；
- 设备/事件必须存在，事件与设备必须归属一致；
- 不把原始 token、整页 DOM 或未授权数据带出。
"""
from __future__ import annotations

import time
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models import Device, Event
from app.modules.mqtt_pipeline.service import mqtt_pipeline_service

# 与前端 useDeviceTelemetry 保持一致的时效口径
STALE_SECONDS = 15
MAX_WINDOW_POINTS = 64
MAX_EVENTS = 20

READ_ONLY_TOOLS = [
    "get_device_overview",
    "get_device_telemetry",
    "list_device_events",
    "get_event_detail",
    "get_report_summary",
]


def get_device(session: Session, device_id: str) -> Optional[Device]:
    """按 ID 读取设备目录。"""
    return session.get(Device, device_id)


def get_event(session: Session, event_id: int) -> Optional[Event]:
    """按 ID 读取事件。"""
    return session.get(Event, event_id)


def device_overview(session: Session, device_id: str) -> Optional[dict[str, Any]]:
    """设备目录 + 最新窗口时效（只读）。"""
    device = get_device(session, device_id)
    if device is None:
        return None

    window = mqtt_pipeline_service.get_window(device_id)[-MAX_WINDOW_POINTS:]
    last = window[-1] if window else None
    last_ts = last.get("timestamp") if isinstance(last, dict) else None
    age = round(time.time() - float(last_ts), 1) if isinstance(last_ts, (int, float)) else None
    stale = age is None or age > STALE_SECONDS

    return {
        "id": device.id,
        "name": device.name,
        "device_type": device.device_type,
        "status": device.status,
        "health_score": device.health_score,
        "edge_anomaly_score": device.edge_anomaly_score,
        "threshold_vibration": device.threshold_vibration,
        "threshold_temp": device.threshold_temp,
        "window_points": len(window),
        "last_sample_age_seconds": age,
        "stale": stale,
        "last_sample": last,
    }


def list_device_events(
    session: Session, device_id: Optional[str], limit: int = 3
) -> list[Event]:
    """按设备（或全局）读取最近事件，只读。"""
    limit = max(1, min(limit, MAX_EVENTS))
    query = session.query(Event)
    if device_id:
        query = query.filter(Event.device_id == device_id)
    return query.order_by(Event.timestamp.desc(), Event.id.desc()).limit(limit).all()


def event_detail(event: Event) -> dict[str, Any]:
    """事件的安全摘要（不含原始全量窗口）。"""
    diag = event.agent_diagnosis or {}
    report = diag.get("report") or {}
    return {
        "id": event.id,
        "device_id": event.device_id,
        "status_state": event.status_state,
        "severity": event.severity,
        "timestamp": event.timestamp.isoformat() if event.timestamp else None,
        "fault_type": diag.get("fault_type"),
        "fault_label": diag.get("fault_label") or diag.get("fault_type"),
        "confidence": diag.get("confidence"),
        "health_score": diag.get("health_score"),
        "health_level": diag.get("health_level"),
        "conflict_detected": diag.get("conflict_detected"),
        "summary": report.get("summary"),
        "recommendation": report.get("recommendation"),
        "physical_evidence": report.get("physical_evidence"),
        "signal_evidence": report.get("signal_evidence"),
        "knowledge_basis": report.get("knowledge_basis"),
        "feedback": event.feedback_result,
    }


def report_summary(event: Event) -> dict[str, Any]:
    """报告摘要（只读，来自事件已落库的诊断结果）。"""
    detail = event_detail(event)
    return {
        "event_id": event.id,
        "device_id": event.device_id,
        "status_state": event.status_state,
        "summary": detail.get("summary"),
        "recommendation": detail.get("recommendation"),
        "fault_label": detail.get("fault_label"),
        "confidence": detail.get("confidence"),
        "health_score": detail.get("health_score"),
    }
