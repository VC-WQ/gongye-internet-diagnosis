"""模块10 动态阈值效果跟踪路由。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.models import get_db
from app.modules.auth.deps import get_current_user

from .service import WINDOW_DAYS_DEFAULT, threshold_effect_service

router = APIRouter(prefix="/threshold", tags=["动态阈值"], dependencies=[Depends(get_current_user)])


@router.get("/effects")
def list_effects(
    device_id: str | None = None,
    window_days: int = Query(WINDOW_DAYS_DEFAULT, ge=1, le=90),
    db: Session = Depends(get_db),
) -> list[dict]:
    """查看所有（或指定设备）已采纳阈值建议的效果对比。"""
    return threshold_effect_service.list_effects(db, device_id, window_days)


@router.get("/effects/{suggestion_id}")
def single_effect(
    suggestion_id: int,
    window_days: int = Query(WINDOW_DAYS_DEFAULT, ge=1, le=90),
    db: Session = Depends(get_db),
) -> dict:
    """查看单条阈值建议的效果（on-demand 计算并回写）。"""
    try:
        return threshold_effect_service.compute_effect(db, suggestion_id, window_days)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/history/{device_id}")
def device_history(device_id: str, db: Session = Depends(get_db)) -> dict:
    """查看某设备的阈值调整历史（建议列表 + 可选效果）。"""
    return threshold_effect_service.history(db, device_id)
