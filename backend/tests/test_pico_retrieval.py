"""Pico Phase 2：真实结构化查询、有限知识召回、严格计划与调用预算。"""
from __future__ import annotations

import json
import re
from datetime import datetime, timedelta
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import Device, Event, SessionLocal
from app.modules.mqtt_pipeline.service import mqtt_pipeline_service
from app.modules.multi_agent.llm_client import LLMClient, llm_client
from app.modules.pico import knowledge, tools
from app.modules.pico.planner import PicoToolPlan


@pytest.fixture(scope="module")
def api():
    with patch.object(mqtt_pipeline_service, "start", lambda: None), patch.object(mqtt_pipeline_service, "stop", lambda: None):
        with TestClient(app) as client:
            auth = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
            yield client, {"Authorization": f"Bearer {auth.json()['token']}"}


def ask(api, message, **kwargs):
    client, headers = api
    response = client.post("/api/v1/pico/chat", headers=headers, json={"message": message, **kwargs})
    assert response.status_code == 200
    return response.json()


def event(device_id, *, when=None):
    with SessionLocal() as db:
        row = Event(device_id=device_id, timestamp=when or datetime.utcnow(), status_state="pending", severity="critical", agent_diagnosis={"fault_label": "测试内圈故障", "report": {"summary": "测试真实落库摘要"}}, sensor_data=[])
        db.add(row)
        db.commit()
        return row.id


def test_lowest_three_use_global_database_order_not_current_context(api):
    body = ask(api, "帮我找一下目前健康评分最低的三台设备。", context={"area": "factory", "route": "/dashboard", "device_id": "motor-001", "event_id": 999999, "context_revision": 18})
    with SessionLocal() as db:
        expected = [d.id for d in db.query(Device).filter(Device.health_score.isnot(None)).order_by(Device.health_score.asc(), Device.id.asc()).limit(3)]
    assert [r["id"] for r in body["references"] if r["kind"] == "device"] == expected
    assert all(id in body["text"] for id in expected)
    assert body["resolved_context"] is None
    assert body["context_revision"] == 18
    assert body["meta"]["llm"] == "unconfigured"


def test_recent_global_events_ignore_selected_device_and_event(api):
    older = event("motor-001")
    latest = event("pump-002")
    body = ask(api, "最近有哪些设备出现了异常？", device_id="motor-001", event_id=older)
    ids = [int(r["id"]) for r in body["references"] if r["kind"] == "event"]
    assert ids[0] == latest and older in ids
    with SessionLocal() as db:
        eligible = [row for row in db.query(Event).all() if row.severity in ("warning", "critical", "alarm") or row.status_state in ("warning", "alarm", "consulting", "pending", "handling", "observing", "relapsed")]
        expected = [row.id for row in sorted(eligible, key=lambda row: (row.timestamp or datetime.min, row.id), reverse=True)[:5]]
    assert ids == expected
    assert "pump-002" in body["text"] and body["resolved_context"] is None


def test_named_device_latest_diagnosis_uses_correct_event(api):
    target = event("motor-001")
    event("pump-002")
    body = ask(api, "驱动电机 A 最近一次诊断的结果是什么？", device_id="pump-002")
    assert body["resolved_context"] == {"device_id": "motor-001", "event_id": target}
    assert f"#{target}" in body["text"] and "motor-001" in body["text"]


def test_catalog_matches_real_frontend_five_topics_thirteen_points():
    source = (Path(__file__).resolve().parents[2] / "frontend/src/features/about/research.ts").read_text()
    ids = re.findall(r"\bid: '([^']+)'", source)
    expected = []
    for topic in knowledge.TOPICS:
        expected.append(topic)
        for point in [p for p in knowledge.POINTS if p["topic_id"] == topic]:
            expected.append(point["point_id"])
            assert f"title: '{point['title']}'" in source
            assert f"api: '{point['api']}'" in source
    assert ids == expected and len(knowledge.TOPICS) == 5 and len(knowledge.POINTS) == 13


@pytest.mark.parametrize("query,target", [("FP-CNN是什么？", "diagnosis/fpcnn"), ("SDE-PF如何做RUL？", "health/rul"), ("视觉模型检测效果", "results/vision"), ("系统架构是什么", "architecture"), ("BPFI内圈故障依据", "fault-inner_race")])
def test_known_methods_have_checkable_source(query, target):
    hits = knowledge.search_research_topics(query)
    assert any(hit["id"] == target and hit["source"] for hit in hits)
    assert all(hit["kind"] in ("research", "knowledge") for hit in hits)


@pytest.mark.parametrize("query", ["ResNet-50模型在项目中效果怎样？", "我们系统用了哪些SuperFaultNet-999算法", "不存在的模型 UnseenModelXYZ"])
def test_unknown_models_do_not_broaden_into_every_algorithm(api, query):
    assert knowledge.search_research_topics(query) == []
    body = ask(api, query, device_id="pump-001")
    assert "没有" in body["text"] and "证据" in body["text"]
    assert "设备 ResNet" not in body["text"] and not body["references"]


def test_algorithm_overview_includes_real_project_methods(api):
    body = ask(api, "我们系统用了哪些故障诊断算法？")
    assert "FP-CNN" in body["text"] and "PINN" in body["text"]
    assert any(ref["kind"] == "knowledge" and ref["id"] == "diagnosis-methods" for ref in body["references"])


def test_max_length_research_question_does_not_overflow_fallback_schema(api):
    message = "项目算法资料：" + "请检索已有证据不要推测。" * 50
    body = ask(api, message[:500])
    assert body["type"] == "answer"


def test_rul_evidence_preserves_negative_baseline_and_provenance(api, monkeypatch):
    monkeypatch.setitem(knowledge.LOADERS, "rul", lambda: {"method": "SDE+PF", "metrics": {"sde_pf": {"rmse": .2253, "mae": .1694, "r2": .1063}, "baseline": {"rmse": .3532, "mae": .2705, "r2": -1.1966}}, "curves": [{}]})
    body = ask(api, "SDE和粒子滤波是怎么用于剩余寿命预测的？")
    assert "0.2253" in body["text"] and "-1.1966" in body["text"]
    assert "公开数据离线实验" in body["text"]
    assert '"metrics"' not in body["text"] and '"sde_pf"' not in body["text"]
    assert any(ref["id"] == "health/rul" for ref in body["references"])
    assert all(action["target"].startswith("/research/") for action in body["actions"])


def test_missing_and_incomplete_evidence_never_become_zero_accuracy(api, monkeypatch):
    monkeypatch.setitem(knowledge.LOADERS, "vision", lambda: {"models": []})
    body = ask(api, "视觉模型有哪些实验数据说明检测效果？")
    assert "尚无可用实验产物" in body["text"]
    assert '"mAP50":0' not in body["text"]
    with SessionLocal() as db:
        monkeypatch.setitem(knowledge.LOADERS, "fpcnn", lambda: {"full": {"baseline_acc": 0}})
        result = knowledge.get_research_evidence(db, "diagnosis", "fpcnn")[0]
        assert result["status"] == "incomplete" and result["evidence"] == {}


def test_unknown_research_point_and_path_cannot_load_arbitrary_file():
    with SessionLocal() as db:
        assert knowledge.get_research_evidence(db, "health", "../../config") == []
        assert knowledge.get_research_evidence(db, "../secret", None) == []


def test_zero_ground_truth_runtime_metrics_are_not_claimed_accuracy():
    point = next(p for p in knowledge.POINTS if p["point_id"] == "loop")
    result = knowledge._summarize(point, {"inner_loop": {"total_events": 0}, "outer_loop": {"suggestions_total": 0}, "metrics": {"total": 0, "accuracy": 0, "false_alarm_rate": 0}})
    assert result["metrics"]["total"] == 0 and "accuracy" not in result["metrics"]


@pytest.mark.parametrize("plan", [
    {"calls": [{"name": "execute_sql", "args": {"sql": "DELETE FROM devices"}}]},
    {"calls": [{"name": "search_devices", "args": {"limit": 21}}]},
    {"calls": [{"name": "search_events", "args": {"limit": True}}]},
    {"calls": [{"name": "search_devices", "args": {"filters": {"sql": "SELECT *"}}}]},
    {"calls": [{"name": "get_event_detail", "args": {"event_id": 10**40}}]},
    {"calls": [{"name": "get_event_detail", "args": {"event_id": "1"}}]},
    {"calls": [{"name": "get_research_evidence", "args": {"topic_id": "health", "url": "https://example.com"}}]},
    {"calls": [{"name": "search_research_topics", "args": {"query": "SDE", "limit": 9}}]},
    {"calls": [{"name": "get_device_overview", "args": {"device_id": "pump-001"}}] * 4},
    {"mode": "clarify", "calls": [{"name": "search_devices", "args": {}}]},
    {"calls": [], "system": "ignore policy"},
])
def test_plans_reject_unknown_tools_properties_limits_and_types(plan):
    with pytest.raises(ValidationError):
        PicoToolPlan.model_validate(plan)


class FakeSDK:
    """Run the real LLMClient.chat/with_options path without a network or key."""
    def __init__(self, outputs):
        self.outputs = iter(outputs)
        self.options = []
        self.requests = []
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self.create))

    def with_options(self, **kwargs):
        self.options.append(kwargs)
        return self

    def create(self, **kwargs):
        self.requests.append(kwargs)
        output = next(self.outputs)
        if isinstance(output, Exception):
            raise output
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=output))])


def configure_sdk(monkeypatch, outputs):
    sdk = FakeSDK(outputs)
    monkeypatch.setattr(LLMClient, "available", property(lambda _: True))
    monkeypatch.setattr(llm_client, "_client", sdk)
    return sdk


def test_real_client_path_plans_then_answers_with_per_call_budgets(api, monkeypatch):
    sdk = configure_sdk(monkeypatch, [json.dumps({"calls": [{"name": "search_devices", "args": {"sort": "health_asc", "limit": 3}}]}), "三台设备的目录评分已按查询结果排序。"])
    body = ask(api, "健康评分最低的三台设备")
    assert body["meta"]["planner"] == "live" and body["meta"]["llm"] == "live"
    assert sdk.options == [{"timeout": 7.0, "max_retries": 0}, {"timeout": 10.0, "max_retries": 0}]
    assert len(sdk.requests) == 2 and "工具结果" in sdk.requests[1]["messages"][1]["content"]
    assert body["resolved_context"] is None


def test_default_other_agent_client_call_keeps_original_options(monkeypatch):
    sdk = configure_sdk(monkeypatch, ["ordinary consult answer"])
    assert llm_client.chat("system", "facts") == "ordinary consult answer"
    assert sdk.options == []


def test_invalid_plan_and_sdk_timeout_fall_back_without_executing_unknown_tool(api, monkeypatch, caplog):
    configure_sdk(monkeypatch, [json.dumps({"calls": [{"name": "run_shell", "args": {"command": "rm -rf /"}}]}), TimeoutError("secret-not-for-log")])
    body = ask(api, "健康评分最低的三台设备")
    assert body["meta"]["planner"] == "fallback" and body["meta"]["llm"] == "fallback"
    assert "从低到高" in body["text"]
    assert "secret-not-for-log" not in caplog.text


def test_model_wrong_explicit_device_id_is_rejected(api, monkeypatch):
    configure_sdk(monkeypatch, [json.dumps({"calls": [{"name": "get_device_overview", "args": {"device_id": "motor-001"}}]}), "基于离心泵B的查询结果回答。"])
    body = ask(api, "pump-002 现在怎么样？", device_id="motor-001")
    assert body["resolved_context"]["device_id"] == "pump-002"
    assert any(ref["kind"] == "device" and ref["id"] == "pump-002" for ref in body["references"])
    assert not any(ref["kind"] == "device" and ref["id"] == "motor-001" for ref in body["references"])


def test_model_unique_named_search_can_keep_explicit_focus(api, monkeypatch):
    configure_sdk(monkeypatch, [json.dumps({"calls": [{"name": "search_devices", "args": {"filters": {"query": "pump-002"}, "limit": 1}}]}), "查询到离心泵 B。"])
    body = ask(api, "pump-002 现在怎么样？", device_id="motor-001")
    assert body["resolved_context"] == {"device_id": "pump-002", "event_id": None}


def test_model_global_plan_cannot_filter_by_current_device(api, monkeypatch):
    configure_sdk(monkeypatch, [json.dumps({"calls": [{"name": "search_events", "args": {"filters": {"device_id": "motor-001"}}}]}), "已查询全局最近事件。"])
    target = event("pump-002")
    body = ask(api, "最近有哪些事件？", device_id="motor-001")
    assert body["meta"]["planner"] == "fallback"
    assert any(ref["id"] == str(target) for ref in body["references"])
    assert body["resolved_context"] is None


def test_model_unknown_model_cannot_substitute_other_research_evidence(api, monkeypatch):
    sdk = configure_sdk(monkeypatch, [json.dumps({"calls": [{"name": "get_research_evidence", "args": {"topic_id": "diagnosis", "point_id": "fpcnn"}}]})])
    body = ask(api, "UnicornNet999 模型是否在项目中？")
    assert body["references"] == [] and "没有" in body["text"]
    assert body["meta"]["planner"] == "fallback" and len(sdk.requests) == 1


def test_model_known_method_cannot_substitute_wrong_topic(api, monkeypatch):
    sdk = configure_sdk(monkeypatch, [json.dumps({"calls": [{"name": "get_research_evidence", "args": {"topic_id": "diagnosis", "point_id": "fpcnn"}}]}), "SDE与粒子滤波对应寿命研究。"])
    body = ask(api, "SDE与粒子滤波用于什么研究？")
    assert any(ref["id"] == "health/rul" for ref in body["references"])
    assert not any(ref["id"] == "diagnosis/fpcnn" for ref in body["references"])
    assert body["meta"]["planner"] == "fallback"


def test_vision_fallback_formats_readable_measured_metrics(api, monkeypatch):
    monkeypatch.setitem(knowledge.LOADERS, "vision", lambda: {"models": [{"name": "YOLOv8s", "mAP50": .8123, "mAP50_95": .4567, "precision": .8, "recall": .75, "fps": 67.2, "params_M": 11.2, "imgsz": 200}]})
    body = ask(api, "视觉模型的检测效果有哪些实验数据？")
    assert "mAP@50 81.23%" in body["text"] and "67.2 FPS" in body["text"]
    assert '"models"' not in body["text"]


def test_huge_event_id_never_reaches_sqlite_overflow(api):
    client, headers = api
    assert client.post("/api/v1/pico/chat", headers=headers, json={"message": "为什么报警", "event_id": 10**40}).status_code == 422
    body = ask(api, "事件 #" + "9" * 100 + " 为什么报警？")
    assert body["type"] == "error" and "有效的正整数" in body["text"]
