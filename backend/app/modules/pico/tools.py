"""Pico 只读工具：设备、实时窗口、事件与报告摘要。

安全边界：
- 只做 SELECT，不包含任何写操作；
- 设备/事件必须存在，事件与设备必须归属一致；
- 不把原始 token、整页 DOM 或未授权数据带出。
"""
from __future__ import annotations

import json
import math
import re
import time
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy.orm import Session
from sqlalchemy import or_

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
    "search_devices",
    "search_events",
    "search_research_topics",
    "get_research_evidence",
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
            # FP-CNN/SDE-PF/ResNet-50 are research terms, not fabricated device IDs.
            if re.match(r"^(?:pump|motor|compressor|device|no-such)-", token, re.I) or re.search(r"(?:设备编号|设备ID|设备id)\s*(?:是|为|[:：])?\s*" + re.escape(token), message):
                return None, f"设备 {token} 不存在或不可见，请核对设备编号。"
            continue
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


def search_devices(session: Session, filters: dict, sort: str, limit: int) -> list[dict]:
    """结构化目录检索；排序来自数据库，不能由模型捏造评分。"""
    query = session.query(Device)
    text = filters.get("query")
    if text:
        escaped = text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
        query = query.filter(or_(Device.id.ilike(f"%{escaped}%", escape="\\"), Device.name.ilike(f"%{escaped}%", escape="\\")))
    if filters.get("device_type"):
        query = query.filter(Device.device_type == filters["device_type"])
    if filters.get("status"):
        query = query.filter(Device.status == filters["status"])
    if filters.get("abnormal_only"):
        query = query.filter(Device.status.in_(("degraded", "fault", "offline")))
    if sort in ("health_asc", "health_desc"):
        query = query.filter(Device.health_score.isnot(None))
        query = query.order_by(Device.health_score.asc() if sort == "health_asc" else Device.health_score.desc(), Device.id.asc())
    else:
        query = query.order_by(Device.id.asc())
    return [{"id": d.id, "name": d.name, "device_type": d.device_type, "status": d.status, "health_score": finite_number(d.health_score)} for d in query.limit(max(1, min(limit, 20))).all()]


def search_events(session: Session, filters: dict, limit: int) -> list[Event]:
    query = session.query(Event)
    if filters.get("device_id"):
        query = query.filter(Event.device_id == filters["device_id"])
    if filters.get("status"):
        query = query.filter(Event.status_state == filters["status"])
    if filters.get("severity"):
        query = query.filter(Event.severity == filters["severity"])
    if filters.get("abnormal_only"):
        query = query.filter(or_(Event.severity.in_(("warning", "critical", "alarm")), Event.status_state.in_(("warning", "alarm", "consulting", "pending", "handling", "observing", "relapsed"))))
    return query.order_by(Event.timestamp.desc(), Event.id.desc()).limit(max(1, min(limit, MAX_EVENTS))).all()


def event_detail(event: Event) -> dict[str, Any]:
    """事件的安全摘要（不含原始全量窗口）。"""
    diag = event.agent_diagnosis if isinstance(event.agent_diagnosis, dict) else {}
    report = diag.get("report") if isinstance(diag.get("report"), dict) else {}
    def excerpt(value: Any):
        if value is None:
            return None
        return (value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, default=str))[:1200]
    return {
        "id": event.id,
        "device_id": event.device_id,
        "status_state": event.status_state,
        "severity": event.severity,
        "timestamp": event.timestamp.isoformat() if event.timestamp else None,
        "fault_type": excerpt(diag.get("fault_type")),
        "fault_label": excerpt(diag.get("fault_label") or diag.get("fault_type")),
        "confidence": finite_number(diag.get("confidence")),
        "health_score": finite_number(diag.get("health_score")),
        "health_level": excerpt(diag.get("health_level")),
        "conflict_detected": diag.get("conflict_detected") if isinstance(diag.get("conflict_detected"), bool) else None,
        "summary": excerpt(report.get("summary")),
        "recommendation": excerpt(report.get("recommendation")),
        "physical_evidence": excerpt(report.get("physical_evidence")),
        "signal_evidence": excerpt(report.get("signal_evidence")),
        "knowledge_basis": excerpt(report.get("knowledge_basis")),
        "feedback": excerpt(event.feedback_result),
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
