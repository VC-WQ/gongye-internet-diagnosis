"""模块9 事件时间线服务。

返回供前端 ECharts 渲染的时间线数据，包含三类数据：
1. 多通道传感器曲线（来自 Event.sensor_data，采样点索引轴，支持降采样）
2. 隐状态曲线（latent_wear/latent_heat/latent_efficiency）
3. 事件标注点（EventTimeline 状态变更 + Event 触发时间 + feedback_result 恢复）

坐标说明：sensor/latent 使用「采样点索引轴」（Event.sensor_data 无逐点时间戳，
是告警时刻的原始信号窗口）；annotations 使用「绝对时间轴」。二者天然不在同一
坐标系，API 不做硬造对齐，由前端分两层渲染。

隐状态数据缺失说明（非模块9缺陷）：
virtual_device 生成 hidden_state -> MQTT 传出 -> mqtt_pipeline._normalize 归一化
为 latent_wear/heat/efficiency 后【仅写内存滑动窗口，不落库】。因此当前 Event
链路的 sensor_data 里没有隐状态字段。
TODO(未来修复)：在 command_loop 创建事件时，从 MQTT 隐状态快照读取当前值写入
Event，届时本模块即可直接读到真实隐状态，无需 simulate_latent 兜底。
"""
from __future__ import annotations

import math
from typing import Any, Optional

import numpy as np
from sqlalchemy.orm import Session

from app.models.event import Event
from app.modules.command_loop.models import EventTimeline

# 观测通道白名单（物理观测值，区别于隐状态/边缘分数等标签字段）
_OBSERVATION_KEYS = ("vibration", "temperature", "current", "pressure", "speed", "acoustic", "rpm")
# 隐状态通道
_LATENT_KEYS = ("latent_wear", "latent_heat", "latent_efficiency")

# 状态 -> 中文标签（用于标注点）
_STATE_LABEL = {
    "normal": "正常",
    "warning": "预警",
    "alarm": "告警",
    "consulting": "会诊",
    "pending": "待确认",
    "handling": "处置中",
    "observing": "观察期",
    "recovered": "已恢复",
    "relapsed": "复发",
}

# 采样点上、下限（保护响应体大小）
MAX_POINTS_LIMIT = 2048
DEFAULT_MAX_POINTS = 256


def _ts(t) -> Optional[str]:
    """安全的 ISO 时间字符串。"""
    return t.isoformat(timespec="seconds") if t else None


def _numeric_or_none(value: Any) -> Optional[float]:
    """把真实观测值转成有限浮点数；缺失或非法值保留为空点，不伪造 0。"""
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) else None


def _downsample(values: list, max_points: int) -> tuple[list[Optional[float]], int, int, bool]:
    """按步长降采样，返回 (采样结果, 点数, 步长, 是否降采样)。

    缺失/非法观测保留为 None，前端据此断线显示，而不是崩溃或被补造成 0。
    """
    n = len(values)
    if n == 0:
        return [], 0, 1, False
    if n <= max_points:
        return [_numeric_or_none(v) for v in values], n, 1, False
    stride = math.ceil(n / max_points)
    out = [_numeric_or_none(values[i]) for i in range(0, n, stride)]
    return out, len(out), stride, True


def _simulate_latent(event_id: int, fault_type: str, health_score: float, n: int) -> dict[str, list[float]]:
    """确定性生成演示用隐状态曲线（基于 fault_type + health_score）。

    同一 event_id 始终返回完全相同的曲线；event_id % 200 提供小幅扰动，
    使不同事件略有差异。模拟思路：不同类型故障对应不同退化动力学：
    - Normal：隐状态低且平稳
    - outer_race：外圈固定、冲击一致 -> 指数陡升/陡降，趋势最陡
    - inner_race：内圈随转动周期受载 -> 前段平稳、后段阶跃式恶化
    - ball：滚动体冲击不稳定 -> 缓升/缓降叠加正弦波动
    """
    t = np.linspace(0.0, 1.0, n) if n > 0 else np.array([])

    if fault_type == "normal":
        wear = np.full(n, 0.10)
        heat = np.full(n, 0.08)
        eff = np.full(n, 0.96)
    elif fault_type == "outer_race":
        wear = 0.10 + 0.70 * (t ** 2.5)
        heat = 0.08 + 0.55 * (t ** 2.0)
        eff = 0.96 - 0.45 * (t ** 2.0)
    elif fault_type == "inner_race":
        ramp = np.clip((t - 0.30) / 0.70, 0.0, 1.0) ** 2.0
        wear = 0.10 + 0.72 * ramp
        heat = 0.08 + 0.50 * ramp
        eff = 0.96 - 0.50 * ramp
    elif fault_type == "ball":
        wear = 0.10 + 0.35 * t + 0.030 * np.sin(2 * np.pi * 6 * t)
        heat = 0.08 + 0.30 * t + 0.020 * np.sin(2 * np.pi * 5 * t + 1.0)
        eff = 0.96 - 0.30 * t + 0.020 * np.sin(2 * np.pi * 4 * t)
    else:
        wear = 0.10 + 0.40 * t
        heat = 0.08 + 0.35 * t
        eff = 0.96 - 0.35 * t

    # health_score 调节严重度（健康分越低退化越剧烈）
    sev = max(0.0, min(1.0, (100.0 - float(health_score)) / 100.0))
    wear = wear * (1.0 + 0.25 * sev)
    heat = heat * (1.0 + 0.25 * sev)
    eff = eff - 0.10 * sev

    # 确定性扰动（固定种子，保证重复请求一致）
    rng = np.random.RandomState(event_id)
    strike = (event_id % 200) / 200.0
    scale = 0.004 + 0.016 * strike
    wear = np.clip(wear + rng.normal(0.0, scale, n), 0.0, 1.0)
    heat = np.clip(heat + rng.normal(0.0, scale, n), 0.0, 1.0)
    eff = np.clip(eff + rng.normal(0.0, scale, n), 0.0, 1.0)

    return {
        "latent_wear": [round(float(v), 4) for v in wear],
        "latent_heat": [round(float(v), 4) for v in heat],
        "latent_efficiency": [round(float(v), 4) for v in eff],
    }


class TimelineService:
    """事件时间线服务。"""

    def event_timeline(
        self,
        db: Session,
        event_id: int,
        max_points: int = DEFAULT_MAX_POINTS,
        simulate_latent: bool = False,
    ) -> dict:
        """返回单个事件的完整时间线数据（sensor + latent + annotations）。"""
        event = db.get(Event, event_id)
        if event is None:
            raise ValueError(f"事件 {event_id} 不存在")

        max_points = max(1, min(MAX_POINTS_LIMIT, max_points))

        sensor_data = event.sensor_data if isinstance(event.sensor_data, list) else []
        diag = event.agent_diagnosis or {}

        # --------------------------------------------------------------
        # 1. 传感器曲线（观测通道，采样点索引轴）
        # --------------------------------------------------------------
        present_keys: set[str] = set()
        for d in sensor_data:
            if isinstance(d, dict):
                present_keys.update(d.keys())

        sensor_channels = [k for k in _OBSERVATION_KEYS if k in present_keys]

        series: dict[str, list[float]] = {}
        points = 0
        stride = 1
        downsampled = False
        for ch in _OBSERVATION_KEYS:
            if ch not in sensor_channels:
                series[ch] = []
                continue
            values = [d[ch] for d in sensor_data if isinstance(d, dict) and ch in d]
            sampled, npts, stride, downsampled = _downsample(values, max_points)
            series[ch] = sampled
            points = npts

        sensor_block = {
            "channels": sensor_channels,
            "downsampled": downsampled,
            "stride": stride,
            "points": points,
            "series": series,
        }

        # --------------------------------------------------------------
        # 2. 隐状态曲线
        # --------------------------------------------------------------
        latent_available = all(k in present_keys for k in _LATENT_KEYS)
        if latent_available:
            latent_series = {
                k: [_numeric_or_none(d.get(k)) for d in sensor_data if isinstance(d, dict)]
                for k in _LATENT_KEYS
            }
            # 与传感器曲线同点数，便于前端同轴叠加
            for k in _LATENT_KEYS:
                v, _, _, _ = _downsample(latent_series[k], max_points)
                latent_series[k] = v
        elif simulate_latent:
            health_score = _numeric_or_none(diag.get("health_score"))
            latent_series = _simulate_latent(
                event.id,
                str(diag.get("fault_type", "normal")),
                100.0 if health_score is None else health_score,
                points or DEFAULT_MAX_POINTS,
            )
        else:
            latent_series = {k: [] for k in _LATENT_KEYS}

        latent_block = {
            "available": latent_available or simulate_latent,
            "simulated": simulate_latent and not latent_available,
            "series": latent_series,
        }

        # --------------------------------------------------------------
        # 3. 事件标注点（绝对时间轴）
        # --------------------------------------------------------------
        timeline_rows = (
            db.query(EventTimeline)
            .filter(EventTimeline.event_id == event_id)
            .order_by(EventTimeline.id.asc())
            .all()
        )

        annotations: list[dict[str, Any]] = []
        # 事件触发
        annotations.append(
            {
                "time": _ts(event.timestamp),
                "type": "trigger",
                "label": "事件触发",
                "detail": f"健康分 {diag.get('health_score', '—')}",
            }
        )
        # 状态变更
        for row in timeline_rows:
            annotations.append(
                {
                    "time": _ts(row.created_at),
                    "type": "state",
                    "label": _STATE_LABEL.get(row.to_state, row.to_state or "—"),
                    "from": row.from_state,
                    "to": row.to_state,
                    "operator": row.operator,
                    "reason": row.reason,
                }
            )

        # 恢复/复发（来自 feedback_result）
        fb = event.feedback_result or {}
        verdict = fb.get("verdict")
        if verdict:
            # 取对应状态变更时间作为恢复/复发时间
            recovery_time = None
            if verdict in ("recovered", "relapsed"):
                for row in timeline_rows:
                    if row.to_state == verdict:
                        recovery_time = _ts(row.created_at)
            if recovery_time is None and timeline_rows:
                recovery_time = _ts(timeline_rows[-1].created_at)

            annotations.append(
                {
                    "time": recovery_time,
                    "type": "recovery",
                    "label": _STATE_LABEL.get(verdict, verdict),
                    "verdict": verdict,
                    "deviation_pct": fb.get("deviation_pct"),
                }
            )

        return {
            "event_id": event.id,
            "device_id": event.device_id,
            "fault_type": diag.get("fault_type"),
            "health_score": diag.get("health_score"),
            "status_state": event.status_state,
            "trigger_time": _ts(event.timestamp),
            "sensor": sensor_block,
            "latent": latent_block,
            "annotations": annotations,
        }

    def device_events(self, db: Session, device_id: str, limit: int = 20) -> dict:
        """返回某设备最近的多个事件摘要（列表）。"""
        rows = (
            db.query(Event)
            .filter(Event.device_id == device_id)
            .order_by(Event.id.desc())
            .limit(max(1, min(100, limit)))
            .all()
        )

        events_list = []
        for ev in rows:
            diag = ev.agent_diagnosis or {}
            events_list.append(
                {
                    "event_id": ev.id,
                    "trigger_time": _ts(ev.timestamp),
                    "fault_type": diag.get("fault_type"),
                    "health_score": diag.get("health_score"),
                    "status_state": ev.status_state,
                    "severity": ev.severity,
                }
            )

        return {"device_id": device_id, "count": len(events_list), "events": events_list}


timeline_service = TimelineService()