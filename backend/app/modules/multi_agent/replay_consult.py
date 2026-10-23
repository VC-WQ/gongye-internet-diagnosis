"""公开数据回放的会诊。只调用已训练模型，不抄数据集标签。"""
from __future__ import annotations

from typing import Any

from app.modules.consult_models import consult_window


def consult_replay(device_id: str, window: list[dict]) -> dict[str, Any]:
    return consult_window(device_id, window)
