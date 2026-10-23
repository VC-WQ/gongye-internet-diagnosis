"""轴承会诊只接受约 12 kHz、不少于 2048 点的波形，并且两个权重文件都在。"""
from __future__ import annotations

from typing import Any, Optional

from .cnn_classifier import CNN_WEIGHT_PATH
from .pinn_residual import PINN_WEIGHT_PATH

MIN_SAMPLES = 2048


def _sample_rate(window: Any) -> Optional[float]:
    rows = window if isinstance(window, list) else [window] if isinstance(window, dict) else []
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = row.get("sample_rate")
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            return float(raw)
    return None


def _vibration_count(window: Any) -> int:
    rows = window if isinstance(window, list) else [window] if isinstance(window, dict) else []
    count = 0
    for row in rows:
        if not isinstance(row, dict):
            continue
        raw = row.get("vibration", row.get("DE"))
        if isinstance(raw, (int, float)) and not isinstance(raw, bool):
            count += 1
    return count


def research_block_reason(window: Any) -> Optional[str]:
    """不满足研究页条件时返回原因。满足时返回 None。"""
    rate = _sample_rate(window)
    if rate is None or not 10000.0 <= rate <= 14000.0:
        return "轴承会诊未运行：输入不是 12 kHz 左右的振动波形。"
    if _vibration_count(window) < MIN_SAMPLES:
        return "轴承会诊未运行：振动点数不足 2048，不能补零后当作 12 kHz 波形。"
    if not CNN_WEIGHT_PATH.exists() or not PINN_WEIGHT_PATH.exists():
        return "模型未加载"
    return None


def blocked_detect(device_id: str, reason: str) -> dict:
    unloaded = "未加载" in reason
    label = "模型未加载" if unloaded else "未运行"
    return {
        "device_id": device_id,
        "unavailable": True,
        "message": reason,
        "pinn": {"residual": None, "pinn_source": "model_unavailable"},
        "cnn": {
            "fault_type": "unknown",
            "fault_label": label,
            "confidence": 0.0,
            "probabilities": {},
            "cnn_source": "model_unavailable",
            "model_available": False,
        },
        "health": {"health_score": None, "health_level": "unobserved", "level_label": label},
        "cnn_source": "model_unavailable",
        "pinn_source": "model_unavailable",
    }


def blocked_consult(device_id: str, reason: str) -> dict:
    unloaded = "未加载" in reason
    label = "模型未加载" if unloaded else "未运行"
    return {
        "device_id": device_id,
        "fault_type": "unknown",
        "fault_label": label,
        "confidence": 0.0,
        "health_score": None,
        "health_level": "unobserved",
        "level_label": label,
        "available_channels": [],
        "agent_results": [],
        "recommendation": reason,
        "diagnosis_method": "research_blocked",
        "model_card": None,
        "report": {"summary": reason, "recommendation": reason},
        "conflicts": [],
        "conflict_detected": False,
    }
