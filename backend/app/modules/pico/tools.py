"""Pico 只读工具：设备、实时窗口、事件与报告摘要。

安全边界：
- 只做 SELECT，不包含任何写操作；
- 设备/事件必须存在，事件与设备必须归属一致；
- 不把原始 token、整页 DOM 或未授权数据带出。
"""
from __future__ import annotations

import math
import re
import time
from datetime import datetime, timezone
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


def resolve_device_mention(session: Session, message: str) -> tuple[Optional[str], Optional[str]]:
    """只解析真实目录 ID/唯一名称；未知或歧义不能回退到当前设备。"""
    normalized = re.sub(r"\s+", "", message).casefold()
    devices = session.query(Device).all()
    matched: set[str] = set()
    for device in devices:
        name = re.sub(r"\s+", "", device.name).casefold()
        aliases = {name}
        if name.startswith("驱动电机"):
            aliases.add(name.replace("驱动电机", "电机", 1))
        if name.startswith("离心泵"):
            aliases.add(name.replace("离心泵", "泵", 1))
        if any(alias and alias in normalized for alias in aliases):
            matched.add(device.id)
    # IDs use token boundaries, preventing motor-001 from matching motor-0010.
    tokens = re.findall(r"(?<![A-Za-z0-9_-])[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+(?![A-Za-z0-9_-])", message)
    for token in tokens:
        device = next((d for d in devices if d.id.casefold() == token.casefold()), None)
        if device is None:
            return None, f"设备 {token} 不存在或不可见，请核对设备编号。"
        matched.add(device.id)
    named = re.findall(r"(?:驱动电机|电机|离心泵|泵|空压机)\s*[A-Za-z](?![A-Za-z0-9])", message)
    if named and not matched:
        return None, f"没有找到设备“{named[0]}”，请核对名称或提供设备编号。"
    if len(matched) > 1:
        return None, "你提到了多台设备，请明确这次要查看哪一台。"
    return (next(iter(matched)) if matched else None), None


def finite_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
        return float(value)
    return None


def device_telemetry(device_id: str) -> dict[str, Any]:
    """有界、白名单采样摘要；过期/无效时间不冒充当前数据。"""
    window = mqtt_pipeline_service.get_window(device_id)[-MAX_WINDOW_POINTS:]
    raw = window[-1] if window and isinstance(window[-1], dict) else {}
    timestamp = finite_number(raw.get("timestamp"))
    now = time.time()
    valid_timestamp = timestamp is not None and 0 < timestamp <= now + 5
    age = round(max(0.0, now - timestamp), 1) if valid_timestamp else None
    observed_at = datetime.fromtimestamp(timestamp, timezone.utc).isoformat() if valid_timestamp else None
    last = {
        key: number
        for key in ("vibration", "temperature", "current", "pressure", "speed", "acoustic")
        if (number := finite_number(raw.get(key))) is not None
    }
    valid_sample = valid_timestamp and bool(last)
    if raw:
        last.update({"source": raw.get("source") if raw.get("source") in ("real", "simulation", "simulated", "history", "offline") else "unknown"})
    return {
        "device_id": device_id,
        "window_points": len(window),
        "observed_at": observed_at,
        "last_sample_age_seconds": age,
        "stale": age is None or age > STALE_SECONDS,
        "valid_sample": valid_sample,
        "last_sample": last or None,
    }


def device_overview(session: Session, device_id: str) -> Optional[dict[str, Any]]:
    """设备目录 + 最新窗口时效（只读）。"""
    device = get_device(session, device_id)
    if device is None:
        return None

    return {
        "id": device.id,
        "name": device.name,
        "device_type": device.device_type,
        "status": device.status,
        "health_score": finite_number(device.health_score),
        "edge_anomaly_score": finite_number(device.edge_anomaly_score),
        "threshold_vibration": finite_number(device.threshold_vibration),
        "threshold_temp": finite_number(device.threshold_temp),
        **device_telemetry(device_id),
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
    diag = event.agent_diagnosis if isinstance(event.agent_diagnosis, dict) else {}
    report = diag.get("report") if isinstance(diag.get("report"), dict) else {}
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
