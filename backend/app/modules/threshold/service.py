"""模块10 动态阈值效果跟踪服务。

职责：对每条已采纳(accepted)的阈值建议，统计「采纳前 window_days 天」vs
「采纳后 window_days 天」的误报次数，量化误报减少量，并产出设备级阈值
调整历史。

边界：不修改模块7 的 threshold_adapter.py（只读复用其建议表 ThresholdSuggestion
与误报判定口径）。generate_suggestions 只统计「当前往前7天」，未暴露按任意
时间区间的统计接口，故本模块复刻其两条误报口径并参数化时间窗口：
    来源1：Event.feedback_result.diagnosis_confirmed == False
    来源2：EventTimeline: pending->alarm 且 reason 以「人工拒绝」开头

设备级覆盖阈值仍只是数据，不接入诊断判定（同模块7 补充3）。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from sqlalchemy.orm import Session

from app.models.event import Event
from app.modules.command_loop.models import EventTimeline, ThresholdSuggestion

from .models import ThresholdEffect

WINDOW_DAYS_DEFAULT = 7


class ThresholdEffectService:
    """阈值采纳后的效果跟踪服务。"""

    @staticmethod
    def _count_false_alarms(db: Session, device_id: str, start: datetime, end: datetime) -> int:
        """统计 [start, end] 区间内某设备的误报事件数（去重）。"""
        seen: set[int] = set()

        # 来源1：诊断未确认（feedback_result.diagnosis_confirmed == False）
        events = (
            db.query(Event)
            .filter(
                Event.device_id == device_id,
                Event.timestamp >= start,
                Event.timestamp <= end,
                Event.feedback_result.isnot(None),
            )
            .all()
        )
        for ev in events:
            fr = ev.feedback_result or {}
            if isinstance(fr, dict) and fr.get("diagnosis_confirmed") is False:
                seen.add(ev.id)

        # 来源2：人工拒绝（pending->alarm，reason 以「人工拒绝」开头）
        reject_rows = (
            db.query(EventTimeline)
            .filter(
                EventTimeline.device_id == device_id,
                EventTimeline.from_state == "pending",
                EventTimeline.to_state == "alarm",
                EventTimeline.created_at >= start,
                EventTimeline.created_at <= end,
            )
            .all()
        )
        for row in reject_rows:
            if not (row.reason or "").startswith("人工拒绝"):
                continue
            seen.add(row.event_id)

        return len(seen)

    def compute_effect(self, db: Session, suggestion_id: int, window_days: int = WINDOW_DAYS_DEFAULT) -> dict:
        """计算单条建议的效果（on-demand，结果回写 ThresholdEffect 表）。

        Args:
            db: 数据库会话。
            suggestion_id: 建议 ID。
            window_days: 统计窗口天数（默认 7）。

        Returns:
            含建议信息与效果指标的结果字典。
        """
        s = db.get(ThresholdSuggestion, suggestion_id)
        if s is None:
            raise ValueError(f"建议 {suggestion_id} 不存在")
        if s.status != "accepted" or s.accepted_at is None:
            raise ValueError(f"建议 {suggestion_id} 状态为 {s.status}，需已采纳才能计算效果")

        anchor = s.accepted_at
        before = self._count_false_alarms(db, s.device_id, anchor - timedelta(days=window_days), anchor)
        after = self._count_false_alarms(db, s.device_id, anchor, anchor + timedelta(days=window_days))
        reduction = before - after

        eff = db.query(ThresholdEffect).filter(ThresholdEffect.suggestion_id == suggestion_id).first()
        if eff is None:
            eff = ThresholdEffect(suggestion_id=suggestion_id, device_id=s.device_id)
            db.add(eff)
        eff.window_days = window_days
        eff.false_alarms_before = before
        eff.false_alarms_after = after
        eff.reduction = reduction
        eff.computed_at = datetime.utcnow()
        db.commit()
        db.refresh(eff)
        return self._effect_dict(eff, s)

    def list_effects(
        self, db: Session, device_id: Optional[str] = None, window_days: int = WINDOW_DAYS_DEFAULT
    ) -> list[dict]:
        """列出所有已采纳建议的效果（effect 缺失则实时计算）。"""
        q = db.query(ThresholdSuggestion).filter(ThresholdSuggestion.status == "accepted")
        if device_id:
            q = q.filter(ThresholdSuggestion.device_id == device_id)
        accepted = q.order_by(ThresholdSuggestion.id.asc()).all()

        results: list[dict] = []
        for s in accepted:
            eff = db.query(ThresholdEffect).filter(ThresholdEffect.suggestion_id == s.id).first()
            if eff is None:
                # on-demand 计算
                eff = self._persist_effect(db, s, window_days)
                results.append(self._effect_dict(eff, s))
            else:
                results.append(self._effect_dict(eff, s))
        return results

    def history(self, db: Session, device_id: str) -> dict:
        """返回某设备的阈值调整历史（含每条建议的采纳信息与可选效果）。"""
        rows = (
            db.query(ThresholdSuggestion)
            .filter(ThresholdSuggestion.device_id == device_id)
            .order_by(ThresholdSuggestion.id.asc())
            .all()
        )
        history: list[dict] = []
        for s in rows:
            eff = db.query(ThresholdEffect).filter(ThresholdEffect.suggestion_id == s.id).first()
            entry = {
                "suggestion_id": s.id,
                "old_value": s.old_value,
                "new_value": s.new_value,
                "reason": s.reason,
                "status": s.status,
                "accepted_by": s.accepted_by,
                "created_at": s.created_at.isoformat() if s.created_at else None,
                "accepted_at": s.accepted_at.isoformat() if s.accepted_at else None,
                "effect": self._effect_dict(eff, s) if eff else None,
            }
            history.append(entry)
        return {
            "device_id": device_id,
            "adjustment_count": len(rows),
            "history": history,
        }

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------
    def _persist_effect(self, db: Session, s: ThresholdSuggestion, window_days: int) -> ThresholdEffect:
        """计算并回写效果记录（不重复 commit，交给调用方控制会话）。"""
        anchor = s.accepted_at
        before = self._count_false_alarms(db, s.device_id, anchor - timedelta(days=window_days), anchor)
        after = self._count_false_alarms(db, s.device_id, anchor, anchor + timedelta(days=window_days))
        eff = ThresholdEffect(
            suggestion_id=s.id,
            device_id=s.device_id,
            window_days=window_days,
            false_alarms_before=before,
            false_alarms_after=after,
            reduction=before - after,
        )
        db.add(eff)
        db.commit()
        db.refresh(eff)
        return eff

    @staticmethod
    def _effect_dict(eff: ThresholdEffect, s: ThresholdSuggestion) -> dict:
        return {
            "suggestion_id": eff.suggestion_id,
            "device_id": eff.device_id,
            "old_value": s.old_value,
            "new_value": s.new_value,
            "status": s.status,
            "accepted_by": s.accepted_by,
            "accepted_at": s.accepted_at.isoformat() if s.accepted_at else None,
            "window_days": eff.window_days,
            "false_alarms_before": eff.false_alarms_before,
            "false_alarms_after": eff.false_alarms_after,
            "reduction": eff.reduction,
            "computed_at": eff.computed_at.isoformat() if eff.computed_at else None,
        }


threshold_effect_service = ThresholdEffectService()