"""Versioned, size-bounded semantic page and one-step task protocol.

Page text is untrusted display data. It never grants permissions or registers tools.
"""
from __future__ import annotations

import json
from uuid import UUID
from typing import Annotated, Literal, Union

from pydantic import Field, StrictFloat, StrictInt, StrictStr, model_validator

from .planner import StrictModel, ToolCall
from .schema import PicoContextSnapshot, PicoMeta, PicoReference, PicoTurn
from .ui_schema import PicoUiAction

TaskStatus = Literal["running", "awaiting_ui", "completed", "partial", "failed", "needs_input", "cancelled", "unverified"]
ShortText = Annotated[str, Field(max_length=500)]


class PageSection(StrictModel):
    id: str = Field(min_length=1, max_length=64)
    title: str = Field(max_length=100)
    text: ShortText | None = None


class PageEntity(StrictModel):
    kind: Literal["device", "event", "report", "research"]
    id: str = Field(min_length=1, max_length=64)
    name: str = Field(max_length=128)
    selected: bool = Field(strict=True)


class PageDatum(StrictModel):
    label: str = Field(min_length=1, max_length=100)
    value: Union[Annotated[StrictStr, Field(max_length=500)], StrictInt, Annotated[StrictFloat, Field(allow_inf_nan=False)], None]
    unit: str | None = Field(default=None, max_length=32)
    entity_id: str | None = Field(default=None, max_length=64)
    observed_at: str | None = Field(default=None, max_length=64)
    source: str = Field(min_length=1, max_length=100)


class PageFilters(StrictModel):
    status: str | None = Field(default=None, max_length=32)
    q: str | None = Field(default=None, max_length=80)
    page: Annotated[int, Field(ge=1, le=100000, strict=True)] | None = None
    detail: str | None = Field(default=None, max_length=32)
    channel: str | None = Field(default=None, max_length=32)
    section: str | None = Field(default=None, max_length=32)
    sort: str | None = Field(default=None, max_length=32)
    device: str | None = Field(default=None, max_length=64)


class PageSelection(StrictModel):
    device_id: str | None = Field(default=None, max_length=64)
    event_id: Annotated[int, Field(ge=1, le=9007199254740991, strict=True)] | None = None


class PageSnapshot(StrictModel):
    version: Literal[1]
    page_id: str = Field(min_length=1, max_length=64)
    page_title: str = Field(min_length=1, max_length=100)
    route: str = Field(min_length=1, max_length=256, pattern=r"^/(?:[^/\s][^\s]*)?$")
    context_revision: int = Field(ge=0, strict=True)
    state: Literal["loading", "ready", "error", "empty"]
    visible_sections: list[PageSection] = Field(default_factory=list, max_length=16)
    entities: list[PageEntity] = Field(default_factory=list, max_length=24)
    visible_data: list[PageDatum] = Field(default_factory=list, max_length=40)
    filters: PageFilters = Field(default_factory=PageFilters)
    selection: PageSelection = Field(default_factory=PageSelection)
    available_actions: list[Annotated[str, Field(min_length=1, max_length=64)]] = Field(default_factory=list, max_length=24)

    @model_validator(mode="after")
    def bound_json(self):
        if len(json.dumps(self.model_dump(exclude_none=True), ensure_ascii=False, separators=(",", ":"))) > 16000:
            raise ValueError("page snapshot exceeds 16000 characters")
        return self


class TaskStart(StrictModel):
    client_task_id: UUID | None = None
    message: str = Field(min_length=1, max_length=500)
    context: PicoContextSnapshot
    page_snapshot: PageSnapshot
    history: list[PicoTurn] = Field(default_factory=list, max_length=8)

    @model_validator(mode="after")
    def coherent_context(self):
        validate_context(self.context, self.page_snapshot)
        return self


def validate_context(context: PicoContextSnapshot, snapshot: PageSnapshot):
    if (context.route != snapshot.route or context.context_revision != snapshot.context_revision
            or context.device_id != snapshot.selection.device_id or context.event_id != snapshot.selection.event_id):
        raise ValueError("page snapshot and current context disagree")


class UiObservation(StrictModel):
    action_id: str = Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")
    status: Literal["succeeded", "failed", "cancelled", "rejected"]
    message: ShortText


class TaskContinue(StrictModel):
    expected_step: int = Field(ge=1, le=8, strict=True)
    context: PicoContextSnapshot
    page_snapshot: PageSnapshot
    observation: UiObservation | None = None

    @model_validator(mode="after")
    def coherent_context(self):
        validate_context(self.context, self.page_snapshot)
        return self


class TraceEntry(StrictModel):
    step: int = Field(ge=0, le=8)
    kind: Literal["planning", "query", "action", "observation", "validation", "terminal"]
    name: str = Field(max_length=64)
    status: str = Field(max_length=32)
    message: ShortText


class TaskResponse(StrictModel):
    task_id: str
    status: TaskStatus
    step: int = Field(ge=0, le=8)
    tool_calls: int = Field(ge=0, le=12)
    text: str
    ui_action: PicoUiAction | None = None
    references: list[PicoReference] = Field(default_factory=list, max_length=100)
    meta: PicoMeta
    context_revision: int
    trace: list[TraceEntry] = Field(default_factory=list, max_length=64)


class CurrentPageArgs(StrictModel):
    pass


class CurrentPageCall(StrictModel):
    name: Literal["read_current_page"]
    args: CurrentPageArgs = Field(default_factory=CurrentPageArgs)


TaskReadCall = Annotated[Union[ToolCall, CurrentPageCall], Field(discriminator="name")]


class ReadDecision(StrictModel):
    kind: Literal["read"]
    call: TaskReadCall


class UiDecision(StrictModel):
    kind: Literal["ui"]
    action: PicoUiAction


class FinishDecision(StrictModel):
    kind: Literal["finish"]
    # This is an explanation only. Server-rendered facts and UI observations remain authority.
    summary: str = Field(default="", max_length=500)


class ClarifyDecision(StrictModel):
    kind: Literal["clarify"]
    question: str = Field(min_length=1, max_length=500)


class AgentDecision(StrictModel):
    decision: Annotated[Union[ReadDecision, UiDecision, FinishDecision, ClarifyDecision], Field(discriminator="kind")]
