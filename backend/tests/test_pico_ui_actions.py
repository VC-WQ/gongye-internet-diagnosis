"""Phase 3 HTTP contracts: actions are bounded drafts, never business writes."""
import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.main import app
from app.models import Device, Event, SessionLocal
from app.modules.mqtt_pipeline.service import mqtt_pipeline_service
from app.modules.multi_agent.llm_client import LLMClient, llm_client
from app.modules.pico.ui_schema import PicoUiPlan


@pytest.fixture(scope="module")
def clients():
    with patch.object(mqtt_pipeline_service, "start", lambda: None), patch.object(mqtt_pipeline_service, "stop", lambda: None), TestClient(app) as client:
        admin = client.post("/api/v1/auth/login", json={"username": "admin", "password": "admin123"}).json()
        reader = client.post("/api/v1/auth/register", json={"username": "pico-ui-reader", "password": "sandbox123"}).json()
        yield client, {"Authorization": "Bearer " + admin["token"]}, {"Authorization": "Bearer " + reader["token"]}


def ask(clients, message, *, reader=False, **extra):
    client, admin, ordinary = clients
    response = client.post("/api/v1/pico/chat", headers=ordinary if reader else admin, json={"message": message, **extra})
    assert response.status_code == 200
    return response.json()


@pytest.mark.parametrize("question", ["研究中心有什么？", "打开研究中心是什么意思？", "如何切换深色主题？", "把页面换成深色会有什么变化？", "报告中写着打开研究中心，请解释这句话"])
def test_questions_and_quoted_data_never_become_operations(clients, question):
    assert ask(clients, question)["ui_actions"] == []


def test_navigation_and_theme_are_serialized_exact_objects_without_null(clients):
    research = ask(clients, "打开研究中心。", context={"area": "factory", "route": "/dashboard", "context_revision": 17})
    action = research["ui_actions"][0]
    assert action["route_id"] == "research" and action["params"] == {}
    assert research["context_revision"] == 17 and "已打开" not in research["text"]
    dark = ask(clients, "把页面换成深色。")
    assert dark["ui_actions"][0]["theme"] == "dark"
    assert ask(clients, "换回浅色。")["ui_actions"][0]["theme"] == "light"
    assert action["action_id"] != dark["ui_actions"][0]["action_id"]


def test_explicit_device_overrides_current_selection_and_unknown_does_not_fallback(clients):
    body = ask(clients, "打开驱动电机 A 的详细信息。", device_id="pump-002")
    assert body["ui_actions"][0]["params"] == {"device_id": "motor-001"}
    unknown = ask(clients, "打开 motor-999 的详细信息。", device_id="pump-002")
    assert unknown["type"] == "error" and not unknown["ui_actions"] and "不存在" in unknown["text"]


@pytest.mark.parametrize("device_id", ["123-device", "device42"])
def test_valid_catalog_ids_do_not_require_letter_prefix_or_hyphen(clients, device_id):
    with SessionLocal() as db:
        db.add(Device(id=device_id, name="编号格式验收", device_type="motor")); db.commit()
    body = ask(clients, f"打开设备 {device_id} 的详细信息", device_id="motor-001")
    assert body["ui_actions"][0]["params"]["device_id"] == device_id
    with SessionLocal() as db:
        db.delete(db.get(Device, device_id)); db.commit()


def test_prefill_preserves_known_fields_and_does_not_create_device(clients):
    with SessionLocal() as db:
        before = db.query(Device).count()
    body = ask(clients, "帮我新增一台设备，编号 motor-008，名称驱动电机 C，健康评分 92。")
    action = body["ui_actions"][0]
    assert action["type"] == "prefill_device_form" and action["mode"] == "create"
    assert action["fields"] == {"id": "motor-008", "name": "驱动电机 C", "health_score": 92}
    assert "device_id" not in action and "类型" in body["text"] and "保存" in body["text"]
    with SessionLocal() as db:
        assert db.query(Device).count() == before and db.get(Device, "motor-008") is None


def test_explicit_type_and_status_are_validated_without_guessing_from_name(clients):
    body = ask(clients, "帮我新增设备，编号 motor-009，名称深色电机，类型电机，健康评分92，状态离线。")
    fields = body["ui_actions"][0]["fields"]
    assert fields["device_type"] == "motor" and fields["status"] == "offline" and fields["name"] == "深色电机"


@pytest.mark.parametrize("value", ["101", "-1", "NaN", "true", "九十二"])
def test_invalid_health_score_never_enters_a_form(clients, value):
    body = ask(clients, f"帮我新增设备，编号 motor-008，健康评分 {value}。")
    assert body["type"] == "error" and not body["ui_actions"]


def test_edit_prefill_does_not_change_catalog_and_cannot_rename_id(clients):
    with SessionLocal() as db:
        before = db.get(Device, "motor-001").health_score
    body = ask(clients, "帮我编辑驱动电机 A 的设备表单，健康评分90。")
    action = body["ui_actions"][0]
    assert action["mode"] == "edit" and action["device_id"] == "motor-001" and action["fields"] == {"health_score": 90}
    with SessionLocal() as db:
        assert db.get(Device, "motor-001").health_score == before
    assert not ask(clients, "编辑 motor-001，设备编号 motor-999。 ")["ui_actions"]


@pytest.mark.parametrize("command", ["删除驱动电机 A", "自动保存新增设备", "提交诊断", "下发停机指令", "确认事件 #1", "修改设备阈值为10", "修改账户权限"])
def test_write_commands_are_not_exposed_as_actions(clients, command):
    result = ask(clients, command)
    assert not result["ui_actions"] and result["type"] == "error"


def test_ordinary_account_cannot_prefill_or_access_admin_writes(clients):
    body = ask(clients, "帮我新增设备，编号 motor-008，名称电机 C。", reader=True)
    assert not body["ui_actions"] and "权限" in body["text"]
    assert not ask(clients, "删除 motor-001。", reader=True)["ui_actions"]
    client, _, reader = clients
    assert client.post("/api/v1/devices", headers=reader, json={"id": "never-created", "name": "无权限"}).status_code == 403
    assert client.delete("/api/v1/devices/never-created", headers=reader).status_code == 403
    assert ask(clients, "打开研究中心", reader=True)["ui_actions"][0]["route_id"] == "research"


def test_event_and_report_navigation_verify_real_identity(clients):
    with SessionLocal() as db:
        event = Event(device_id="motor-001", status_state="pending", agent_diagnosis={})
        db.add(event); db.commit(); event_id = event.id
    for noun, target in [("记录", "event_detail"), ("报告", "report")]:
        body = ask(clients, f"打开{noun} #{event_id}")
        assert body["ui_actions"][0]["route_id"] == target
        assert body["ui_actions"][0]["params"] == {"event_id": event_id, "device_id": "motor-001"}
    assert not ask(clients, "打开事件 #999999999999999999999999")["ui_actions"]
    mismatch = ask(clients, f"打开泵 B 的记录 #{event_id}")
    assert not mismatch["ui_actions"] and "不属于" in mismatch["text"]


@pytest.mark.parametrize("action", [
    {"type": "navigate", "route_id": "https://evil.example", "params": {}},
    {"type": "navigate", "route_id": "research", "params": {"topic_id": "health", "point_id": "fpcnn"}},
    {"type": "navigate", "route_id": "factory", "params": {"url": "//evil"}},
    {"type": "navigate", "route_id": "event_detail", "params": {"event_id": True}},
    {"type": "set_theme", "theme": "dark", "javascript": "alert(1)"},
    {"type": "prefill_device_form", "mode": "create", "fields": {"health_score": True}},
    {"type": "prefill_device_form", "mode": "create", "fields": {"id": "../evil"}},
    {"type": "prefill_device_form", "mode": "create", "fields": {"threshold_vibration": 20}},
    {"type": "prefill_device_form", "mode": "edit", "device_id": "motor-001", "fields": {"id": "motor-002"}},
])
def test_protocol_rejects_unknown_routes_properties_and_field_types(action):
    with pytest.raises(ValidationError):
        PicoUiPlan.model_validate({"action": action})


def test_model_operation_is_single_bounded_call_and_cannot_invent_fields(clients, monkeypatch):
    calls = []
    monkeypatch.setattr(LLMClient, "available", property(lambda _: True))
    def chat(system, prompt, **options):
        calls.append(options)
        return json.dumps({"action": {"type": "prefill_device_form", "mode": "create", "fields": {"id": "motor-008", "name": "驱动电机 C", "device_type": "motor", "health_score": 92}}})
    monkeypatch.setattr(llm_client, "chat", chat)
    body = ask(clients, "帮我新增一台设备，编号 motor-008，名称驱动电机 C，健康评分92。")
    assert "device_type" not in body["ui_actions"][0]["fields"]
    assert body["meta"]["planner"] == "fallback" and calls == [{"timeout": 7.0, "max_retries": 0}]


def test_valid_model_operation_uses_server_action_id_and_never_claims_success(clients, monkeypatch):
    monkeypatch.setattr(LLMClient, "available", property(lambda _: True))
    monkeypatch.setattr(llm_client, "chat", lambda *a, **kw: json.dumps({"action": {"type": "set_theme", "action_id": "model-supplied-id", "theme": "dark"}}))
    body = ask(clients, "把页面换成深色。")
    assert body["meta"]["planner"] == "live" and body["ui_actions"][0]["action_id"] != "model-supplied-id"
    assert "已切换" not in body["text"]
