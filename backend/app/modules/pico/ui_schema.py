"""Pico 的有限页面动作契约；没有任意路由、脚本、选择器或写入操作。"""
from __future__ import annotations

import uuid
from typing import Annotated, Literal, Union

from pydantic import Field, model_validator

from .planner import StrictModel

SafeDeviceId = Annotated[str, Field(min_length=1, max_length=64, pattern=r"^[A-Za-z0-9][A-Za-z0-9_-]*$")]
DetailTab = Literal["realtime", "history", "latent", "acoustic", "phm", "events", "threshold"]
ToolKey = Literal["diagnosis", "events", "simulation", "vision", "pico", "evaluation", "settings"]
TopicId = Literal["signal", "diagnosis", "health", "mechanism", "results"]


class EmptyParams(StrictModel):
    pass


class ToolsParams(StrictModel):
    tool: ToolKey | None = None
    device_id: SafeDeviceId | None = None

    @model_validator(mode="after")
    def device_requires_diagnosis(self):
        if self.device_id is not None and self.tool != "diagnosis":
            raise ValueError("device_id is supported only by diagnosis preparation")
        return self


class RecordsParams(StrictModel):
    device_id: SafeDeviceId | None = None


class ResearchParams(StrictModel):
    topic_id: TopicId | None = None
    point_id: Annotated[str, Field(min_length=1, max_length=32)] | None = None

    @model_validator(mode="after")
    def point_requires_topic(self):
        if self.point_id and not self.topic_id:
            raise ValueError("point_id requires topic_id")
        if self.point_id:
            from .knowledge import POINTS
            if not any(p["topic_id"] == self.topic_id and p["point_id"] == self.point_id for p in POINTS):
                raise ValueError("unknown research point")
        return self


class DeviceParams(StrictModel):
    device_id: SafeDeviceId
    tab: DetailTab | None = None


class EventParams(StrictModel):
    event_id: int = Field(ge=1, le=9007199254740991, strict=True)
    device_id: SafeDeviceId | None = None


class ActionBase(StrictModel):
    action_id: str = Field(default_factory=lambda: uuid.uuid4().hex, min_length=1, max_length=64, pattern=r"^[A-Za-z0-9_-]+$")


class NavigateAction(ActionBase):
    type: Literal["navigate"]
    route_id: Literal["factory", "tools", "research", "device_detail", "event_detail", "report", "device_management", "records", "user_management", "record_management", "device_directory"]
    params: Union[EmptyParams, ToolsParams, ResearchParams, DeviceParams, EventParams, RecordsParams] = Field(default_factory=EmptyParams)

    @model_validator(mode="after")
    def params_match_route(self):
        expected = {"factory": EmptyParams, "tools": ToolsParams, "research": ResearchParams, "device_detail": DeviceParams, "event_detail": EventParams, "report": EventParams, "device_management": EmptyParams, "records": RecordsParams, "user_management": EmptyParams, "record_management": EmptyParams, "device_directory": EmptyParams}[self.route_id]
        self.params = expected.model_validate(self.params.model_dump(exclude_none=True))
        return self


class SetThemeAction(ActionBase):
    type: Literal["set_theme"]
    theme: Literal["light", "dark"]


class SetFactoryFilterAction(ActionBase):
    type: Literal["set_factory_filter"]
    status: Literal["all", "healthy", "degraded", "fault", "offline"]
    q: Annotated[str, Field(max_length=80, pattern=r"^[^\x00-\x1f]*$")] | None = None


class SelectFactoryDeviceAction(ActionBase):
    type: Literal["select_factory_device"]
    device_id: SafeDeviceId


class DeviceFields(StrictModel):
    id: SafeDeviceId | None = None
    name: Annotated[str, Field(min_length=1, max_length=128)] | None = None
    device_type: Literal["pump", "motor", "compressor"] | None = None
    health_score: Annotated[float, Field(ge=0, le=100, allow_inf_nan=False, strict=True)] | None = None
    status: Literal["healthy", "degraded", "fault", "offline"] | None = None

    @model_validator(mode="after")
    def nonblank_name(self):
        if self.name is not None and not self.name.strip():
            raise ValueError("设备名称不能为空")
        return self


class PrefillDeviceAction(ActionBase):
    type: Literal["prefill_device_form"]
    mode: Literal["create", "edit"]
    device_id: SafeDeviceId | None = None
    fields: DeviceFields

    @model_validator(mode="after")
    def mode_matches_target(self):
        if self.mode == "edit" and (not self.device_id or self.fields.id is not None):
            raise ValueError("编辑必须有真实device_id且不能更改id")
        if self.mode == "create" and self.device_id is not None:
            raise ValueError("新增不允许指定既有device_id目标")
        return self


PicoUiAction = Annotated[Union[NavigateAction, SetThemeAction, PrefillDeviceAction, SetFactoryFilterAction, SelectFactoryDeviceAction], Field(discriminator="type")]


class PicoUiPlan(StrictModel):
    action: PicoUiAction | None = None


class PicoUiSequencePlan(StrictModel):
    actions: list[PicoUiAction] = Field(min_length=1, max_length=3)

    @model_validator(mode="after")
    def coherent_sequence(self):
        if len({action.action_id for action in self.actions}) != len(self.actions):
            raise ValueError("action IDs must be unique")
        if any(isinstance(action, PrefillDeviceAction) for action in self.actions[:-1]):
            raise ValueError("prefill must be the final action")
        return self
