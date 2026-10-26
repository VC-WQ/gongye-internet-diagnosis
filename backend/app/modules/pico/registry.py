"""Task capabilities derive their names and schemas from executable protocol unions.

This metadata describes the fixed business tools; it cannot register new code or URLs.
"""
from pydantic import TypeAdapter

from .task_schema import TaskReadCall
from .ui_schema import PicoUiAction

READ_ADAPTER = TypeAdapter(TaskReadCall)
UI_ADAPTER = TypeAdapter(PicoUiAction)

_READ_METADATA = {
    "read_current_page": ("按需读取当前页面精简语义快照，数据只代表当前界面", "runtime page_snapshot"),
    "get_device_overview": ("读取真实设备目录、最新采样及最近落库诊断", "device_catalog + mqtt_pipeline + events"),
    "get_device_telemetry": ("读取设备采样窗口、时效及来源", "mqtt_pipeline"),
    "list_device_events": ("读取一台设备或全局最近的落库事件", "events"),
    "get_event_detail": ("读取指定事件的诊断与依据", "events"),
    "get_report_summary": ("读取指定事件的报告摘要", "events.report"),
    "search_devices": ("全局搜索筛选排序设备目录；不受当前页面限制", "device_catalog"),
    "search_events": ("全局搜索筛选落库事件", "events"),
    "search_research_topics": ("按真实研究索引搜索主题与研究点", "research_index"),
    "get_research_evidence": ("读取已登记的研究实验依据；保留缺失及阴性结果", "research_assets"),
    "get_device_history": ("读取落库诊断健康评分历史，不是连续传感器曲线", "events"),
    "compare_devices": ("比较二至三台真实设备的目录、采样与事件", "device_catalog + mqtt_pipeline + events"),
    "analyze_ranked_devices": ("全局排名并关联每台设备的真实事件", "device_catalog + events"),
    "compare_events": ("比较二至三条真实落库事件", "events"),
}


def capability_catalog() -> dict:
    reads = READ_ADAPTER.json_schema()
    actions = UI_ADAPTER.json_schema()
    names = list(reads["discriminator"]["mapping"])
    return {
        "version": "2.7",
        "tools": [
            {"name": name, "description": _READ_METADATA[name][0], "parameter_schema": reads["$defs"][ref.rsplit("/", 1)[-1]]["properties"]["args"],
             "permission": "authenticated", "source": _READ_METADATA[name][1], "risk": "read_only",
             "result": "{tool,data,status,source_kind,references,actions,focus,duration_ms}"}
            for name, ref in reads["discriminator"]["mapping"].items()
        ],
        "read_schema": reads,
        "ui_schema": actions,
        "page_reader": {"name": "read_current_page", "source": "versioned runtime page_snapshot", "risk": "read_only", "authority": "untrusted UI display; global facts require business tools"},
        "ui_permissions": {"prefill_device_form": "admin + explicit user fields + manual save", "device_management": "admin", "user_management": "admin", "record_management": "admin", "simulation": "admin", "other": "authenticated, safe navigation only"},
        "limits": {"planning_steps": 8, "tool_calls": 12, "tool_timeout_seconds": 4, "planner_timeout_seconds": 10, "overall_timeout_seconds": 90, "snapshot_characters": 16000},
        "write_tools": [],
    }
