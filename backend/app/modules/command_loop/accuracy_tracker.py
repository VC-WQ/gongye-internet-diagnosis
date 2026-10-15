"""模块7 诊断准确率自跟踪（闭环3）：诊断结论 vs 实际根因 -> 滚动指标。

每次事件恢复/复发后调用 record 记录预测故障与延迟；人工确认后调用
record_ground_truth 注入实际根因，得到 is_correct。
metrics 返回近 N 天（默认 30）滚动指标。
"""
from __future__ import annotations

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.models import get_db
from app.models.event import Event

from .models import DiagnosisRecord, EventTimeline, ThresholdSuggestion


class AccuracyTracker:
    """诊断准确率跟踪器。"""

    # ------------------------------------------------------------------
    # 记录
    # ------------------------------------------------------------------
    def record(
        self,
        db: Session,
        event_id: int,
        predicted_fault: str,
        latency_seconds: float = 0.0,
    ) -> DiagnosisRecord:
        """记录一次诊断结论（系统预测），actual_fault 待人工注入。"""
        rec = DiagnosisRecord(
            event_id=event_id,
            predicted_fault=predicted_fault,
            latency_seconds=float(latency_seconds),
        )
        db.add(rec)
        db.commit()
        db.refresh(rec)
        return rec

    def record_ground_truth(self, db: Session, event_id: int, actual_fault: str) -> DiagnosisRecord:
        """注入人工确认的实际根因，计算 is_correct。"""
        rec = (
            db.query(DiagnosisRecord)
            .filter(DiagnosisRecord.event_id == event_id)
            .order_by(DiagnosisRecord.id.desc())
            .first()
        )
        if rec is None:
            raise ValueError(f"事件 {event_id} 无诊断记录，无法注入根因")
        rec.actual_fault = actual_fault
        rec.is_correct = bool(rec.predicted_fault == actual_fault)
        db.commit()
        db.refresh(rec)
        return rec

    # ------------------------------------------------------------------
    # 滚动指标（近 N 天）
    # ------------------------------------------------------------------
    def metrics(self, db: Session, days: int = 30) -> dict:
        """返回近 days 天的滚动诊断指标。"""
        window_start = datetime.utcnow() - timedelta(days=days)
        records = (
            db.query(DiagnosisRecord)
            .filter(
                DiagnosisRecord.created_at >= window_start,
                DiagnosisRecord.actual_fault.isnot(None),
            )
            .all()
        )

        total = len(records)
        correct = sum(1 for r in records if r.is_correct)

        alarms = [r for r in records if r.predicted_fault != "normal"]
        false_alarms = [r for r in alarms if r.actual_fault == "normal"]

        faults = [r for r in records if r.actual_fault != "normal"]
        missed = [r for r in records if r.predicted_fault == "normal" and r.actual_fault != "normal"]

        avg_latency = sum(float(r.latency_seconds) for r in records) / total if total else 0.0
        calibration_count = (
            db.query(ThresholdSuggestion)
            .filter(ThresholdSuggestion.status == "accepted")
            .count()
        )

        return {
            "days": days,
            "total": total,
            "correct": correct,
            "accuracy": round(correct / total, 4) if total else 0.0,
            "alarm_count": len(alarms),
            "false_alarm_count": len(false_alarms),
            "false_alarm_rate": round(len(false_alarms) / len(alarms), 4) if alarms else 0.0,
            "fault_count": len(faults),
            "miss_count": len(missed),
            "miss_rate": round(len(missed) / len(faults), 4) if faults else 0.0,
            "avg_latency_seconds": round(avg_latency, 2),
            "threshold_calibration_count": calibration_count,
        }


accuracy_tracker = AccuracyTracker()

# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/self-eval", tags=["诊断准确率自跟踪"])


@router.get("/metrics")
def metrics(days: int = 30, db: Session = Depends(get_db)) -> dict:
    """返回近 days 天的滚动诊断指标。"""
    return accuracy_tracker.metrics(db, days)


@router.get("/loops")
def loops(days: int = 30, db: Session = Depends(get_db)) -> dict:
    """双闭环自进化的运行统计（供「系统自进化」页面呈现）。

    内闭环（事件级、分钟级）：异常 → 会诊 → 处置 → 观察期评估 →
        恢复则记入准确率；复发则**自动再诊断**并**自动触发阈值建议**。
    外闭环（系统级、天/周级）：阈值建议 → 人工采纳/拒绝 → 阈值生效 →
        影响下一轮异常检测，同时人工反馈累积为采纳率与准确率指标。
    """
    window_start = datetime.utcnow() - timedelta(days=days)

    # ---- 内闭环：按事件状态与观察期结论统计 ----
    # 注意：Event 模型的时间字段为 timestamp（不是 created_at）
    events = db.query(Event).filter(Event.timestamp >= window_start).all()  # type: ignore[attr-defined]
    by_state: dict[str, int] = {}
    feedback: dict[str, int] = {"recovered": 0, "relapsed": 0, "extend": 0}
    for e in events:
        st = str(e.status_state or "unknown")
        by_state[st] = by_state.get(st, 0) + 1
        verdict = (e.feedback_result or {}).get("verdict")
        if verdict in feedback:
            feedback[str(verdict)] += 1

    # 复发 → 自动再诊断次数（时间线中出现 relapsed->consulting）
    auto_reconsult = (
        db.query(EventTimeline)
        .filter(
            EventTimeline.created_at >= window_start,
            EventTimeline.to_state == "consulting",
            EventTimeline.reason.like("%复发%"),
        )
        .count()
    )

    # ---- 外闭环：阈值建议的采纳情况 ----
    sugs = db.query(ThresholdSuggestion).filter(ThresholdSuggestion.created_at >= window_start).all()
    s_total = len(sugs)
    s_accepted = sum(1 for s in sugs if s.status == "accepted")
    s_rejected = sum(1 for s in sugs if s.status == "rejected")
    s_pending = sum(1 for s in sugs if s.status == "pending")
    devices = {s.device_id for s in sugs if s.device_id}

    return {
        "days": days,
        "inner_loop": {
            "total_events": len(events),
            "by_state": by_state,
            "feedback_verdict": feedback,
            "auto_reconsult_count": auto_reconsult,
            "auto_suggestion_trigger_count": feedback["relapsed"],
            "note": (
                "事件级在线闭环：观察期恢复曲线评估为 relapsed 时，系统自动重新会诊 "
                "并自动生成阈值调整建议，无需人工介入。"
            ),
        },
        "outer_loop": {
            "suggestions_total": s_total,
            "accepted": s_accepted,
            "rejected": s_rejected,
            "pending": s_pending,
            "adoption_rate": round(s_accepted / s_total, 4) if s_total else 0.0,
            "devices_involved": len(devices),
            "note": (
                "系统级进化闭环：阈值建议由复发事件自动触发，人工采纳后写入动态阈值，"
                "直接改变下一轮异常检测的判定边界；采纳/拒绝比例即 AI 建议的可信度。"
            ),
        },
        "metrics": accuracy_tracker.metrics(db, days),
    }