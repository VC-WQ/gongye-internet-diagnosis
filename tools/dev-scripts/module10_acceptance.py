"""模块10 动态阈值效果跟踪端到端验收。

演示叙事：采纳前 5 次误报 → 采纳建议 → 采纳后 1 次误报 → 误报减少 4 次
（"采纳后误报从 5 次降到 1 次，说明建议有效"）。

覆盖：
  1. 注入 5 次采纳前误报（diagnosis_confirmed=False，健康分 56~64）
  2. generate_suggestions 生成建议 + 人工 accept
  3. 注入 1 次采纳后误报（accepted_at + 1 天，相对未来，非远未来）
  4. GET /threshold/effects/{id}    -> before=5 / after=1 / reduction=4
  5. GET /threshold/effects         列表可调
  6. GET /threshold/history/{device} 调整历史可查
  7. window_days 参数可配置

运行：cd backend && ..\\.venv\\Scripts\\python.exe ..\\tmp\\module10_acceptance.py
"""
import json
import sys
from datetime import datetime, timedelta
from pathlib import Path

ROOT = Path(r'd:\24006055周余露\大三上的文件\企业云\工业互联网系统')
BACKEND = ROOT / 'backend'
sys.path.insert(0, str(BACKEND))

from fastapi.testclient import TestClient

from app.main import app
from app.models import Base, SessionLocal, engine
from app.models.event import Event
from app.modules.command_loop.models import ThresholdSuggestion
from app.modules.command_loop.threshold_adapter import threshold_adapter

DEVICE = "dev-effect-demo11"  # 每次验收用独立设备ID，避免历史数据干扰


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    now = datetime.utcnow()

    print("#" * 80)
    print("流程1：注入 5 次采纳前误报（diagnosis_confirmed=False，健康分 56~64）")
    print("#" * 80)
    scores = [56.0, 58.0, 60.0, 62.0, 64.0]
    for hs in scores:
        db.add(Event(
            device_id=DEVICE,
            event_type="alarm",
            status_state="alarm",
            severity="critical",
            timestamp=now - timedelta(days=3),  # 采纳前窗口内
            agent_diagnosis={"fault_type": "normal", "health_score": hs},
            feedback_result={"diagnosis_confirmed": False},
        ))
    db.commit()
    print(f"  已注入 5 条误报事件，timestamp={ (now - timedelta(days=3)).isoformat(timespec='seconds') }")

    print("\n" + "#" * 80)
    print("流程2：generate_suggestions 生成建议")
    print("#" * 80)
    sug = threshold_adapter.generate_suggestions(db, DEVICE)
    assert len(sug) == 1, f"期望生成 1 条建议，实际 {len(sug)}"
    sid = sug[0]["id"]
    print(f"  生成建议 #{sid}: {sug[0]['old_value']} -> {sug[0]['new_value']}")

    print("\n" + "#" * 80)
    print("流程3：人工采纳")
    print("#" * 80)
    acc = threshold_adapter.accept(db, sid, "王主任")
    accepted_at = db.get(ThresholdSuggestion, sid).accepted_at
    print(f"  采纳人={acc['accepted_by']}，accepted_at={accepted_at.isoformat(timespec='seconds')}")

    print("\n" + "#" * 80)
    print("流程4：注入 1 次采纳后误报（accepted_at + 1 天，相对未来）")
    print("#" * 80)
    after_ts = accepted_at + timedelta(days=1)
    db.add(Event(
        device_id=DEVICE,
        event_type="alarm",
        status_state="alarm",
        severity="critical",
        timestamp=after_ts,
        agent_diagnosis={"fault_type": "normal", "health_score": 63.0},
        feedback_result={"diagnosis_confirmed": False},
    ))
    db.commit()
    print(f"  已注入 1 条，timestamp={after_ts.isoformat(timespec='seconds')}")

    client = TestClient(app)

    print("\n" + "#" * 80)
    print("流程5：GET /threshold/effects/{sid}（单条效果）")
    print("#" * 80)
    r1 = client.get(f"/api/v1/threshold/effects/{sid}")
    assert r1.status_code == 200, r1.text
    eff = r1.json()
    print(json.dumps(eff, ensure_ascii=False, indent=2))
    assert eff["false_alarms_before"] == 5, eff
    assert eff["false_alarms_after"] == 1, eff
    assert eff["reduction"] == 4, eff

    print("\n" + "#" * 80)
    print("流程6：GET /threshold/effects（列表）")
    print("#" * 80)
    r2 = client.get("/api/v1/threshold/effects", params={"device_id": DEVICE})
    assert r2.status_code == 200, r2.text
    lst = r2.json()
    print(f"  -> {r2.status_code}，共 {len(lst)} 条效果")
    assert any(e["suggestion_id"] == sid and e["reduction"] == 4 for e in lst)

    print("\n" + "#" * 80)
    print("流程7：GET /threshold/history/{device}（调整历史）")
    print("#" * 80)
    r3 = client.get(f"/api/v1/threshold/history/{DEVICE}")
    assert r3.status_code == 200, r3.text
    hist = r3.json()
    print(json.dumps(hist, ensure_ascii=False, indent=2))
    assert hist["adjustment_count"] >= 1
    assert hist["history"][0]["effect"]["reduction"] == 4

    print("\n" + "#" * 80)
    print("流程8：window_days 参数可配置（15 天）")
    print("#" * 80)
    r4 = client.get(f"/api/v1/threshold/effects/{sid}", params={"window_days": 15})
    assert r4.status_code == 200, r4.text
    print(f"  -> {r4.status_code}，window_days={r4.json()['window_days']}")

    db.close()
    print("\n验收完成。")


if __name__ == '__main__':
    main()