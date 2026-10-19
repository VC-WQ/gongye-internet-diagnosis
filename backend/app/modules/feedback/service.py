"""反馈评估与自适应校准模块（基于数据库的真实实现）。

职责：
- collect_feedback：把人工/系统反馈写入事件主表 feedback_result
- evaluate：读取诊断准确率记录，返回单次与整体评估
- calibrate：根据反馈生成阈值调整建议（复用 command_loop.threshold_adapter）
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Event
from app.modules.command_loop.models import DiagnosisRecord
from app.modules.command_loop.threshold_adapter import threshold_adapter


class FeedbackService:
    """反馈评估与自适应校准服务。"""

    def collect_feedback(self, db: Session, event_id: int, feedback: dict) -> dict:
        """收集并持久化反馈（写入 events.feedback_result）。"""
        event = db.get(Event, event_id)
        if event is None:
            raise ValueError(f"事件 {event_id} 不存在")

        payload = dict(event.feedback_result or {})
        payload.update(feedback)
        payload["collected_at"] = datetime.utcnow().isoformat()
        event.feedback_result = payload
        db.commit()
        return {"event_id": event_id, "status": "collected", "feedback": payload}

    def evaluate(self, db: Session, event_id: int) -> dict:
        """评估单次诊断质量，并返回该设备的累计准确率。"""
        record = (
            db.query(DiagnosisRecord)
            .filter(DiagnosisRecord.event_id == event_id)
            .order_by(DiagnosisRecord.id.desc())
            .first()
        )
        if record is None:
            return {"event_id": event_id, "available": False, "reason": "尚无诊断记录"}

        rows = (
            db.query(DiagnosisRecord)
            .filter(DiagnosisRecord.is_correct.isnot(None))
            .all()
        )
        total = len(rows)
        correct = sum(1 for r in rows if r.is_correct)
        return {
            "event_id": event_id,
            "available": True,
            "predicted_fault": record.predicted_fault,
            "actual_fault": record.actual_fault,
            "is_correct": record.is_correct,
            "latency_seconds": record.latency_seconds,
            "overall": {
                "total": total,
                "correct": correct,
                "accuracy": round(correct / total, 4) if total else None,
            },
        }

    def calibrate(self, db: Session, device_id: str) -> dict:
        """基于近期误报生成阈值调整建议（真实写库）。"""
        suggestions = threshold_adapter.generate_suggestions(db, device_id)
        return {
            "device_id": device_id,
            "generated": len(suggestions),
            "suggestions": suggestions,
        }


feedback_service = FeedbackService()
