"""模块8 报告中心路由：快报 / 事件报告 / 系统自评（复用模块7）。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import get_db
from app.modules.command_loop.accuracy_tracker import accuracy_tracker

from .service import report_service

router = APIRouter(prefix="/reports", tags=["AI报告中心"])


class FlashBody(BaseModel):
    """快报请求体：可选按设备过滤。"""

    device_id: str | None = None


@router.post("/flash")
def flash(body: FlashBody, db: Session = Depends(get_db)) -> dict:
    """生成快报（短文本摘要，动态生成不落库）。"""
    text = report_service.generate_flash(db, body.device_id)
    return {"report": text, "device_id": body.device_id}


@router.post("/event/{event_id}")
def event_report(event_id: int, db: Session = Depends(get_db)) -> dict:
    """生成事件报告（完整 Markdown，10 部分）。"""
    try:
        markdown = report_service.generate_event_report(db, event_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    return {"event_id": event_id, "report": markdown}


@router.get("/self-eval")
def self_eval(days: int = 30, db: Session = Depends(get_db)) -> dict:
    """系统自评面板数据（透传模块7 /self-eval/metrics）。"""
    return accuracy_tracker.metrics(db, days)