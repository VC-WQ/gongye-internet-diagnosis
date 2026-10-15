"""模块6 指令闭环路由：事件创建/查询、人工确认/拒绝、指令执行、时间线。

6 个端点均由 pydantic body 传入 operator（操作人），用于审计日志留痕。
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import get_db

from .service import EventNotFoundError, StateTransitionError, command_loop_service

router = APIRouter(prefix="/command-loop", tags=["指令闭环"])


# ---------------------------------------------------------------------------
# 请求体
# ---------------------------------------------------------------------------
class CreateEventBody(BaseModel):
    """创建诊断事件。"""

    device_id: str
    window: list[dict]          # 传感器窗口（触发会诊的原始数据）
    operator: str = "system"    # 操作人（who）
    vision: Optional[dict] = None  # 部件表面视觉检测结果（第五路证据，可选）


class ConfirmBody(BaseModel):
    """人工确认（待确认 -> 处置中）。"""

    operator: str


class RejectBody(BaseModel):
    """人工拒绝（待确认 -> 告警）。"""

    operator: str
    reason: str = "人工拒绝"


class ReviseBody(BaseModel):
    """人工修改诊断建议（状态不变，改写报告并留痕）。"""

    operator: str
    recommendation: str | None = None   # 修改后的维护建议
    fault_label: str | None = None      # 修正后的故障结论
    note: str | None = None             # 修改理由


class ExecuteBody(BaseModel):
    """执行指令（处置中 -> 观察中）。"""

    operator: str
    command: str | None = None  # 为空时使用诊断报告中的维护建议


def _http_exc(e: Exception) -> HTTPException:
    """将业务异常映射为 HTTP 异常。"""
    if isinstance(e, EventNotFoundError):
        return HTTPException(status_code=404, detail=str(e))
    if isinstance(e, StateTransitionError):
        return HTTPException(status_code=400, detail=str(e))
    return HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# 端点
# ---------------------------------------------------------------------------
@router.get("/events")
def list_events(
    device_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
    db: Session = Depends(get_db),
) -> list[dict]:
    """查询事件列表（按时间倒序），可选按设备过滤。"""
    return command_loop_service.list_events(db, device_id, limit, offset)


@router.post("/events")
def create_event(body: CreateEventBody, db: Session = Depends(get_db)) -> dict:
    """创建诊断事件：会诊 -> 判定初始状态 -> 告警自动进入会诊/待确认。"""
    return command_loop_service.create_event(db, body.device_id, body.window, body.operator, body.vision)


@router.get("/events/{event_id}")
def get_event(event_id: int, db: Session = Depends(get_db)) -> dict:
    """查询事件（含当前状态与诊断报告）。"""
    event = command_loop_service.get_event(db, event_id)
    if event is None:
        raise HTTPException(status_code=404, detail=f"事件 {event_id} 不存在")
    return event


@router.post("/events/{event_id}/confirm")
def confirm(event_id: int, body: ConfirmBody, db: Session = Depends(get_db)) -> dict:
    """人工确认执行（pending -> handling）。"""
    try:
        return command_loop_service.confirm(db, event_id, body.operator)
    except (EventNotFoundError, StateTransitionError) as e:
        raise _http_exc(e)


@router.post("/events/{event_id}/reject")
def reject(event_id: int, body: RejectBody, db: Session = Depends(get_db)) -> dict:
    """人工拒绝（pending -> alarm，重新评估）。"""
    try:
        return command_loop_service.reject(db, event_id, body.operator, body.reason)
    except (EventNotFoundError, StateTransitionError) as e:
        raise _http_exc(e)


@router.post("/events/{event_id}/revise")
def revise(event_id: int, body: ReviseBody, db: Session = Depends(get_db)) -> dict:
    """人工修改诊断建议（维护建议 / 故障结论），状态不变，仅改写报告并留痕。"""
    try:
        return command_loop_service.revise(
            db, event_id, body.operator, body.recommendation, body.fault_label, body.note
        )
    except EventNotFoundError as e:
        raise _http_exc(e)


@router.post("/events/{event_id}/execute")
def execute(event_id: int, body: ExecuteBody, db: Session = Depends(get_db)) -> dict:
    """执行指令并进入观察期（handling -> observing）。"""
    try:
        return command_loop_service.execute(db, event_id, body.operator, body.command)
    except (EventNotFoundError, StateTransitionError) as e:
        raise _http_exc(e)


@router.get("/events/{event_id}/timeline")
def timeline(event_id: int, db: Session = Depends(get_db)) -> list[dict]:
    """查询事件状态变更时间线（who/when/why）。"""
    return command_loop_service.get_timeline(db, event_id)