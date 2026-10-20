"""Pico Phase 1：业务快照、显式实体、指代、缺失和时效边界。"""
from __future__ import annotations

import time
from datetime import datetime

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.models import Device, Event, SessionLocal
from app.modules.multi_agent.llm_client import LLMClient, llm_client
from app.modules.mqtt_pipeline.service import mqtt_pipeline_service
from app.modules.pico import tools


@pytest.fixture
def api(monkeypatch):
    monkeypatch.setattr(mqtt_pipeline_service, "start", lambda: None)
    monkeypatch.setattr(mqtt_pipeline_service, "stop", lambda: None)
    monkeypatch.setattr(mqtt_pipeline_service, "get_window", lambda _: [])
    with TestClient(app) as client:
        auth = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"})
        yield client, {"Authorization": f"Bearer {auth.json()['token']}"}


def ask(api, message="这台设备怎么样？", **kwargs):
    client, headers = api
    response = client.post("/api/v1/pico/chat", headers=headers, json={"message": message, **kwargs})
    assert response.status_code == 200
    return response.json()


def snapshot(device=None, event=None, revision=1):
    return {"area": "admin", "route": f"/manage/devices/{device}" if device else "/dashboard", "device_id": device, "event_id": event, "context_revision": revision}


def make_event(device_id="pump-002", diagnosis=None):
    with SessionLocal() as db:
        event = Event(device_id=device_id, severity="critical", status_state="pending", timestamp=datetime.utcnow(), sensor_data=[], agent_diagnosis=diagnosis if diagnosis is not None else {"fault_label": "内圈故障", "confidence": 0.93, "health_score": 41, "report": {"summary": "轴承内圈频率异常", "signal_evidence": "BPFI 处有谐波峰"}})
        db.add(event)
        db.commit()
        return event.id


def test_snapshot_switch_is_authoritative_and_echoes_revision(api):
    first = ask(api, context=snapshot("motor-001", revision=7))
    second = ask(api, context=snapshot("pump-002", revision=8), device_id="motor-001", history=[{"role": "assistant", "content": first["text"]}])
    assert first["resolved_context"]["device_id"] == "motor-001"
    assert second["resolved_context"]["device_id"] == "pump-002"
    assert "离心泵 B" in second["text"] and "驱动电机 A" not in second["text"]
    assert second["context_revision"] == 8


def test_empty_snapshot_does_not_fall_back_to_legacy_or_first_device(api):
    body = ask(api, context=snapshot(), device_id="pump-001")
    assert body["type"] == "error"
    assert "没有设备上下文" in body["text"]
    assert body["resolved_context"] is None


@pytest.mark.parametrize("message", ["pump-002 现在怎么样？", "离心泵 B 怎么样？", "泵 B 运行状态怎样？"])
def test_explicit_real_device_overrides_current_page(api, message):
    event = make_event("motor-001")
    body = ask(api, message, context=snapshot("motor-001", event))
    assert body["resolved_context"]["device_id"] == "pump-002"
    assert body["resolved_context"]["event_id"] != event
    assert "pump-002" in body["text"]


def test_pronoun_prefers_same_snapshot_focus_but_this_device_uses_page(api):
    target = {"device_id": "pump-002"}
    followup = ask(api, "它现在怎么样？", context=snapshot("motor-001"), conversation_focus=target)
    current = ask(api, "这台设备怎么样？", context=snapshot("motor-001"), conversation_focus=target)
    assert followup["resolved_context"]["device_id"] == "pump-002"
    assert current["resolved_context"]["device_id"] == "motor-001"


@pytest.mark.parametrize("message", ["no-such-device 怎么样？", "电机 Z 怎么样？"])
def test_unknown_explicit_device_does_not_fall_back_to_current(api, message):
    body = ask(api, message, context=snapshot("motor-001"))
    assert body["type"] == "error"
    assert body["references"] == []


def test_ambiguous_name_requires_clarification(api):
    with SessionLocal() as db:
        db.add(Device(id="pico-context-duplicate", name="驱动电机 A", device_type="motor", health_score=50))
        db.commit()
    try:
        body = ask(api, "驱动电机 A 怎么样？")
        assert body["type"] == "error" and "多台设备" in body["text"]
    finally:
        with SessionLocal() as db:
            db.delete(db.get(Device, "pico-context-duplicate"))
            db.commit()


def test_event_reason_followup_uses_owning_device_and_persisted_evidence(api):
    event = make_event()
    body = ask(api, "它为什么会有这个问题？", context=snapshot("motor-001"), conversation_focus={"device_id": "pump-002", "event_id": event})
    assert body["resolved_context"] == {"device_id": "pump-002", "event_id": event}
    assert "BPFI" in body["text"] and "内圈故障" in body["text"]


def test_explicit_event_overrides_page_but_inconsistent_snapshot_is_rejected(api):
    event = make_event()
    explicit = ask(api, f"事件 #{event} 为什么报警？", context=snapshot("motor-001"))
    assert explicit["resolved_context"] == {"device_id": "pump-002", "event_id": event}
    mismatch = ask(api, "为什么报警？", context=snapshot("motor-001", event))
    assert mismatch["type"] == "error" and "不一致" in mismatch["text"]


def test_device_question_includes_latest_saved_diagnosis_with_timestamp(api):
    event = make_event("motor-002")
    body = ask(api, context=snapshot("motor-002"))
    assert f"#{event}" in body["text"] and "记录时间" in body["text"]
    assert body["resolved_context"]["event_id"] == event


def test_why_without_selected_event_uses_latest_device_event(api):
    event = make_event("compressor-002")
    body = ask(api, "它为什么会有这个问题？", context=snapshot("compressor-002"))
    assert body["resolved_context"]["event_id"] == event
    assert "BPFI" in body["text"]


def test_missing_catalog_does_not_destroy_historical_event_or_report(api):
    event = make_event("pico-context-deleted")
    for message in ("这个事件为什么报警？", "这条报告写了什么？"):
        body = ask(api, message, context=snapshot(event=event))
        assert body["type"] == "answer"
        assert "已不在当前目录" in body["text"]
        assert body["resolved_context"] == {"device_id": "pico-context-deleted", "event_id": event}
    current = ask(api, "这台设备现在怎么样？", context=snapshot(event=event))
    assert current["type"] == "error" and "无法查询其当前状态" in current["text"]


def test_empty_event_has_no_invented_diagnosis_or_number(api):
    event = make_event(diagnosis={})
    body = ask(api, "为什么报警？", context=snapshot(event=event))
    assert "未分类" in body["text"] and "没有更多可追溯依据" in body["text"]
    assert "None" not in body["text"] and "0.9" not in body["text"]


def test_missing_navigation_context_returns_error_not_server_error(api):
    body = ask(api, "带我去", context=snapshot(revision=33))
    assert body["type"] == "error" and body["context_revision"] == 33


def test_reason_without_target_asks_instead_of_picking_global_event(api):
    make_event()
    body = ask(api, "它为什么报警？", context=snapshot())
    assert body["type"] == "error" and "没有设备或事件上下文" in body["text"]


@pytest.mark.parametrize("age,stale", [(2, False), (16, True)])
def test_telemetry_freshness_and_observation_timestamp(api, monkeypatch, age, stale):
    timestamp = time.time() - age
    monkeypatch.setattr(mqtt_pipeline_service, "get_window", lambda _: [{"timestamp": timestamp, "vibration": 0.1212, "temperature": 42.28, "source": "simulation"}])
    body = ask(api, context=snapshot("pump-001"))
    assert body["meta"]["data_status"] == ("stale" if stale else "current")
    assert body["meta"]["source_kind"] == "simulated"
    observed = body["references"][0]["observed_at"]
    assert datetime.fromisoformat(observed).timestamp() == pytest.approx(timestamp)
    assert "已超过 15 秒" in body["text"] if stale else "42.3 ℃" in body["text"]


@pytest.mark.parametrize("timestamp", [float("nan"), float("inf"), time.time() + 500, -1])
def test_invalid_timestamps_never_become_current(api, monkeypatch, timestamp):
    monkeypatch.setattr(mqtt_pipeline_service, "get_window", lambda _: [{"timestamp": timestamp, "vibration": float("inf"), "temperature": float("nan")}])
    body = ask(api, context=snapshot("pump-001"))
    assert body["meta"]["data_status"] == "missing"
    assert body["references"][0]["observed_at"] is None
    assert "nan" not in body["text"].lower() and "inf" not in body["text"].lower()


def test_model_failure_returns_same_grounded_fallback(api, monkeypatch):
    monkeypatch.setattr(LLMClient, "available", property(lambda _: True))
    monkeypatch.setattr(llm_client, "chat", lambda *_: None)
    body = ask(api, context=snapshot("pump-002"))
    assert body["meta"]["llm"] == "fallback" and body["meta"]["degraded"]
    assert "68.0" in body["text"]


def test_snapshot_rejects_extra_sensitive_or_unbounded_fields(api):
    client, headers = api
    for context in ({**snapshot(), "token": "never-upload"}, {**snapshot(), "event_id": "1"}, {**snapshot(), "context_revision": -1}, {**snapshot(), "route": "https://example.com"}):
        response = client.post("/api/v1/pico/chat", headers=headers, json={"message": "你好", "context": context})
        assert response.status_code == 422


def test_regular_authenticated_user_can_read_but_anonymous_cannot(api):
    client, _ = api
    account = client.post("/api/v1/auth/register", json={"username": "pico_context_reader", "password": "isolated-reader-123"})
    assert account.status_code == 200
    headers = {"Authorization": f"Bearer {account.json()['token']}"}
    event = make_event()
    body = {"message": "为什么报警？", "context": snapshot(event=event)}
    assert client.post("/api/v1/pico/chat", headers=headers, json=body).status_code == 200
    assert client.post("/api/v1/pico/chat", json=body).status_code == 401
    assert tools.READ_ONLY_TOOLS == ["get_device_overview", "get_device_telemetry", "list_device_events", "get_event_detail", "get_report_summary"]
