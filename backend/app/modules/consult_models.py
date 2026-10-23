"""会诊推断。只读传感器窗口和已训练模型，不读 anomaly、hi、rul。"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Optional

import joblib
import numpy as np

ROOT = Path(__file__).resolve().parents[3]
SKAB_MODEL = ROOT / "models" / "skab_anomaly.joblib"
XJTU_MODEL = ROOT / "models" / "xjtu_rul.joblib"
METRICS_PATH = ROOT / "backend" / "app" / "data" / "consult_model_metrics.json"

PUMP_CHANNELS = ("vibration", "current", "pressure", "temperature", "speed")
WINDOW = 30
MODEL_BASES = ("skab_probability", "xjtu_rul")


def slope(values: np.ndarray) -> float:
    """窗口内对时间的一阶斜率。时间只用窗口内的序号。"""
    if values.size < 2:
        return 0.0
    x = np.arange(values.size, dtype=float)
    x = x - x.mean()
    denom = float(np.dot(x, x))
    if denom == 0.0:
        return 0.0
    centered = values - values.mean()
    return float(np.dot(x, centered) / denom)


def pump_feature_row(window: list[dict]) -> Optional[np.ndarray]:
    """最近 30 个点、五个通道的均值、标准差和斜率。缺通道或不足 30 点则无法评分。"""
    rows = [item for item in window if isinstance(item, dict)][-WINDOW:]
    if len(rows) < WINDOW:
        return None
    features: list[float] = []
    for name in PUMP_CHANNELS:
        values: list[float] = []
        for row in rows:
            raw = row.get(name)
            if isinstance(raw, bool) or not isinstance(raw, (int, float)):
                return None
            number = float(raw)
            if number != number:
                return None
            values.append(number)
        arr = np.asarray(values, dtype=float)
        features.extend((float(arr.mean()), float(arr.std()), slope(arr)))
    return np.asarray(features, dtype=float)


def motor_feature_row(window: list[dict]) -> Optional[np.ndarray]:
    """最近 30 个振动 RMS。不使用 hi、rul 或未来采样。"""
    values: list[float] = []
    for row in window:
        if not isinstance(row, dict):
            continue
        raw = row.get("vibration")
        if isinstance(raw, bool) or not isinstance(raw, (int, float)):
            continue
        number = float(raw)
        if number == number:
            values.append(number)
    values = values[-WINDOW:]
    if len(values) < WINDOW:
        return None
    arr = np.asarray(values, dtype=float)
    mean = float(arr.mean())
    return np.asarray(
        [
            float(arr[-1]),
            mean,
            float(arr.std()),
            float(arr.min()),
            float(arr.max()),
            slope(arr),
            float(arr[-1] - arr[0]),
            float(arr[-1] / (abs(mean) + 1e-9)),
        ],
        dtype=float,
    )


def _metrics() -> Optional[dict]:
    if not METRICS_PATH.exists():
        return None
    payload = json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    return payload if isinstance(payload, dict) else None


def _bundle(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    payload = joblib.load(path)
    if not isinstance(payload, dict) or "model" not in payload:
        return None
    return payload


def _channels(window: list[dict]) -> list[str]:
    last = next((item for item in reversed(window) if isinstance(item, dict)), {})
    return [
        name
        for name in ("vibration", "temperature", "current", "pressure", "speed", "acoustic")
        if isinstance(last.get(name), (int, float)) and not isinstance(last.get(name), bool)
    ]


def _dataset(window: list[dict]) -> str:
    for item in reversed(window):
        if isinstance(item, dict) and isinstance(item.get("dataset"), str):
            return item["dataset"]
    return ""


def _note(window: list[dict]) -> str:
    for item in reversed(window):
        if isinstance(item, dict) and isinstance(item.get("sample_note"), str):
            return item["sample_note"]
    return ""


def _base(device_id: str, window: list[dict], summary: str, basis: str) -> dict[str, Any]:
    return {
        "device_id": device_id,
        "fault_type": "unknown",
        "fault_label": "未评分",
        "confidence": 0.0,
        "health_score": None,
        "health_level": "unobserved",
        "level_label": "未评分",
        "health_basis": basis,
        "available_channels": _channels(window),
        "agent_results": [],
        "recommendation": "本次没有模型输出，不能据此下发维护指令。",
        "action": None,
        "diagnosis_method": "unobserved",
        "model_card": None,
        "report": {"summary": summary, "recommendation": "本次没有模型输出，不能据此下发维护指令。"},
        "conflicts": [],
        "conflict_detected": False,
    }


def _card(spec: dict, output: dict[str, Any], inputs: str) -> dict[str, Any]:
    return {
        "model_name": spec.get("model_name"),
        "model_file": spec.get("model_file"),
        "task": spec.get("task"),
        "train_range": spec.get("train_range"),
        "holdout": spec.get("holdout"),
        "score_formula": spec.get("score_formula"),
        "score_label": spec.get("score_label"),
        "test_metric": spec.get("test_metric"),
        "label_note": spec.get("label_note"),
        "inputs": inputs,
        "output": output,
    }


def _pump(device_id: str, window: list[dict], spec: dict) -> dict[str, Any]:
    bundle = _bundle(SKAB_MODEL)
    if bundle is None or not spec:
        return _base(device_id, window, "离心泵会诊模型文件不存在，未评分。", "unobserved")
    features = pump_feature_row(window)
    if features is None:
        return _base(device_id, window, "离心泵需要最近 30 秒五个通道都有数值，当前窗口不足，未评分。", "unobserved")
    model = bundle["model"]
    proba = model.predict_proba(features.reshape(1, -1))[0]
    classes = [int(item) for item in model.classes_]
    p_normal = float(proba[classes.index(0)])
    p_anomaly = float(proba[classes.index(1)])
    score = 100.0 * p_normal
    normal = p_normal >= p_anomaly
    note = _note(window)
    dataset = _dataset(window) or "SKAB"
    metric = spec.get("test_metric") or {}
    summary = (
        f"采样来自 {dataset} 实测回放"
        + (f"（{note}）" if note else "")
        + "。本次只使用梯度提升树对最近 30 秒的振动有效值、电流、压力、温度和流量做工况分类。"
        f"正常概率 {p_normal:.4f}，异常概率 {p_anomaly:.4f}。"
        f"分数 = 100 × 正常概率 = {score:.2f}，这是正常概率换算，不是另测的物理健康指标。"
        f"留出试验的异常类精确率 {metric.get('precision')}、召回率 {metric.get('recall')}、F1 {metric.get('f1')}。"
    )
    label = "模型判定为正常工况" if normal else "模型判定为异常工况"
    recommendation = "回放记录不能接受维护指令。需要演示处置时，请把该设备切换到仿真处置。"
    return {
        "device_id": device_id,
        "fault_type": "normal" if normal else "condition_anomaly",
        "fault_label": label,
        "confidence": max(p_normal, p_anomaly),
        "health_score": score,
        "health_level": "healthy" if normal else "abnormal",
        "level_label": label,
        "health_basis": "skab_probability",
        "available_channels": _channels(window),
        "agent_results": [],
        "recommendation": recommendation,
        "action": None,
        "diagnosis_method": "skab_probability",
        "model_card": _card(
            spec,
            {"p_normal": p_normal, "p_anomaly": p_anomaly, "score": score},
            "最近 30 秒振动有效值、电流、压力、温度、流量的均值、标准差和斜率",
        ),
        "report": {"summary": summary, "recommendation": recommendation},
        "conflicts": [],
        "conflict_detected": False,
    }


def _motor_level(predicted: float) -> str:
    if predicted >= 0.6:
        return "healthy"
    if predicted >= 0.3:
        return "warning"
    return "abnormal"


def _motor(device_id: str, window: list[dict], spec: dict) -> dict[str, Any]:
    bundle = _bundle(XJTU_MODEL)
    if bundle is None or not spec:
        return _base(device_id, window, "驱动电机会诊模型文件不存在，未评分。", "unobserved")
    features = motor_feature_row(window)
    if features is None:
        return _base(device_id, window, "驱动电机需要最近 30 个振动 RMS，当前窗口不足，未评分。", "unobserved")
    predicted = float(bundle["model"].predict(features.reshape(1, -1))[0])
    score = 100.0 * predicted
    level = _motor_level(predicted)
    note = _note(window)
    dataset = _dataset(window) or "XJTU-SY"
    metric = spec.get("test_metric") or {}
    summary = (
        f"采样来自 {dataset} 实测回放"
        + (f"（{note}）" if note else "")
        + "。本次只使用梯度提升树，根据此前 30 个振动 RMS 预测剩余寿命比例。"
        f"预测值 {predicted:.4f}。分数 = 100 × 预测剩余寿命比例 = {score:.2f}。"
        "训练标签是轴承失效后回推的剩余寿命比例，这里显示的是模型预测，不是文件中的直线。"
        f"两根留出轴承的平均绝对误差为 {metric.get('mae')}。"
        "事件状态按预测值划分：不低于 0.6 为正常，0.3 至 0.6 为预警，低于 0.3 为告警。这不是轴承故障分类。"
    )
    recommendation = "回放记录不能接受维护指令。需要演示处置时，请把该设备切换到仿真处置。"
    return {
        "device_id": device_id,
        "fault_type": "rul",
        "fault_label": "预测剩余寿命比例",
        "confidence": 0.0,
        "health_score": score,
        "health_level": level,
        "level_label": "预测剩余寿命比例",
        "health_basis": "xjtu_rul",
        "available_channels": _channels(window),
        "agent_results": [],
        "recommendation": recommendation,
        "action": None,
        "diagnosis_method": "xjtu_rul",
        "model_card": _card(
            spec,
            {"predicted_rul": predicted, "score": score},
            "此前 30 个振动 RMS 的当前值、均值、标准差、最小、最大、斜率和变化",
        ),
        "report": {"summary": summary, "recommendation": recommendation},
        "conflicts": [],
        "conflict_detected": False,
    }


def consult_window(device_id: str, window: list[dict]) -> dict[str, Any]:
    """按设备选择会诊模型。仿真、空压机和缺模型都返回未评分。"""
    records = [item for item in window if isinstance(item, dict)]
    if not records:
        return _base(device_id, records, "没有采样窗口，未评分。", "unobserved")
    sources = {item.get("source") for item in records}
    if sources == {"simulation"}:
        return _base(device_id, records, "仿真处置不使用会诊模型，本次未评分。", "simulation")
    if "public_replay" not in sources or len(sources) != 1:
        return _base(device_id, records, "采样来源不是单一的公开数据回放，未评分。", "unobserved")

    dataset = _dataset(records)
    metrics = _metrics() or {}
    if device_id.startswith("compressor") or dataset == "MetroPT-3":
        return _base(device_id, records, "空压机还没有留出训练的会诊模型，未评分。", "unobserved")
    if device_id.startswith("pump") or dataset == "SKAB":
        return _pump(device_id, records, metrics.get("skab") or {})
    if device_id.startswith("motor") or dataset == "XJTU-SY":
        return _motor(device_id, records, metrics.get("xjtu") or {})
    return _base(device_id, records, "该设备没有对应的会诊模型，未评分。", "unobserved")
