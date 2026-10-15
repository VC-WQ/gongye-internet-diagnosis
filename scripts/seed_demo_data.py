"""注入系统自评与阈值效果的演示数据。

运行（项目根目录）：
    .venv\\Scripts\\python.exe scripts\\seed_demo_data.py

用途：让前端「系统自评」面板（诊断准确率/误报率/漏报率）与
「阈值效果跟踪」表格有可展示的数据（对应模块7/模块10 的验收口径）。
"""
from __future__ import annotations

import os
import random
import sys
from datetime import datetime, timedelta

# 将 backend 加入 sys.path，以便 import app.*
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "backend"))

from app.models import Event, SessionLocal  # noqa: E402
from app.modules.command_loop.models import (  # noqa: E402
    DiagnosisRecord,
    EventTimeline,
    ThresholdSuggestion,
)

random.seed(42)


def _days_ago(n: float) -> datetime:
    """n 天前的时间戳。"""
    return datetime.utcnow() - timedelta(days=n)


def seed() -> None:
    db = SessionLocal()
    try:
        # 清空旧演示数据，保证可控重来（保留 Event，供时间线/报告历史演示）
        db.query(DiagnosisRecord).delete()
        db.query(ThresholdSuggestion).delete()
        db.commit()

        # ------------------------------------------------------------------
        # 1. 诊断记录：4 类各 5 条，准确率约 80%（16 正确 / 4 错误）
        # ------------------------------------------------------------------
        faults = ["normal", "inner_race", "outer_race", "ball"]
        # 每类第 5 条为错误：predicted 不变，actual 错位（含 1 漏报 + 1 误报）
        wrong_actual = {
            "normal": "outer_race",  # 漏报：判正常，实际外圈故障
            "inner_race": "ball",
            "outer_race": "normal",  # 误报：判外圈，实际正常
            "ball": "inner_race",
        }
        idx = 0
        for fault in faults:
            for j in range(5):
                predicted = fault
                actual = wrong_actual[fault] if j == 4 else fault
                db.add(
                    DiagnosisRecord(
                        event_id=1000 + idx,
                        predicted_fault=predicted,
                        actual_fault=actual,
                        is_correct=(predicted == actual),
                        latency_seconds=round(random.uniform(0.8, 2.8), 2),
                        created_at=_days_ago(random.randint(0, 29)),
                    )
                )
                idx += 1

        # ------------------------------------------------------------------
        # 2. 阈值建议：2 条已采纳 + 1 条待处理
        # ------------------------------------------------------------------
        sugg_motor = ThresholdSuggestion(
            device_id="motor-002",
            old_value=85.0,
            new_value=88.0,
            reason="过去7天3次误报，均在84~86°C之间，负载正常，建议上调温度阈值",
            status="accepted",
            accepted_by="operator",
            created_at=_days_ago(10),
            accepted_at=_days_ago(7),
        )
        sugg_pump = ThresholdSuggestion(
            device_id="pump-001",
            old_value=0.50,
            new_value=0.62,
            reason="振动阈值偏严，正常工况多次触发预警",
            status="accepted",
            accepted_by="operator",
            created_at=_days_ago(20),
            accepted_at=_days_ago(17),
        )
        sugg_pending = ThresholdSuggestion(
            device_id="compressor-002",
            old_value=70.0,
            new_value=74.0,
            reason="温度阈值偏严，建议上调",
            status="pending",
            accepted_by=None,
            created_at=_days_ago(1),
            accepted_at=None,
        )
        db.add_all([sugg_motor, sugg_pump, sugg_pending])
        db.flush()

        # ------------------------------------------------------------------
        # 3. 误报链路：motor-002 在「采纳前7天」5 次误报、「采纳后7天」1 次
        #    使阈值效果表现为「采纳前 5 次 → 采纳后 1 次，减少 4 次」。
        #    采纳 anchor = 7 天前：
        #       before 窗口 [14天前, 7天前]，after 窗口 [7天前, 现在]
        # ------------------------------------------------------------------
        def _add_false_alarm(eid: int, device_id: str, created: datetime) -> None:
            ev = Event(
                device_id=device_id,
                event_type="diagnosis_event",
                status_state="alarm",
                severity="critical",
                timestamp=created,
                sensor_data=[],
                agent_diagnosis={"fault_type": "inner_race", "health_score": 55.0},
                feedback_result={"diagnosis_confirmed": False},
            )
            db.add(ev)
            db.flush()
            db.add(
                EventTimeline(
                    event_id=ev.id,
                    device_id=device_id,
                    from_state="pending",
                    to_state="alarm",
                    reason="人工拒绝：疑似误报",
                    operator="operator",
                    created_at=created + timedelta(minutes=2),
                )
            )

        # 采纳前（8~12 天前，落在 before 窗口）
        for k in range(5):
            _add_false_alarm(2000 + k, "motor-002", _days_ago(8 + k))
        # 采纳后（3 天前，落在 after 窗口）
        _add_false_alarm(2100, "motor-002", _days_ago(3))

        db.commit()
        print("演示数据注入完成：")
        print("  - 诊断记录 20 条（准确率约 80%）")
        print("  - 阈值建议 3 条（2 采纳 / 1 待处理）")
        print("  - 误报事件 6 条（采纳前 5 / 采纳后 1，减少 4）")
    finally:
        db.close()


if __name__ == "__main__":
    seed()