"""公开回放不再携带标签分数，会诊只接受模型输出。"""
from pathlib import Path

from app.modules.command_loop.service import CommandRejected, validate_dispatch
from app.modules.consult_models import consult_window
from app.modules.replay.readers import read_csv_rows, skab_points, xjtu_points

ROOT = Path(__file__).resolve().parents[2]


def _window(source: str, **extra):
    row = {
        "source": source,
        "vibration": 0.2,
        "current": 1.0,
        "pressure": 0.4,
        "temperature": 30.0,
        "speed": 20.0,
        "health_score": 92,
        "health_basis": "dataset_label",
        "fault_label": "试验台标注正常",
    }
    row.update(extra)
    return [dict(row) for _ in range(30)]


def test_skab_and_xjtu_replay_have_no_label_score():
    normal = skab_points(
        read_csv_rows(ROOT / "datasets/public/skab-repo/data/anomaly-free/anomaly-free.csv"),
        "正常工况",
    )
    fault = skab_points(
        read_csv_rows(ROOT / "datasets/public/skab-repo/data/other/13.csv"),
        "气蚀",
    )
    points = xjtu_points(ROOT / "backend/app/data/xjtu_rul.json", "Bearing1_1")
    assert normal and fault and points
    for item in (*normal[:5], *fault[:5], *points[:5], points[-1]):
        assert "health_score" not in item
        assert "health_basis" not in item
        assert "hi" not in item
        assert "rul" not in item
    assert fault[0]["vibration"] is not None
    assert points[0]["source"] == "public_replay"
    assert points[0]["vibration"] is not None


def test_consult_uses_model_and_ignores_planted_label():
    pumped = consult_window("pump-002", _window("public_replay", dataset="SKAB", sample_note="SKAB 气蚀试验 other/13"))
    assert pumped["diagnosis_method"] == "skab_probability"
    assert pumped["health_score"] != 92
    assert pumped["health_score"] != 42
    assert "other/13.csv" in pumped["model_card"]["holdout"]
    assert "anomaly-free/anomaly-free.csv" in pumped["model_card"]["train_range"] or "anomaly-free" in pumped["model_card"]["holdout"]
    assert pumped["model_card"]["test_metric"]["f1"] is not None
    text = str(pumped)
    assert "D-S" not in text
    assert "PINN" not in text
    assert "12 kHz" not in text

    motor = consult_window("motor-001", _window("public_replay", dataset="XJTU-SY", sample_note="Bearing1_1"))
    assert motor["diagnosis_method"] == "xjtu_rul"
    assert motor["fault_label"] == "预测剩余寿命比例"
    assert motor["model_card"]["test_metric"]["mae"] is not None
    assert "Bearing1_1" in motor["model_card"]["holdout"]
    assert motor["health_score"] != 92

    missing = consult_window("compressor-001", _window("public_replay", dataset="MetroPT-3"))
    assert missing["health_level"] == "unobserved"
    assert missing["health_score"] is None

    simulated = consult_window("pump-001", _window("simulation"))
    assert simulated["health_score"] is None
    assert simulated["health_level"] == "unobserved"


def test_dispatch_rejects_replay_and_free_text():
    try:
        validate_dispatch("public_replay", "lubricate")
        raise AssertionError("回放模式不应下发")
    except CommandRejected:
        pass
    try:
        validate_dispatch("simulation", "请润滑一下轴承")
        raise AssertionError("自由文本不应下发")
    except CommandRejected:
        pass
    assert validate_dispatch("simulation", "lubricate") == "lubricate"


def test_execute_enforces_mode_and_fixed_actions(monkeypatch):
    """指令下发的模式与动作校验接在真实接口上，不只是单元函数。"""
    from datetime import datetime

    from fastapi.testclient import TestClient

    from app.main import app
    from app.models import Event, SessionLocal
    from app.modules.command_loop.mqtt_publisher import mqtt_command_publisher

    with TestClient(app) as client:
        token = client.post(
            "/api/v1/auth/login", json={"username": "admin", "password": "admin123"}
        ).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        with SessionLocal() as db:
            event = Event(
                device_id="motor-002",
                event_type="diagnosis_event",
                status_state="handling",
                timestamp=datetime.utcnow(),
                agent_diagnosis={"report": {"recommendation": "润滑"}},
            )
            db.add(event)
            db.commit()
            db.refresh(event)
            eid = event.id
        monkeypatch.setattr(
            mqtt_command_publisher,
            "publish_command",
            lambda *args, **kwargs: {
                "command_id": "sandbox-replay",
                "topic": "sandbox/test",
                "published": True,
            },
        )
        base = f"/api/v1/command-loop/events/{eid}"

        rejected = client.post(base + "/execute", headers=headers, json={"operator": "admin", "command": "lubricate"})
        assert rejected.status_code == 400
        assert "回放" in rejected.json()["detail"]

        mode = client.post("/api/v1/devices/motor-002/mode", headers=headers, json={"run_mode": "simulation"})
        assert mode.status_code == 200
        assert mode.json()["run_mode"] == "simulation"

        free_text = client.post(base + "/execute", headers=headers, json={"operator": "admin", "command": "把轴承换了"})
        assert free_text.status_code == 400

        ok = client.post(base + "/execute", headers=headers, json={"operator": "admin", "command": "lubricate"})
        assert ok.status_code == 200
        assert ok.json()["command_id"] == "sandbox-replay"

        devices = client.get("/api/v1/devices").json()
        assert next(d for d in devices if d["id"] == "motor-002")["run_mode"] == "simulation"

        assert client.post(
            "/api/v1/devices/motor-002/mode", headers=headers, json={"run_mode": "public_replay"}
        ).status_code == 200
        assert client.post(
            "/api/v1/devices/motor-002/mode", headers=headers, json={"run_mode": "whatever"}
        ).status_code == 400
