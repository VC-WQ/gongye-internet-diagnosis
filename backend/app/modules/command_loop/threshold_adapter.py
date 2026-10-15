"""模块7 阈值自适应闭环（闭环2）：误报统计 -> 生成阈值调整建议 -> 人工采纳/拒绝。

说明（补充3）：设备级覆盖阈值【不真正接入诊断流程】，仅在建议表 + 审计中
闭环；真实改模块4/5/6 判定阈值属于「未来工作」。

触发条件（补充2）仅在以下两类误报时统计：
    1. Event.feedback_result.diagnosis_confirmed == False
    2. 人工拒绝（EventTimeline: pending->alarm 且 reason 以「人工拒绝」开头）
成功恢复、延长观察期不参与。
"""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import get_db
from app.models.event import Event

from .models import EventTimeline, ThresholdSuggestion

# 阈值自适应参数（阈值口径 = 健康分 abnormal 边界，当前 60）
ALARM_THRESHOLD = 60.0       # 健康分告警边界（与模块4 health_scorer 的 60 对齐）
NEAR_THRESHOLD_BAND = 5.0    # 误报健康分落在阈值±5 分区间视为「阈值附近」
ADJUST_STEP = 5.0            # 单次下调/上调幅度
FALSE_ALARM_WINDOW_DAYS = 7  # 滑动窗口：近 7 天
FALSE_ALARM_MIN_COUNT = 3    # 误报次数超过此值（即 >=4）才生成建议


class ThresholdAdapter:
    """阈值自适应建议器。"""

    # ------------------------------------------------------------------
    # 建议生成（自动触发，调用方在误报事件后 invoke）
    # ------------------------------------------------------------------
    def generate_suggestions(self, db: Session, device_id: str) -> list[dict]:
        """扫描近 7 天两类误报，超阈值则生成一条阈值下调建议。

        Returns:
            本次新生成的建议列表（未触发返回空列表）。
        """
        window_start = datetime.utcnow() - timedelta(days=FALSE_ALARM_WINDOW_DAYS)

        # 收集误报 -> (event_id, health_score|None)
        false_alarms: list[tuple[int, Optional[float]]] = []
        seen: set[int] = set()

        # 来源1：反馈评估 diagnosis_confirmed == False
        events = (
            db.query(Event)
            .filter(
                Event.device_id == device_id,
                Event.timestamp >= window_start,
                Event.feedback_result.isnot(None),
            )
            .all()
        )
        for ev in events:
            fr = ev.feedback_result or {}
            if isinstance(fr, dict) and fr.get("diagnosis_confirmed") is False:
                hs = self._health_of(ev)
                false_alarms.append((ev.id, hs))
                seen.add(ev.id)

        # 来源2：人工拒绝（pending->alarm，reason 以「人工拒绝」开头）
        reject_rows = (
            db.query(EventTimeline)
            .filter(
                EventTimeline.device_id == device_id,
                EventTimeline.from_state == "pending",
                EventTimeline.to_state == "alarm",
                EventTimeline.created_at >= window_start,
            )
            .all()
        )
        for row in reject_rows:
            if not (row.reason or "").startswith("人工拒绝"):
                continue
            if row.event_id in seen:
                continue
            ev = db.get(Event, row.event_id)
            fs = self._health_of(ev) if ev else None
            false_alarms.append((row.event_id, fs))
            seen.add(row.event_id)

        if len(false_alarms) <= FALSE_ALARM_MIN_COUNT:
            return []

        # 误报时健康分落在阈值±5 分区间
        near = [(eid, hs) for eid, hs in false_alarms if hs is not None
                and abs(float(hs) - ALARM_THRESHOLD) <= NEAR_THRESHOLD_BAND]
        if not near:
            return []

        avg = sum(float(hs) for _, hs in near) / len(near)
        suggestion = ThresholdSuggestion(
            device_id=device_id,
            old_value=ALARM_THRESHOLD,
            new_value=ALARM_THRESHOLD - ADJUST_STEP,
            reason=(
                f"近{FALSE_ALARM_WINDOW_DAYS}天误报{len(false_alarms)}次(>{FALSE_ALARM_MIN_COUNT})，"
                f"其中{len(near)}次误报时健康分均值{avg:.1f}落在阈值"
                f"{ALARM_THRESHOLD}±{NEAR_THRESHOLD_BAND}区间，建议告警阈值下调{ADJUST_STEP}分"
            ),
            status="pending",
        )
        db.add(suggestion)
        db.commit()
        db.refresh(suggestion)
        return [self._to_dict(suggestion)]

    # ------------------------------------------------------------------
    # 建议查询与采纳/拒绝
    # ------------------------------------------------------------------
    def list_suggestions(
        self, db: Session, device_id: str | None = None, status: str | None = None
    ) -> list[dict]:
        """查询建议（可按设备/状态过滤）。"""
        q = db.query(ThresholdSuggestion)
        if device_id:
            q = q.filter(ThresholdSuggestion.device_id == device_id)
        if status:
            q = q.filter(ThresholdSuggestion.status == status)
        return [self._to_dict(s) for s in q.order_by(ThresholdSuggestion.id.desc()).all()]

    def accept(self, db: Session, suggestion_id: int, operator: str) -> dict:
        """采纳建议：写采纳人与时间戳（审计日志即建议记录本身）。"""
        s = self._get_or_raise(db, suggestion_id)
        if s.status != "pending":
            raise HTTPException(status_code=400, detail=f"建议 {suggestion_id} 已{s.status}，不可重复操作")
        s.status = "accepted"
        s.accepted_by = operator
        s.accepted_at = datetime.utcnow()
        db.commit()
        db.refresh(s)
        return self._to_dict(s)

    def reject(self, db: Session, suggestion_id: int, operator: str) -> dict:
        """拒绝建议。"""
        s = self._get_or_raise(db, suggestion_id)
        if s.status != "pending":
            raise HTTPException(status_code=400, detail=f"建议 {suggestion_id} 已{s.status}，不可重复操作")
        s.status = "rejected"
        s.accepted_by = operator  # 复用字段记录操作人（拒绝也留痕）
        s.accepted_at = datetime.utcnow()
        db.commit()
        db.refresh(s)
        return self._to_dict(s)

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------
    @staticmethod
    def _health_of(event: Event) -> Optional[float]:
        """从事件的会诊结果里取健康分。"""
        diag = event.agent_diagnosis or {}
        hs = diag.get("health_score")
        return float(hs) if hs is not None else None

    @staticmethod
    def _get_or_raise(db: Session, suggestion_id: int) -> ThresholdSuggestion:
        s = db.get(ThresholdSuggestion, suggestion_id)
        if s is None:
            raise HTTPException(status_code=404, detail=f"建议 {suggestion_id} 不存在")
        return s

    @staticmethod
    def _to_dict(s: ThresholdSuggestion) -> dict:
        return {
            "id": s.id,
            "device_id": s.device_id,
            "old_value": s.old_value,
            "new_value": s.new_value,
            "reason": s.reason,
            "status": s.status,
            "accepted_by": s.accepted_by,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "accepted_at": s.accepted_at.isoformat() if s.accepted_at else None,
        }


threshold_adapter = ThresholdAdapter()

# ---------------------------------------------------------------------------
# 路由
# ---------------------------------------------------------------------------
router = APIRouter(prefix="/threshold/suggestions", tags=["阈值自适应"])


class _OperatorBody(BaseModel):
    operator: str


@router.get("")
def list_suggestions(
    device_id: str | None = None,
    status: str | None = None,
    db: Session = Depends(get_db),
) -> list[dict]:
    """查询当前所有阈值建议（可按设备/状态过滤）。"""
    return threshold_adapter.list_suggestions(db, device_id, status)


@router.post("/{suggestion_id}/accept")
def accept(suggestion_id: int, body: _OperatorBody, db: Session = Depends(get_db)) -> dict:
    """采纳建议（写审计：采纳人 + 时间戳）。"""
    return threshold_adapter.accept(db, suggestion_id, body.operator)


@router.post("/{suggestion_id}/reject")
def reject(suggestion_id: int, body: _OperatorBody, db: Session = Depends(get_db)) -> dict:
    """拒绝建议。"""
    return threshold_adapter.reject(db, suggestion_id, body.operator)