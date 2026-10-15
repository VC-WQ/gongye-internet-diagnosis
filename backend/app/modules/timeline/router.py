"""模块9 事件时间线路由：事件时间线 / 设备事件摘要。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.models import get_db

from .service import DEFAULT_MAX_POINTS, timeline_service

router = APIRouter(prefix="/timeline", tags=["事件时间线"])


@router.get("/event/{event_id}")
def event_timeline(
    event_id: int,
    max_points: int = Query(DEFAULT_MAX_POINTS, ge=1, le=2048),
    simulate_latent: bool = Query(False),
    db: Session = Depends(get_db),
) -> dict:
    """返回单个事件的完整时间线数据（传感器曲线 + 隐状态 + 事件标注点）。"""
    try:
        return timeline_service.event_timeline(db, event_id, max_points, simulate_latent)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))


@router.get("/device/{device_id}")
def device_events(
    device_id: str,
    limit: int = Query(20, ge=1, le=100),
    db: Session = Depends(get_db),
) -> dict:
    """返回某设备最近的多个事件摘要。"""
    return timeline_service.device_events(db, device_id, limit)