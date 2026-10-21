"""Pico 助手的请求/响应契约（可版本化）。"""
from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field, field_serializer

from .ui_schema import PicoUiAction


PicoEmotion = Literal[
    "idle", "curious", "thinking", "happy", "alert", "confused", "talking"
]
PicoActionType = Literal[
    "open_device", "open_event", "open_report", "switch_workspace_view"
]


class PicoTurn(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=1000)


class PicoContextSnapshot(BaseModel):
    """业务状态快照；不接受页面内容、输入框或任意额外属性。"""

    model_config = ConfigDict(extra="forbid")
    area: str = Field(min_length=1, max_length=32)
    route: str = Field(min_length=1, max_length=256, pattern=r"^/(?:[^/\s][^\s]*)?$")
    device_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    event_id: Optional[int] = Field(default=None, ge=1, le=9007199254740991, strict=True)
    active_tab: Optional[str] = Field(default=None, max_length=32)
    visible_section: Optional[str] = Field(default=None, max_length=32)
    context_revision: int = Field(default=0, ge=0, strict=True)


class PicoResolvedContext(BaseModel):
    """经存在性校验的对话目标，不从自然语言历史猜测身份。"""

    model_config = ConfigDict(extra="forbid")
    device_id: Optional[str] = Field(default=None, min_length=1, max_length=64)
    event_id: Optional[int] = Field(default=None, ge=1, le=9007199254740991, strict=True)


class PicoChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=500)
    page: Optional[str] = Field(default=None, max_length=64)
    device_id: Optional[str] = Field(default=None, max_length=64)
    event_id: Optional[int] = Field(default=None, ge=1, le=9007199254740991)
    tab: Optional[str] = Field(default=None, max_length=32)
    history: list[PicoTurn] = Field(default_factory=list, max_length=8)
    context: Optional[PicoContextSnapshot] = None
    conversation_focus: Optional[PicoResolvedContext] = None


class PicoReference(BaseModel):
    kind: Literal["device", "event", "report", "telemetry", "research", "knowledge"]
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
    planner: Optional[Literal["live", "unconfigured", "fallback"]] = None


class PicoChatResponse(BaseModel):
    version: str = "1.1"
    message_id: str
    request_id: str
    type: Literal["answer", "error"]
    text: str
    emotion: PicoEmotion
    references: list[PicoReference] = Field(default_factory=list)
    actions: list[PicoAction] = Field(default_factory=list)
    meta: PicoMeta
    context_revision: Optional[int] = None
    resolved_context: Optional[PicoResolvedContext] = None
    ui_actions: list[PicoUiAction] = Field(default_factory=list, max_length=1)

    @field_serializer("ui_actions")
    def serialize_ui_actions(self, actions):
        # Exact JSON objects for the frontend's runtime whitelist, without null props.
        return [action.model_dump(exclude_none=True) for action in actions]
