"""Pico 助手的请求/响应契约（可版本化）。"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field


PicoEmotion = Literal[
    "idle", "curious", "thinking", "happy", "alert", "confused", "talking"
]
PicoActionType = Literal[
    "open_device", "open_event", "open_report", "switch_workspace_view"
]


class PicoTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1000)


class PicoChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    page: Optional[str] = Field(default=None, max_length=64)
    device_id: Optional[str] = Field(default=None, max_length=64)
    event_id: Optional[int] = Field(default=None, ge=1)
    tab: Optional[str] = Field(default=None, max_length=32)
    history: list[PicoTurn] = Field(default_factory=list, max_length=8)


class PicoReference(BaseModel):
    kind: Literal["device", "event", "report", "telemetry"]
    id: str
    label: str
    source: str
    observed_at: Optional[str] = None


class PicoAction(BaseModel):
    type: PicoActionType
    label: str
    target: str
    params: dict = Field(default_factory=dict)


class PicoMeta(BaseModel):
    data_status: Literal["current", "stale", "missing"]
    source_kind: Literal["real", "simulated", "offline", "unknown"]
    degraded: bool
    llm: Literal["live", "unconfigured", "fallback"]


class PicoChatResponse(BaseModel):
    version: str = "1.0"
    message_id: str
    request_id: str
    type: Literal["answer", "error"]
    text: str
    emotion: PicoEmotion
    references: list[PicoReference] = Field(default_factory=list)
    actions: list[PicoAction] = Field(default_factory=list)
    meta: PicoMeta
