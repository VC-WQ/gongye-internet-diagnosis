"""模块5 多智能体会诊的数据契约（schemas）。

设计目标：为未来 6 类故障 + 6 通道传感器预留扩展能力，当前仅使用
CWRU 数据所支持的 4 类（normal / inner_race / outer_race / ball）与
单通道（振动 DE）。润滑不良（lubrication）与过热（overheating）由模块1
虚拟设备生成合成数据后补充，当前分支标记为 not_available。
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional


# ---------------------------------------------------------------------------
# 故障类型枚举（6 类）
# ---------------------------------------------------------------------------
class FaultType(str, Enum):
    """故障类型枚举：6 类。

    前 4 类由 CWRU 数据集训练并已验证；后 2 类（润滑不良 / 过热）当前
    无训练数据，标记为 not_available，接口层面先占位。
    """

    NORMAL = "normal"            # 正常
    INNER_RACE = "inner_race"    # 轴承内圈故障
    OUTER_RACE = "outer_race"    # 轴承外圈故障
    BALL = "ball"                # 滚动体故障
    LUBRICATION = "lubrication"  # 润滑不良（暂无数据）
    OVERHEATING = "overheating"  # 过热（暂无数据）


# 6 类故障中文标签
FAULT_TYPE_LABELS_ZH: dict[str, str] = {
    FaultType.NORMAL.value: "正常",
    FaultType.INNER_RACE.value: "内圈故障",
    FaultType.OUTER_RACE.value: "外圈故障",
    FaultType.BALL.value: "滚动体故障",
    FaultType.LUBRICATION.value: "润滑不良",
    FaultType.OVERHEATING.value: "过热",
}

# 各类故障的可用性：前 4 类 available，后 2 类 not_available
FAULT_TYPE_AVAILABILITY: dict[str, str] = {
    FaultType.NORMAL.value: "available",
    FaultType.INNER_RACE.value: "available",
    FaultType.OUTER_RACE.value: "available",
    FaultType.BALL.value: "available",
    FaultType.LUBRICATION.value: "not_available",
    FaultType.OVERHEATING.value: "not_available",
}


# ---------------------------------------------------------------------------
# 传感器窗口（多通道契约，当前仅振动通道有数据）
# ---------------------------------------------------------------------------
@dataclass
class SensorWindow:
    """多通道传感器窗口契约。

    字段：
        vibration : 振动序列（必填，当前为 CWRU 单通道 DE 数据）
        temperature / current / pressure / speed : 可选通道（当前为 None）
        acoustic : 声学特征序列（可选，当前为 None）
        horsepower : 负载马力 0/1/2/3（数据来源标识，当前为 None）
        rpm : 实际转速，可选覆盖 horsepower 推算（当前为 None）

    未来虚拟设备接入多通道遥测后，在对应字段填充序列即可无缝扩展。
    """

    vibration: list[float]                       # 振动（必填，当前仅 DE 通道）
    temperature: Optional[list[float]] = None    # 温度（可选）
    current: Optional[list[float]] = None        # 电流（可选）
    pressure: Optional[list[float]] = None       # 压力（可选）
    speed: Optional[list[float]] = None          # 转速（可选）
    acoustic: Optional[list[float]] = None       # 声学（可选）
    horsepower: Optional[int] = None             # 负载马力 0/1/2/3（数据来源标识）
    rpm: Optional[float] = None                  # 实际转速，可选覆盖 horsepower 推算

    # 当前实际有数据的通道（vibration 恒在，其余按 None 动态收拢）
    @property
    def available_channels(self) -> list[str]:
        """返回当前有数据的通道名列表。"""
        channels: list[str] = []
        for name in ("vibration", "temperature", "current", "pressure", "speed", "acoustic"):
            if getattr(self, name) is not None:
                channels.append(name)
        return channels

    def channel(self, name: str) -> Optional[list[float]]:
        """按通道名安全取值。"""
        return getattr(self, name, None)

    def to_records(self) -> list[dict]:
        """降级为 list[dict] 格式（与模块4 / 边缘推理的窗口契约对齐）。

        当前仅展开 vibration 通道；其余通道为 None 时不产字段。
        """
        records: list[dict] = []
        for i in range(len(self.vibration)):
            rec: dict = {"vibration": float(self.vibration[i])}
            for name in ("temperature", "current", "pressure", "speed", "acoustic"):
                series = getattr(self, name)
                if series is not None and i < len(series):
                    rec[name] = float(series[i])
            records.append(rec)
        return records

    @classmethod
    def from_records(cls, records: list[dict]) -> "SensorWindow":
        """从 list[dict] 窗口构造 SensorWindow（提取各通道数值序列）。

        兼容扁平字段与 observations 嵌套结构（与模块4/边缘推理口径一致）。
        """
        def _pick(rec: dict, key: str) -> Optional[float]:
            if not isinstance(rec, dict):
                return None
            if key in rec and isinstance(rec[key], (int, float)):
                return float(rec[key])
            obs = rec.get("observations")
            if isinstance(obs, dict) and key in obs and isinstance(obs[key], (int, float)):
                return float(obs[key])
            return None

        def _series(key: str, alias: Optional[str] = None) -> Optional[list[float]]:
            vals: list[float] = []
            for rec in records:
                v = _pick(rec, key)
                if v is None and alias is not None:
                    v = _pick(rec, alias)
                if v is not None:
                    vals.append(v)
            return vals if vals else None

        return cls(
            vibration=_series("vibration") or [],
            temperature=_series("temperature"),
            current=_series("current"),
            pressure=_series("pressure"),
            speed=_series("speed", alias="rpm"),
            acoustic=_series("acoustic"),
        )


# ---------------------------------------------------------------------------
# Agent 输出契约
# ---------------------------------------------------------------------------
@dataclass
class AgentResult:
    """单个 Agent 的诊断结论。"""

    agent_role: str                       # Agent 角色标识
    agent_name: str                       # Agent 中文名
    conclusion: str                       # 诊断结论（文本）
    fault_type: str                       # 命中的故障类型（FaultType 值）
    confidence: float                     # 置信度 0~1
    evidence: str                         # 证据说明
    details: dict = field(default_factory=dict)  # 附加结构化信息


@dataclass
class ConsultResult:
    """多智能体会诊的最终汇总结果。"""

    device_id: str
    fault_type: str                       # 最终判定故障类型
    fault_label: str                      # 最终判定中文标签
    confidence: float                     # 综合置信度 0~1
    health_score: float                   # 健康分（透传模块4）
    health_level: str                     # healthy / warning / abnormal
    level_label: str                      # 正常 / 预警 / 异常
    available_channels: list[str]         # 当前有数据的通道
    agent_results: list[AgentResult]      # 各 Agent 结论列表
    recommendation: str                   # 决策建议
    report: dict = field(default_factory=dict)        # 8 部分诊断报告
    conflicts: list = field(default_factory=list)     # 会诊主席冲突列表
    conflict_detected: bool = False                   # 是否检测到冲突


def _round(value: float, ndigits: int = 4) -> float:
    """安全四舍五入（处理 NaN/Inf）。"""
    if value is None:
        return 0.0
    try:
        v = float(value)
        if math.isnan(v) or math.isinf(v):
            return 0.0
        return round(v, ndigits)
    except (TypeError, ValueError):
        return 0.0


__all__ = [
    "FaultType",
    "FAULT_TYPE_LABELS_ZH",
    "FAULT_TYPE_AVAILABILITY",
    "SensorWindow",
    "AgentResult",
    "ConsultResult",
]