"""反馈评估模块路由（反馈入库 / 诊断评估 / 阈值校准）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.models import User, get_db
from app.modules.auth.deps import get_current_user, require_admin

from .service import feedback_service

router = APIRouter(prefix="/feedback", tags=["反馈评估"])


@router.post("/{event_id}")
def collect_feedback(
    event_id: int, feedback: dict, db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
) -> dict:
    """收集诊断反馈并写入数据库。"""
    try:
        return feedback_service.collect_feedback(db, event_id, {**feedback, "operator": current_user.username})
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/{event_id}/evaluate")
def evaluate(event_id: int, db: Session = Depends(get_db)) -> dict:
    """评估单次诊断质量与该设备的累计准确率。"""
    return feedback_service.evaluate(db, event_id)


@router.post("/device/{device_id}/calibrate")
def calibrate(device_id: str, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    """根据近期误报生成阈值调整建议。"""
    return feedback_service.calibrate(db, device_id)
