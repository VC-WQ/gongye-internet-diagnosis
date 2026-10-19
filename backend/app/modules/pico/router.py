"""Pico 助手路由：能力清单与对话接口。"""
from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.models import User, get_db
from app.modules.auth.deps import get_current_user

from .schema import PicoChatRequest, PicoChatResponse
from .service import capabilities, chat

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
    """基于当前页面上下文的只读问答。"""
    return chat(db, user, body)
