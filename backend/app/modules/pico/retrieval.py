"""固定只读工具执行与无模型时的有限检索兜底。"""
from __future__ import annotations

import re
import json
import time
import logging
from urllib.parse import quote
from typing import Any

from sqlalchemy.orm import Session

from . import knowledge, tools
from .planner import PicoToolPlan

logger = logging.getLogger(__name__)


def comparison_requested(message: str) -> bool:
    return bool(re.search(r"比较|对比|比对|哪台.*(?:更|较)|哪个.*(?:更|较)", message))


def history_requested(message: str) -> bool:
    return bool(re.search(r"趋势|走势|历史评分|健康历史|评分.*变化|健康.*变化|变化.*评分|历史.*健康", message))


def ranked_analysis_requested(message: str) -> bool:
    return global_scope(message) == "devices" and bool(re.search(r"异常|事件|记录|诊断|比较|对比|依据|证据", message))


def is_research_query(message: str) -> bool:
    return bool(re.search(r"研究|算法|模型|知识|架构|数据集|实验|粒子滤波|剩余寿命|SDE|CNN|PINN|CORAL|DANN|YOLO|RT.?DETR|ResNet|CWRU|XJTU|NEU.?DET|视觉.*效果", message, re.I))


def global_scope(message: str) -> str | None:
    if re.search(r"这台|该设备|它(?!们)|刚才|(?:pump|motor|compressor)-\w+|(?:电机|泵|空压机)\s*[A-Za-z](?![A-Za-z])", message, re.I):
        return None
    if re.search(r"(?:最低|最高|排名|排序).*(?:台|设备|评分)|(?:健康|评分).*(?:最低|最高)|所有设备|全厂设备", message):
        return "devices"
    if re.search(r"最近.*(?:事件|告警|异常)|全厂.*(?:事件|告警)|全局.*事件|哪些设备.*(?:异常|告警)|(?:未处理|待处理|待确认).*事件", message):
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


def _rank_filters(message: str) -> dict:
    filters: dict[str, Any] = {"abnormal_only": bool(re.search(r"异常设备|异常.*(?:泵|电机|空压机)", message))}
    for word, kind in (("空压机", "compressor"), ("电机", "motor"), ("泵", "pump")):
        if word in message:
            filters["device_type"] = kind
            break
    for word, status in (("离线", "offline"), ("退化", "degraded"), ("故障", "fault")):
        if word in message:
            filters["status"] = status
            break
    return filters


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
    if comparison_requested(message) and len(context.get("provided_event_ids", [])) >= 2:
        return PicoToolPlan.model_validate({"calls": [{"name": "compare_events", "args": {"event_ids": context["provided_event_ids"]}}]})
    if comparison_requested(message) and len(context.get("provided_device_ids", [])) >= 2:
        return PicoToolPlan.model_validate({"calls": [{"name": "compare_devices", "args": {"device_ids": context["provided_device_ids"]}}]})
    scope = None if context.get("provided_device_ids") and context.get("device_id") else global_scope(message)
    if scope == "devices":
        if ranked_analysis_requested(message):
            return PicoToolPlan.model_validate({"calls": [{"name": "analyze_ranked_devices", "args": {"filters": _rank_filters(message), "sort": "health_desc" if "最高" in message else "health_asc", "limit": min(3, _requested_limit(message, 3))}}]})
        return PicoToolPlan.model_validate({"calls": [{"name": "search_devices", "args": {"filters": _rank_filters(message), "sort": "health_desc" if "最高" in message else "health_asc", "limit": _requested_limit(message, 3)}}]})
    if scope == "events":
        return PicoToolPlan.model_validate({"calls": [{"name": "search_events", "args": {"filters": {"abnormal_only": bool(re.search(r"异常|告警|报警", message)), **({"severity": "critical"} if "严重" in message else {}), **({"status": "pending"} if "待确认" in message else {"unresolved_only": True} if re.search(r"未处理|待处理", message) else {})}, "limit": _requested_limit(message, 5)}}]})
    if history_requested(message) and context.get("device_id"):
        return PicoToolPlan.model_validate({"calls": [{"name": "get_device_history", "args": {"device_id": context["device_id"]}}]})
    if re.search(r"为什么|原因|依据|这个问题", message) and context.get("device_id"):
        calls = [{"name": "get_device_overview", "args": {"device_id": context["device_id"]}}]
        calls.append({"name": "get_event_detail", "args": {"event_id": context["event_id"]}} if context.get("event_id") else {"name": "list_device_events", "args": {"device_id": context["device_id"], "limit": 1}})
        return PicoToolPlan.model_validate({"calls": calls})
    if re.search(r"最近|最新|上次", message) and re.search(r"诊断|事件|记录", message):
        device_id, error = tools.resolve_device_mention(db, message)
        if error:
            return None  # Existing context path returns the precise entity error.
        target = device_id or context.get("device_id")
        if target:
            return PicoToolPlan.model_validate({"calls": [{"name": "list_device_events", "args": {"device_id": target, "limit": 1}}]})
    if context.get("device_id") and tools.get_device(db, context["device_id"]) is not None and re.search(r"状态|怎么样|健康|传感器|指标|采样|运行|情况", message):
        return PicoToolPlan.model_validate({"calls": [{"name": "get_device_overview", "args": {"device_id": context["device_id"]}}]})
    return None


def _ref(kind: str, id: Any, label: str, source: str, timestamp=None) -> dict:
    return {"kind": kind, "id": str(id), "label": label, "source": source, "observed_at": timestamp}


def _action(type: str, label: str, target: Any, params=None) -> dict:
    return {"type": type, "label": label, "target": str(target), "params": params or {}}


def execute_call(db: Session, call) -> dict:
    name, args = call.name, call.args
    result: dict[str, Any] = {"tool": name, "data": None, "status": "missing", "source_kind": "unknown", "references": [], "actions": [], "focus": None}
    if name == "compare_events":
        data = tools.compare_events(db, args.event_ids)
        result["data"] = data
        result["status"] = "current" if data["events"] else "missing"
        kinds = {event["source_kind"] for event in data["events"]}
        result["source_kind"] = next(iter(kinds)) if len(kinds) == 1 else "unknown"
        result["references"] = [_ref("event", event["id"], f"事件 #{event['id']} · {event['device_id']}", "command_loop", event["timestamp"]) for event in data["events"]]
        result["actions"] = [_action("open_event", f"查看事件 #{event['id']}", event["id"], {"device_id": event["device_id"], "event_id": event["id"]}) for event in data["events"]]
    elif name in ("compare_devices", "analyze_ranked_devices"):
        data = tools.compare_devices(db, args.device_ids, args.events_per_device) if name == "compare_devices" else tools.analyze_ranked_devices(db, args.filters.model_dump(exclude_none=True), args.sort, args.limit, args.events_per_device)
        result["data"] = data
        result["status"] = "current" if data["devices"] else "missing"
        # Telemetry keeps its own validity/staleness per device; directory ranking is not a live sensor claim.
        kinds = set()
        for row in data["devices"]:
            result["references"].append(_ref("device", row["id"], row["name"], "device_catalog", row["observed_at"]))
            result["actions"].append(_action("open_device", f"查看{row['name']}", row["id"], {"device_id": row["id"]}))
            kinds.add({"real": "real", "simulation": "simulated", "simulated": "simulated", "history": "offline", "offline": "offline"}.get((row.get("last_sample") or {}).get("source"), "unknown"))
            for event in row["recent_events"]:
                result["references"].append(_ref("event", event["id"], f"事件 #{event['id']} · {row['id']}", "command_loop", event["timestamp"]))
        result["source_kind"] = next(iter(kinds)) if len(kinds) == 1 else "unknown"
    elif name == "get_device_history":
        if tools.get_device(db, args.device_id) is None:
            result["message"] = f"设备 {args.device_id} 不存在或不可见。"
            return result
        data = tools.device_history(db, args.device_id, args.limit)
        result["data"] = data
        result["status"] = "current" if data["points"] else "missing"
        kinds = {point["source_kind"] for point in data["points"]}
        result["source_kind"] = next(iter(kinds)) if len(kinds) == 1 else "unknown"
        result["references"] = [_ref("event", point["event_id"], f"诊断评分记录 #{point['event_id']}", "command_loop", point["timestamp"]) for point in data["points"]]
        result["actions"] = [_action("switch_workspace_view", "查看设备健康历史", f"/manage/devices/{quote(args.device_id, safe='')}?detail=history")]
        result["focus"] = {"device_id": args.device_id}
    elif name in ("get_device_overview", "get_device_telemetry"):
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
        result["source_kind"] = result["data"]["source_kind"]
        kind = "event" if name == "get_event_detail" else "report"
        result["references"] = [_ref(kind, event.id, f"事件 #{event.id}" + (" 报告" if kind == "report" else ""), "command_loop" if kind == "event" else "report", event.timestamp.isoformat() if event.timestamp else None)]
        result["actions"] = [_action("open_event" if kind == "event" else "open_report", "查看事件" if kind == "event" else "打开报告", event.id, {"device_id": event.device_id, "event_id": event.id})]
        result["focus"] = {"device_id": event.device_id, "event_id": event.id}
    elif name in ("list_device_events", "search_events"):
        events = tools.list_device_events(db, args.device_id, args.limit) if name == "list_device_events" else tools.search_events(db, args.filters.model_dump(exclude_none=True), args.limit)
        result["data"] = [tools.event_detail(event) for event in events]
        result["status"] = "current" if events else "missing"
        sources = {row["source_kind"] for row in result["data"]}
        result["source_kind"] = next(iter(sources)) if len(sources) == 1 else "unknown"
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


def plan_respects_scope(plan: PicoToolPlan, message: str, provided_device_ids: list[str] | None = None) -> bool:
    if comparison_requested(message) and len(tools.resolve_event_mentions(message)[0]) >= 2:
        return bool(plan.calls) and all(call.name in ("compare_events", "get_event_detail", "get_report_summary") for call in plan.calls)
    if comparison_requested(message) and len(provided_device_ids or []) >= 2:
        return bool(plan.calls) and all(call.name in ("compare_devices", "get_device_overview", "get_device_telemetry", "get_device_history", "list_device_events", "search_events", "get_event_detail", "get_report_summary") for call in plan.calls)
    scope = None if provided_device_ids else global_scope(message)
    if scope == "devices":
        required_sort = "health_desc" if "最高" in message else "health_asc" if "最低" in message else None
        expected = "analyze_ranked_devices" if ranked_analysis_requested(message) else "search_devices"
        limit = min(3, _requested_limit(message, 3)) if expected == "analyze_ranked_devices" else _requested_limit(message, 3)
        return bool(plan.calls) and all(call.name == expected and call.args.filters.model_dump(exclude_none=True) == _rank_filters(message) and (required_sort is None or call.args.sort == required_sort) and call.args.limit == limit for call in plan.calls)
    if scope == "events":
        abnormal = bool(re.search(r"异常|告警|报警", message))
        unresolved = bool(re.search(r"未处理|待处理", message))
        return bool(plan.calls) and all(call.name == "search_events" and not call.args.filters.device_id and call.args.filters.abnormal_only == abnormal and call.args.filters.unresolved_only == (unresolved and "待确认" not in message) and call.args.filters.status == ("pending" if "待确认" in message else None) and call.args.filters.severity == ("critical" if "严重" in message else None) and call.args.limit == _requested_limit(message, 5) for call in plan.calls)
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


def execute_plan(db: Session, plan: PicoToolPlan, deadline: float) -> list[dict]:
    """No planning loop: at most five distinct calls, isolated failures and a total deadline."""
    results, seen = [], set()
    for call in plan.calls:
        key = json.dumps(call.model_dump(), sort_keys=True)
        if key in seen:
            continue
        seen.add(key)
        start = time.monotonic()
        try:
            if start >= deadline:
                raise TimeoutError("read budget exceeded")
            result = execute_call(db, call)
            if time.monotonic() >= deadline:
                raise TimeoutError("read result exceeded budget")
        except Exception as exc:
            logger.warning("Pico read tool unavailable: %s (%s)", call.name, type(exc).__name__)
            result = {"tool": call.name, "data": None, "status": "missing", "source_kind": "unknown", "message": "这项查询暂时不可用，未补充或猜测结果。", "references": [], "actions": [], "focus": None}
        result["duration_ms"] = round((time.monotonic() - start) * 1000, 2)
        results.append(result)
    return results
