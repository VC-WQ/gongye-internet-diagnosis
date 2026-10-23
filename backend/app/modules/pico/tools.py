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
    "get_device_history",
    "compare_devices",
    "analyze_ranked_devices",
    "compare_events",
]


def get_device(session: Session, device_id: str) -> Optional[Device]:
    """按 ID 读取设备目录。"""
    return session.get(Device, device_id)


def get_event(session: Session, event_id: int) -> Optional[Event]:
    """按 ID 读取事件。"""
    return session.get(Event, event_id)


def resolve_device_mentions(session: Session, message: str) -> tuple[list[str], Optional[str]]:
    """只解析真实目录 ID/唯一名称；未知或歧义不能回退到当前设备。"""
    normalized = re.sub(r"\s+", "", message).casefold()
    devices = session.query(Device).all()
    matched: set[str] = set()
    matched_aliases: dict[str, set[str]] = {}
    for device in devices:
        # The catalogue permits numeric-leading IDs and IDs without a hyphen too.
        if re.search(r"(?<![A-Za-z0-9_-])" + re.escape(device.id) + r"(?![A-Za-z0-9_-])", message, re.I):
            matched.add(device.id)
        name = re.sub(r"\s+", "", device.name).casefold()
        aliases = {name}
        if name.startswith("驱动电机"):
            aliases.add(name.replace("驱动电机", "电机", 1))
        if name.startswith("离心泵"):
            aliases.add(name.replace("离心泵", "泵", 1))
        for alias in aliases:
            if alias and re.search(re.escape(alias) + (r"(?![a-z0-9])" if re.search(r"[a-z0-9]$", alias) else ""), normalized):
                matched.add(device.id)
                matched_aliases.setdefault(alias, set()).add(device.id)
    for alias, ids in matched_aliases.items():
        if len(ids) > 1:
            return [], f"名称“{alias}”对应多台设备，请提供设备编号。"
    for token in re.findall(r"(?:设备编号|设备ID|设备id)\s*(?:是|为|[:：])?\s*([A-Za-z0-9][A-Za-z0-9_-]{0,63})(?![A-Za-z0-9_-])", message):
        if not any(d.id.casefold() == token.casefold() for d in devices):
            return [], f"设备 {token} 不存在或不可见，请核对设备编号。"
    # IDs use token boundaries, preventing motor-001 from matching motor-0010.
    tokens = re.findall(r"(?<![A-Za-z0-9_-])[A-Za-z][A-Za-z0-9_]*(?:-[A-Za-z0-9_]+)+(?![A-Za-z0-9_-])", message)
    for token in tokens:
        device = next((d for d in devices if d.id.casefold() == token.casefold()), None)
        if device is None:
            # FP-CNN/SDE-PF/ResNet-50 are research terms, not fabricated device IDs.
            if re.match(r"^(?:pump|motor|compressor|device|no-such)-", token, re.I) or re.search(r"(?:设备编号|设备ID|设备id)\s*(?:是|为|[:：])?\s*" + re.escape(token), message):
                return [], f"设备 {token} 不存在或不可见，请核对设备编号。"
            continue
        matched.add(device.id)
    named = re.findall(r"(?:驱动电机|电机|离心泵|泵|空压机)\s*[A-Za-z](?![A-Za-z0-9])", message)
    for mention in named:
        simple = re.sub(r"\s+", "", mention).casefold()
        candidates = [d.id for d in devices if simple in re.sub(r"\s+", "", d.name).casefold() or simple == re.sub(r"\s+", "", d.name).casefold().replace("驱动电机", "电机").replace("离心泵", "泵")]
        if not candidates:
            return [], f"没有找到设备“{mention}”，请核对名称或提供设备编号。"
        if len(candidates) > 1:
            return [], f"名称“{mention}”对应多台设备，请提供设备编号。"
    return sorted(matched), None


def resolve_device_mention(session: Session, message: str) -> tuple[Optional[str], Optional[str]]:
    matched, error = resolve_device_mentions(session, message)
    if error:
        return None, error
    if len(matched) > 1:
        return None, "你提到了多台设备，请明确这次要查看哪一台。"
    return (matched[0] if matched else None), None


def resolve_event_mentions(message: str) -> tuple[list[int], str | None]:
    matches = re.findall(r"(?:事件|记录|报告)\s*[#＃]?\s*(\d+)|[#＃]\s*(\d+)", message)
    ids = {int(first or second) for first, second in matches}
    for chain in re.finditer(r"(?:事件|记录|报告)\s*[#＃]?\s*\d+(?:\s*(?:和|与|及|、|,|，)\s*[#＃]?\s*\d+)+", message):
        ids.update(int(token) for token in re.findall(r"\d+", chain.group()))
    if any(event_id < 1 or event_id > 9007199254740991 for event_id in ids):
        return [], "事件编号必须是有效的正整数，请核对。"
    return sorted(ids), None


def device_history(session: Session, device_id: str, limit: int = 20) -> dict:
    from app.modules.device_catalog.history import health_history
    points = health_history(session, device_id, limit)
    return {"device_id": device_id, "basis": "persisted_diagnosis_scores", "points": points,
            "trend": {"first_score": points[0]["health_score"], "last_score": points[-1]["health_score"], "change_points": round(points[-1]["health_score"] - points[0]["health_score"], 6), "from": points[0]["timestamp"], "to": points[-1]["timestamp"]} if len(points) >= 2 else None}


def compare_devices(session: Session, device_ids: list[str], events_per_device: int = 2) -> dict:
    rows, missing = [], []
    for device_id in device_ids[:3]:
        overview = device_overview(session, device_id)
        if overview is None:
            missing.append(device_id)
            continue
        events = list_device_events(session, device_id, max(1, min(3, events_per_device)))
        rows.append({**overview, "recent_events": [event_detail(event) for event in events]})
    return {"devices": rows, "missing_device_ids": missing, "basis": "device_catalog_and_saved_events", "events_per_device": max(1, min(3, events_per_device))}


def compare_events(session: Session, event_ids: list[int]) -> dict:
    rows, missing = [], []
    for event_id in event_ids[:3]:
        event = get_event(session, event_id)
        if event is None:
            missing.append(event_id)
        else:
            rows.append(event_detail(event))
    return {"events": rows, "missing_event_ids": missing, "basis": "persisted_diagnoses"}


def analyze_ranked_devices(session: Session, filters: dict, sort: str, limit: int, events_per_device: int = 2) -> dict:
    rows = search_devices(session, filters, sort, min(3, limit))
    result = compare_devices(session, [row["id"] for row in rows], events_per_device)
    return {**result, "sort": sort, "requested_limit": min(3, limit)}


def finite_number(value: Any) -> Optional[float]:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        try:
            number = float(value)
        except OverflowError:
            return None
        if math.isfinite(number):
            return number
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
    if filters.get("unresolved_only"):
        query = query.filter(Event.status_state.in_(("warning", "alarm", "consulting", "pending")))
    return query.order_by(Event.timestamp.desc(), Event.id.desc()).limit(max(1, min(limit, MAX_EVENTS))).all()


def event_detail(event: Event) -> dict[str, Any]:
    """事件的安全摘要（不含原始全量窗口）。"""
    from app.modules.device_catalog.history import observation_source
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
        "source_kind": observation_source(event),
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
        "timestamp": detail.get("timestamp"),
        "source_kind": detail.get("source_kind"),
    }
