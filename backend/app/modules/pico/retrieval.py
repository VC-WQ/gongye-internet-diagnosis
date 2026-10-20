"""固定只读工具执行与无模型时的有限检索兜底。"""
from __future__ import annotations

import re
from typing import Any

from sqlalchemy.orm import Session

from . import knowledge, tools
from .planner import PicoToolPlan


def is_research_query(message: str) -> bool:
    return bool(re.search(r"研究|算法|模型|知识|架构|数据集|实验|粒子滤波|剩余寿命|SDE|CNN|PINN|CORAL|DANN|YOLO|RT.?DETR|ResNet|CWRU|XJTU|NEU.?DET|视觉.*效果", message, re.I))


def global_scope(message: str) -> str | None:
    if re.search(r"这台|该设备|它|刚才|(?:pump|motor|compressor)-\w+|(?:电机|泵|空压机)\s*[A-Za-z](?![A-Za-z])", message, re.I):
        return None
    if re.search(r"(?:最低|最高|排名|排序).*(?:台|设备|评分)|(?:健康|评分).*(?:最低|最高)|所有设备|全厂设备", message):
        return "devices"
    if re.search(r"最近.*(?:事件|告警|异常)|全厂.*(?:事件|告警)|全局.*事件|哪些设备.*(?:异常|告警)", message):
        return "events"
    return None


def _requested_limit(message: str, default: int) -> int:
    found = re.search(r"([1-9]\d?)\s*(?:台|条|个)", message)
    if found:
        return min(20, int(found.group(1)))
    for word, count in (("三", 3), ("两", 2), ("二", 2), ("五", 5), ("十", 10), ("一", 1)):
        if re.search(word + r"(?:台|条|个)", message):
            return count
    return default


def fallback_plan(db: Session, message: str, context: dict) -> PicoToolPlan | None:
    """仅覆盖可确定的小集合；复杂解析交给模型，未知结果不冒充理解。"""
    if is_research_query(message):
        hits = knowledge.search_research_topics(message, 3)
        calls: list[dict] = [{"name": "search_research_topics", "args": {"query": message, "limit": 5}}]
        if re.search(r"效果|证据|实验|多少|结果|准确|指标|怎么|如何|用于|为什么", message):
            # The index identifies actual points; no model supplied arbitrary API.
            for hit in [h for h in hits if h["kind"] == "research"][:2]:
                calls.append({"name": "get_research_evidence", "args": {"topic_id": hit["topic_id"], "point_id": hit["point_id"]}})
        return PicoToolPlan.model_validate({"calls": calls})
    scope = global_scope(message)
    if scope == "devices":
        return PicoToolPlan.model_validate({"calls": [{"name": "search_devices", "args": {"sort": "health_desc" if "最高" in message else "health_asc", "limit": _requested_limit(message, 3)}}]})
    if scope == "events":
        return PicoToolPlan.model_validate({"calls": [{"name": "search_events", "args": {"filters": {"abnormal_only": bool(re.search(r"异常|告警|报警", message))}, "limit": _requested_limit(message, 5)}}]})
    if re.search(r"最近|最新|上次", message) and re.search(r"诊断|事件|记录", message):
        device_id, error = tools.resolve_device_mention(db, message)
        if error:
            return None  # Existing context path returns the precise entity error.
        target = device_id or context.get("device_id")
        if target:
            return PicoToolPlan.model_validate({"calls": [{"name": "list_device_events", "args": {"device_id": target, "limit": 1}}]})
    return None


def _ref(kind: str, id: Any, label: str, source: str, timestamp=None) -> dict:
    return {"kind": kind, "id": str(id), "label": label, "source": source, "observed_at": timestamp}


def _action(type: str, label: str, target: Any, params=None) -> dict:
    return {"type": type, "label": label, "target": str(target), "params": params or {}}


def execute_call(db: Session, call) -> dict:
    name, args = call.name, call.args
    result: dict[str, Any] = {"tool": name, "data": None, "status": "missing", "source_kind": "unknown", "references": [], "actions": [], "focus": None}
    if name in ("get_device_overview", "get_device_telemetry"):
        overview = tools.device_overview(db, args.device_id)
        if overview is None:
            result["message"] = f"设备 {args.device_id} 不存在或不可见。"
            return result
        result["data"] = overview if name == "get_device_overview" else {key: overview[key] for key in ("device_id", "window_points", "last_sample", "last_sample_age_seconds", "observed_at", "stale", "valid_sample")}
        result["status"] = "missing" if not overview["valid_sample"] else "stale" if overview["stale"] else "current"
        result["source_kind"] = {"real": "real", "simulation": "simulated", "simulated": "simulated", "offline": "offline", "history": "offline"}.get((overview.get("last_sample") or {}).get("source"), "unknown")
        result["references"] = [_ref("device", overview["id"], overview["name"], "device_catalog", overview["observed_at"])]
        result["actions"] = [_action("open_device", "查看设备", overview["id"], {"device_id": overview["id"]})]
        result["focus"] = {"device_id": overview["id"]}
        if name == "get_device_overview":
            recent = tools.list_device_events(db, overview["id"], limit=1)
            if recent:
                result["data"]["latest_diagnosis"] = tools.event_detail(recent[0])
                result["references"].append(_ref("event", recent[0].id, f"事件 #{recent[0].id}", "command_loop", recent[0].timestamp.isoformat() if recent[0].timestamp else None))
                result["focus"]["event_id"] = recent[0].id
    elif name in ("get_event_detail", "get_report_summary"):
        event = tools.get_event(db, args.event_id)
        if event is None:
            result["message"] = f"事件 #{args.event_id} 不存在或不可见。"
            return result
        result["data"] = tools.event_detail(event) if name == "get_event_detail" else tools.report_summary(event)
        result["data"]["device_catalog_missing"] = tools.get_device(db, event.device_id) is None
        result["status"] = "current"
        kind = "event" if name == "get_event_detail" else "report"
        result["references"] = [_ref(kind, event.id, f"事件 #{event.id}" + (" 报告" if kind == "report" else ""), "command_loop" if kind == "event" else "report", event.timestamp.isoformat() if event.timestamp else None)]
        result["actions"] = [_action("open_event" if kind == "event" else "open_report", "查看事件" if kind == "event" else "打开报告", event.id, {"device_id": event.device_id, "event_id": event.id})]
        result["focus"] = {"device_id": event.device_id, "event_id": event.id}
    elif name in ("list_device_events", "search_events"):
        events = tools.list_device_events(db, args.device_id, args.limit) if name == "list_device_events" else tools.search_events(db, args.filters.model_dump(exclude_none=True), args.limit)
        result["data"] = [tools.event_detail(event) for event in events]
        result["status"] = "current" if events else "missing"
        result["references"] = [_ref("event", event.id, f"事件 #{event.id} · {event.device_id}", "command_loop", event.timestamp.isoformat() if event.timestamp else None) for event in events]
        result["actions"] = [_action("open_event", f"查看事件 #{event.id}", event.id, {"device_id": event.device_id, "event_id": event.id}) for event in events[:3]]
        if name == "list_device_events" and args.device_id and events:
            result["focus"] = {"device_id": args.device_id, **({"event_id": events[0].id} if args.limit == 1 else {})}
    elif name == "search_devices":
        result["data"] = tools.search_devices(db, args.filters.model_dump(exclude_none=True), args.sort, args.limit)
        result["sort"] = args.sort
        result["status"] = "current" if result["data"] else "missing"
        result["references"] = [_ref("device", row["id"], row["name"], "device_catalog") for row in result["data"]]
        result["actions"] = [_action("open_device", f"查看{row['name']}", row["id"], {"device_id": row["id"]}) for row in result["data"][:3]]
    elif name == "search_research_topics":
        hits = knowledge.search_research_topics(args.query, args.limit)
        result["data"] = [{key: entry[key] for key in ("kind", "id", "title", "summary", "source", "route") if key in entry} for entry in hits]
        result["status"] = "current" if hits else "missing"
        result["source_kind"] = "offline"
        result["references"] = [_ref(hit["kind"], hit["id"], hit["title"], hit["source"]) for hit in hits]
        result["actions"] = [_action("switch_workspace_view", hit["title"], hit["route"]) for hit in hits[:3]]
    elif name == "get_research_evidence":
        evidence = knowledge.get_research_evidence(db, args.topic_id, args.point_id)
        result["data"] = evidence
        result["status"] = "current" if any(item["status"] == "available" for item in evidence) else "missing"
        kinds = {item["kind"] for item in evidence}
        result["source_kind"] = "simulated" if kinds == {"simulation"} else "offline" if kinds <= {"offline_public", "constructed_domain", "mixed"} else "unknown"
        result["references"] = [_ref("research", item["id"], item["title"], item["source"]) for item in evidence]
        result["actions"] = [_action("switch_workspace_view", item["title"], item["route"]) for item in evidence[:3]]
    return result


def plan_respects_scope(plan: PicoToolPlan, message: str) -> bool:
    scope = global_scope(message)
    if scope == "devices":
        required_sort = "health_desc" if "最高" in message else "health_asc" if "最低" in message else None
        return bool(plan.calls) and all(call.name == "search_devices" and not call.args.filters.query and (required_sort is None or call.args.sort == required_sort) and call.args.limit == _requested_limit(message, 3) for call in plan.calls)
    if scope == "events":
        abnormal = bool(re.search(r"异常|告警|报警", message))
        return bool(plan.calls) and all(call.name == "search_events" and not call.args.filters.device_id and (not abnormal or call.args.filters.abnormal_only) for call in plan.calls)
    if is_research_query(message):
        recalled = {hit["id"] for hit in knowledge.search_research_topics(message, 8) if hit["kind"] == "research"}
        for call in plan.calls:
            if call.name == "search_research_topics":
                # A model must not silently replace an unknown named model with CNN.
                if call.args.query != message:
                    return False
            elif call.name == "get_research_evidence":
                if not call.args.point_id or f"{call.args.topic_id}/{call.args.point_id}" not in recalled:
                    return False
            else:
                return False
        return bool(plan.calls)
    return True
