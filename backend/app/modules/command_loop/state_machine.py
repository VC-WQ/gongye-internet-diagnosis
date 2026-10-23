"""模块6 状态机：状态转换规则与推进。

决策对齐：
- 决策1（A）：初始状态直接映射模块5 health_level（healthy→normal /
  warning→warning / abnormal→alarm）。
- 决策2：告警可由「故障类 fault_type != normal 且 confidence > 0.7」触发，
  避免 Normal 样本的 softmax 高置信被误判为告警。
- 决策2b：健康分 < 30（严重异常）时直接告警，不因分类置信度低而漏报。
- 决策3：9 个状态，保留独立 relapsed。
- 决策4：normal→alarm 允许直接跳步（健康分骤降），但 reason 必须留痕说明。
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.event import Event

from .models import EventState, EventTimeline

# 允许的状态转换（缺失边即「禁止跳步」）
TRANSITIONS: dict[EventState, set[EventState]] = {
    EventState.NORMAL:     {EventState.WARNING, EventState.ALARM},   # 允许骤降跳过预警（决策4）
    EventState.WARNING:    {EventState.NORMAL, EventState.ALARM},
    EventState.ALARM:      {EventState.WARNING, EventState.CONSULTING},
    EventState.CONSULTING: {EventState.PENDING},
    EventState.PENDING:    {EventState.HANDLING, EventState.ALARM},  # 确认→处置 / 拒绝→回告警
    EventState.HANDLING:   {EventState.OBSERVING},
    EventState.OBSERVING:  {EventState.RECOVERED, EventState.RELAPSED},
    EventState.RELAPSED:   {EventState.CONSULTING},                  # 复发→再诊断
    EventState.RECOVERED:  {EventState.NORMAL},
}

# 健康分危险阈值：低于该值直接告警（物理残差已确认严重异常）
CRITICAL_HEALTH_THRESHOLD = 30.0


class StateTransitionError(Exception):
    """非法状态转换（跳步）异常。"""


def _to_state(value) -> EventState:
    """将 str / EventState 统一为 EventState。"""
    if isinstance(value, EventState):
        return value
    return EventState(str(value))


def can_transition(from_state, to_state) -> bool:
    """判断 from_state 是否允许转换到 to_state。"""
    f = _to_state(from_state)
    t = _to_state(to_state)
    return t in TRANSITIONS.get(f, set())


def classify_state(
    health_level: str,
    fault_type: str,
    confidence: float,
    health_score: Optional[float] = None,
) -> EventState:
    """由模块5诊断结果推导事件初始状态。

    决策1（A）：以 health_level 为主映射（避免与模块4/5 的85/60阈值矛盾）：
        healthy  -> normal
        warning  -> warning
        abnormal -> alarm（满足以下任一条件，见决策2/2b/2c）
    决策2：物理残差判定异常，且诊断给出具体故障类型 -> alarm。
        置信度作为报告中的参考值，不作为唯一门限：分类模型缺失或融合置信度偏低时，
        不能因此漏报已由物理残差与频谱证据共同确认的异常。
    决策2b：健康分低于危险阈值（<30）-> alarm，即使分类结论为 normal。
    决策2c：故障分类模型不可用（fault_type=unknown）-> alarm（未分类异常）。
    """
    if health_level in ("unobserved", "unlabeled"):
        return EventState.NORMAL
    if health_level == "healthy":
        return EventState.NORMAL
    if health_level == "warning":
        return EventState.WARNING
    # abnormal：
    if health_score is not None and health_score < CRITICAL_HEALTH_THRESHOLD:
        return EventState.ALARM
    # 物理残差异常 + 具体故障类型 -> 告警
    if fault_type not in ("normal", "unknown"):
        return EventState.ALARM
    # 物理残差异常但分类模型不可用 -> 未分类异常，仍需告警
    if fault_type == "unknown":
        return EventState.ALARM
    # 物理异常但分类结论为 normal：回落预警，等待人工判断
    return EventState.WARNING


def advance(
    db: Session,
    event: Event,
    to_state,
    reason: str,
    operator: Optional[str] = "system",
) -> EventTimeline:
    """推进事件状态：校验合法性、更新当前状态、写审计日志。

    Args:
        db: 数据库会话。
        event: 事件 ORM 对象（复用 Event.status_state 存当前状态）。
        to_state: 目标状态（EventState 或字符串）。
        reason: 变更原因（why）。
        operator: 操作人（who）。

    Returns:
        新增的 EventTimeline 记录（尚未 commit，由调用方统一提交）。

    Raises:
        StateTransitionError: 非法跳步。
    """
    to_state = _to_state(to_state)
    from_state = _to_state(event.status_state) if event.status_state else None

    # 初始状态（from_state=None）允许直接进入；其余必须满足转移矩阵
    if from_state is not None and not can_transition(from_state, to_state):
        raise StateTransitionError(
            f"非法状态转换：{from_state.value} -> {to_state.value}（禁止跳步）"
        )

    event.status_state = to_state.value
    timeline = EventTimeline(
        event_id=event.id,
        device_id=event.device_id,
        from_state=from_state.value if from_state else None,
        to_state=to_state.value,
        reason=reason,
        operator=operator,
    )
    db.add(timeline)
    return timeline