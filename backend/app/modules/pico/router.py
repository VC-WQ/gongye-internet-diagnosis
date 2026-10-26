"""Pico 助手路由：能力清单与对话接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header
from sqlalchemy.orm import Session

from app.models import User, get_db
from app.modules.auth.deps import get_current_user

from .schema import PicoChatRequest, PicoChatResponse
from .service import capabilities, chat
from .registry import capability_catalog
from .task_schema import TaskStart, TaskContinue, TaskResponse
from .task_agent import start_task, continue_task, cancel_task

router = APIRouter(prefix="/pico", tags=["Pico 助手"])


@router.get("/capabilities")
def get_capabilities(_: User = Depends(get_current_user)) -> dict:
    """返回模型可用性、只读工具清单与限制。"""
    return capabilities()


@router.post("/chat", response_model=PicoChatResponse)
def pico_chat(
    body: PicoChatRequest,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
) -> PicoChatResponse:
    """上下文问答与受约束页面动作；不执行任何业务写入。"""
    return chat(db, user, body)


@router.get("/task-capabilities")
def get_task_capabilities(_: User = Depends(get_current_user)) -> dict:
    """Schema-derived tools and permissions for the model-led task loop."""
    return capability_catalog()


@router.post("/tasks", response_model=TaskResponse, response_model_exclude_none=True)
def pico_start_task(body: TaskStart, db: Session = Depends(get_db), user: User = Depends(get_current_user), authorization: str | None = Header(default=None)) -> TaskResponse:
    return start_task(db, user, body, authorization)


@router.post("/tasks/{task_id}/continue", response_model=TaskResponse, response_model_exclude_none=True)
def pico_continue_task(task_id: str, body: TaskContinue, db: Session = Depends(get_db), user: User = Depends(get_current_user), authorization: str | None = Header(default=None)) -> TaskResponse:
    return continue_task(db, user, task_id, body, authorization)


@router.delete("/tasks/{task_id}", response_model=TaskResponse, response_model_exclude_none=True)
def pico_cancel_task(task_id: str, user: User = Depends(get_current_user), authorization: str | None = Header(default=None)) -> TaskResponse:
    return cancel_task(user, task_id, authorization)
