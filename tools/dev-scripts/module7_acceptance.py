"""模块7 端到端验收：诊断效果闭环 + 阈值自适应 + 准确率自跟踪。

覆盖：
  1. 成功恢复：告警->会诊->确认->执行->观察->恢复（偏差<15%）
  2. 失败恢复：偏差>30% -> relapsed -> 触发再诊断
  3. 模拟 5 次误报 -> generate_suggestions 生成>=1 条建议
  4. 人工 accept -> 审计写入 -> 前后值可查
  5. record_ground_truth 注入 20 条（Normal/IR/OR/Ball 各 5 条）
  6. GET /self-eval/metrics 返回滚动指标
  7. 3 个 API 端点可调用（suggestions / accept / metrics）

运行：cd backend && ..\\.venv\\Scripts\\python.exe ..\\tmp\\module7_acceptance.py
"""
import sys
from pathlib import Path

ROOT = Path(r'd:\24006055周余露\大三上的文件\企业云\工业互联网系统')
BACKEND = ROOT / 'backend'
sys.path.insert(0, str(BACKEND))

import numpy as np
from fastapi.testclient import TestClient

from app.main import app
from app.models import Base, SessionLocal, engine
from app.models.event import Event
from app.modules.command_loop.accuracy_tracker import accuracy_tracker
from app.modules.command_loop.feedback_loop import feedback_loop_service
from app.modules.command_loop.models import EventTimeline
from app.modules.command_loop.service import command_loop_service
from app.modules.command_loop.threshold_adapter import threshold_adapter

NPZ = str(ROOT / 'datasets' / 'CWRU' / 'processed.npz')


def alarm_window(index: int = 234) -> list[dict]:
    """取 CWRU OR#234 告警样本构造传感器窗口。"""
    data = np.load(NPZ)
    x = data['X'][index].flatten().tolist()
    return [{"vibration": float(v)} for v in x]


def print_timeline(db, event_id: int, title: str) -> None:
    rows = (
        db.query(EventTimeline)
        .filter(EventTimeline.event_id == event_id)
        .order_by(EventTimeline.id.asc())
        .all()
    )
    print(f"  ----- 时间线：{title} (event_id={event_id}) -----")
    for r in rows:
        frm = r.from_state or '(初始)'
        print(f"    [{r.created_at.isoformat()[:19]}] {frm} -> {r.to_state:9s} "
              f"| 操作人={r.operator} | 原因={r.reason}")


def inject_false_alarms(db, device_id: str) -> None:
    """注入 5 次误报（两类来源，健康分均在阈值±5 区间）。

    来源1：feedback_result.diagnosis_confirmed=False（3 次）
    来源2：人工拒绝（pending->alarm，2 次）
    """
    scores = [56.0, 58.0, 60.0, 62.0, 64.0]
    for i, hs in enumerate(scores):
        ev = Event(
            device_id=device_id,
            event_type="diagnosis_event",
            status_state="alarm",
            severity="critical",
            sensor_data=[],
            agent_diagnosis={"health_score": hs, "fault_type": "normal", "confidence": 0.5},
        )
        db.add(ev)
        db.flush()
        if i < 3:  # 来源1：诊断未确认
            ev.feedback_result = {"diagnosis_confirmed": False, "verdict": "relapsed"}
        else:      # 来源2：人工拒绝
            db.add(
                EventTimeline(
                    event_id=ev.id,
                    device_id=device_id,
                    from_state="pending",
                    to_state="alarm",
                    reason=f"人工拒绝：设备{i}误报，健康分{hs:.0f}在阈值附近",
                    operator="王工",
                )
            )
    db.commit()


def main() -> None:
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()

    print("#" * 80)
    print("流程1：成功恢复（偏差<15%）")
    print("#" * 80)
    win = alarm_window(234)
    e1 = command_loop_service.create_event(db, "dev-succ", win, "system")
    command_loop_service.confirm(db, e1['id'], "张工")
    command_loop_service.execute(db, e1['id'], "张工")
    r1 = feedback_loop_service.observe_and_evaluate(db, e1['id'], [30, 45, 60, 75, 85], "张工")
    print(f"  结果状态={r1['status_state']}，判定={r1['feedback_result']['verdict']}，"
          f"偏差={r1['feedback_result']['deviation_pct']}%，确认诊断={r1['feedback_result']['diagnosis_confirmed']}")
    print_timeline(db, e1['id'], "成功恢复")

    print("\n" + "#" * 80)
    print("流程2：失败恢复（偏差>30% -> relapsed -> 再诊断）")
    print("#" * 80)
    e2 = command_loop_service.create_event(db, "dev-fail", win, "system")
    command_loop_service.confirm(db, e2['id'], "李工")
    command_loop_service.execute(db, e2['id'], "李工")
    r2 = feedback_loop_service.observe_and_evaluate(db, e2['id'], [30, 30, 30, 30, 30], "李工")
    print(f"  结果状态={r2['status_state']}，判定={r2['feedback_result']['verdict']}，"
          f"偏差={r2['feedback_result']['deviation_pct']}%，触发再诊断={r2['feedback_result']['trigger_rediagnosis']}")
    print_timeline(db, e2['id'], "复发再诊断")

    print("\n" + "#" * 80)
    print("流程3：模拟 5 次误报 -> 生成阈值建议")
    print("#" * 80)
    inject_false_alarms(db, "dev-fp")
    suggestions = threshold_adapter.generate_suggestions(db, "dev-fp")
    assert len(suggestions) >= 1, "应生成至少 1 条阈值建议"
    s = suggestions[0]
    print(f"  生成建议 #{s['id']}：device={s['device_id']} "
          f"{s['old_value']} -> {s['new_value']}，状态={s['status']}")
    print(f"  原因：{s['reason']}")

    print("\n" + "#" * 80)
    print("流程4：人工 accept -> 审计写入 -> 前后值可查")
    print("#" * 80)
    accepted = threshold_adapter.accept(db, s['id'], "王主任")
    print(f"  accept 后：status={accepted['status']}，采纳人={accepted['accepted_by']}，"
          f"采纳时间={accepted['accepted_at'][:19]}")
    print(f"  审计（前后值）：old={accepted['old_value']} -> new={accepted['new_value']}")

    print("\n" + "#" * 80)
    print("流程5：注入 20 条 ground truth（Normal/IR/OR/Ball 各 5 条）")
    print("#" * 80)
    # (predicted_fault, actual_fault, latency_seconds)
    entries = [
        ("normal", "normal", 45), ("normal", "normal", 50),
        ("normal", "normal", 40), ("normal", "normal", 55),
        ("inner_race", "normal", 70),          # 误报
        ("inner_race", "inner_race", 60), ("inner_race", "inner_race", 65),
        ("inner_race", "inner_race", 58), ("inner_race", "inner_race", 62),
        ("normal", "inner_race", 80),          # 漏报
        ("outer_race", "outer_race", 55), ("outer_race", "outer_race", 60),
        ("outer_race", "outer_race", 52), ("outer_race", "outer_race", 66),
        ("normal", "outer_race", 75),          # 漏报
        ("ball", "ball", 48), ("ball", "ball", 53),
        ("ball", "ball", 57), ("ball", "ball", 61),
        ("inner_race", "ball", 68),            # 错判（非误报/漏报）
    ]
    for i, (pred, actual, latency) in enumerate(entries):
        eid = 1000 + i  # 合成事件命名空间，避开真实事件 ID
        accuracy_tracker.record(db, eid, pred, latency)
        accuracy_tracker.record_ground_truth(db, eid, actual)
    print(f"  已注入 {len(entries)} 条诊断记录与根因")

    print("\n" + "#" * 80)
    print("流程6：3 个 API 端点可调用（TestClient）")
    print("#" * 80)
    client = TestClient(app)
    r_sug = client.get("/api/v1/threshold/suggestions")
    print(f"  GET /threshold/suggestions -> {r_sug.status_code}，建议数={len(r_sug.json())}")
    r_acc = client.post(f"/api/v1/threshold/suggestions/{s['id']}/accept", json={"operator": "王主任"})
    print(f"  POST /threshold/suggestions/{s['id']}/accept -> {r_acc.status_code}（已accept，重复操作预期400）")
    r_met = client.get("/api/v1/self-eval/metrics")
    print(f"  GET /self-eval/metrics -> {r_met.status_code}")

    print("\n" + "#" * 80)
    print("流程7：GET /self-eval/metrics 滚动指标")
    print("#" * 80)
    metrics = accuracy_tracker.metrics(db)
    for k, v in metrics.items():
        print(f"    {k}: {v}")

    db.close()
    print("\n验收完成。")


if __name__ == '__main__':
    main()