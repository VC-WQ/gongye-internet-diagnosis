"""模块6 指令闭环服务：事件创建、人工确认、指令下发、观察期反馈评估。

职责：
- 复用 app/models/event.py 的 Event 表作为事件主表。
- 编排状态机（state_machine）与多智能体会诊（模块5）、指令下发（mock）、
  反馈评估（feedback_evaluator）。
"""
from __future__ import annotations

import logging
import time
from typing import Any, Optional

from sqlalchemy.orm import Session

from app.models.event import Event
from app.modules.multi_agent.service import multi_agent_service

from . import state_machine
from .accuracy_tracker import accuracy_tracker
from .feedback_evaluator import feedback_evaluator
from .models import CommandRecord, EventState, EventTimeline
from .mqtt_publisher import mqtt_command_publisher
from .state_machine import StateTransitionError

logger = logging.getLogger(__name__)

# 故障结论中英文归一化：机器预测存英文代码(fault_type)，人工修订多为中文标签(fault_label)，
# 统一归一为英文代码，保证 diagnosis_records.predicted_fault 与 actual_fault 可比、is_correct 计算正确。
_FAULT_NORMALIZE = {
    "normal": "normal", "正常": "normal",
    "inner_race": "inner_race", "内圈故障": "inner_race", "内圈": "inner_race",
    "outer_race": "outer_race", "外圈故障": "outer_race", "外圈": "outer_race",
    "ball": "ball", "滚动体故障": "ball", "球故障": "ball", "滚动体": "ball",
}


def _norm_fault(value) -> str:
    """将中英文故障结论归一为英文代码；未知值原样返回（避免误判）。"""
    if value is None:
        return "normal"
    s = str(value).strip()
    return _FAULT_NORMALIZE.get(s, s)

# 状态 -> 严重级别
_SEVERITY_BY_STATE = {
    EventState.NORMAL: "info",
    EventState.WARNING: "warning",
    EventState.ALARM: "critical",
}


class EventNotFoundError(Exception):
    """事件不存在异常。"""


class CommandLoopService:
    """指令闭环服务。"""

    # ------------------------------------------------------------------
    # 事件创建与查询
    # ------------------------------------------------------------------
    def create_event(
        self,
        db: Session,
        device_id: str,
        window: list[dict],
        operator: str = "system",
        vision: dict | None = None,
        force: bool = False,
    ) -> dict:
        """创建诊断事件：会诊 -> 判定初始状态 -> 若告警则自动进入会诊/待确认。

        同一设备存在未闭环事件（consulting/pending/handling/observing）时，
        默认复用该事件，避免重复点击或重复调用生成两条并行处置记录。
        `force=True` 可显式创建新事件（供管理员/测试使用）。

        Args:
            vision: 可选的部件表面视觉检测结果（第五路证据），
                {"available": bool, "damage_type": str|None, "confidence": float, "count": int}
                提供后参与 D-S 融合，并与振动结论做交叉验证（可识别"早期窗口期"）。
        """
        # 0. 未闭环事件保护（幂等）
        if not force:
            active = (
                db.query(Event)
                .filter(
                    Event.device_id == device_id,
                    Event.status_state.in_(
                        ("consulting", "pending", "handling", "observing")
                    ),
                )
                .order_by(Event.id.desc())
                .first()
            )
            if active is not None:
                result = self.get_event(db, active.id) or {}
                result["reused"] = True
                return result

        # 1. 多智能体会诊（模块5）
        _t0 = time.perf_counter()
        consult = multi_agent_service.consult(device_id, window, vision)
        _latency = round(time.perf_counter() - _t0, 3)
        health_level = str(consult.get("health_level", "healthy"))
        fault_type = str(consult.get("fault_type", "normal"))
        confidence = float(consult.get("confidence", 0.0))
        health_score = float(consult.get("health_score", 100.0))

        # 2. 判定初始状态（决策1/决策2/决策2b）
        initial_state = state_machine.classify_state(
            health_level, fault_type, confidence, health_score
        )

        # 3. 建事件主表
        event = Event(
            device_id=device_id,
            event_type="diagnosis_event",
            status_state=None,
            severity=_SEVERITY_BY_STATE.get(
                initial_state, "info"
            ),
            sensor_data=window,
            agent_diagnosis=consult,
        )
        db.add(event)
        db.flush()  # 取得 event.id 供时间线使用

        # 4. 写入初始状态（决策4：告警需留痕「跳过预警」）
        if initial_state == EventState.ALARM:
            init_reason = "健康分骤降，跳过预警（初始判定告警）"
        elif initial_state == EventState.WARNING:
            init_reason = "健康分进入预警区间"
        else:
            init_reason = "健康分正常"
        state_machine.advance(db, event, initial_state, init_reason, operator)

        # 5. 告警 -> 会诊中 -> 待确认（会诊已在第1步完成）
        if initial_state == EventState.ALARM:
            state_machine.advance(
                db, event, EventState.CONSULTING, "触发多智能体会诊", "system"
            )
            state_machine.advance(
                db, event, EventState.PENDING, "生成诊断报告，等待人工确认", "system"
            )

        # 6. 诊断结论写入准确率自跟踪表（predicted=机器结论，actual 待人工确认）
        accuracy_tracker.record(db, event.id, fault_type, latency_seconds=_latency)

        db.commit()
        return self.get_event(db, event.id)

    def get_event(self, db: Session, event_id: int) -> dict | None:
        """查询事件（含当前状态与诊断报告）。"""
        event = db.get(Event, event_id)
        if event is None:
            return None
        return self._event_to_dict(event)

    def get_timeline(self, db: Session, event_id: int) -> list[dict]:
        """查询事件状态变更时间线。"""
        rows = (
            db.query(EventTimeline)
            .filter(EventTimeline.event_id == event_id)
            .order_by(EventTimeline.id.asc())
            .all()
        )
        return [self._timeline_to_dict(r) for r in rows]

    def list_events(
        self,
        db: Session,
        device_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict]:
        """查询事件列表（按时间倒序），可选按设备过滤。"""
        q = db.query(Event).order_by(Event.timestamp.desc())
        if device_id:
            q = q.filter(Event.device_id == device_id)
        events = q.offset(offset).limit(limit).all()

        result: list[dict] = []
        for event in events:
            item = self._event_to_dict(event)
            # 当前状态机状态取最后一条时间线记录的 to_state
            last_timeline = (
                db.query(EventTimeline)
                .filter(EventTimeline.event_id == event.id)
                .order_by(EventTimeline.id.desc())
                .first()
            )
            item["status_state"] = (
                last_timeline.to_state if last_timeline else event.status_state
            )
            result.append(item)
        return result

    # ------------------------------------------------------------------
    # 人工确认 / 拒绝
    # ------------------------------------------------------------------
    def confirm(self, db: Session, event_id: int, operator: str) -> dict:
        """人工确认执行（pending -> handling）：认可 AI 诊断结论，注入人工根因（含人工修订后的结论）。"""
        event = self._get_or_raise(db, event_id)
        state_machine.advance(db, event, EventState.HANDLING, "人工确认执行指令", operator)
        # 注入人工确认根因：以（修订后的）故障结论为准，统一归一为英文代码
        _diag = event.agent_diagnosis or {}
        _actual = _norm_fault(_diag.get("fault_label") or _diag.get("fault_type") or "normal")
        self._record_ground_truth_safe(db, event.id, _actual)
        db.commit()
        return self.get_event(db, event_id)

    def reject(self, db: Session, event_id: int, operator: str, reason: str = "人工拒绝") -> dict:
        """人工拒绝（pending -> alarm，重新评估）：人工判定设备实际正常，注入根因为 normal（产生误报样本）。"""
        event = self._get_or_raise(db, event_id)
        state_machine.advance(
            db, event, EventState.ALARM, f"人工拒绝：{reason}", operator
        )
        # 人工拒绝 = 判定实际无故障 -> actual=normal（若机器预测了故障，即误报 FP）
        self._record_ground_truth_safe(db, event.id, "normal")
        db.commit()
        return self.get_event(db, event_id)

    def revise(
        self,
        db: Session,
        event_id: int,
        operator: str,
        recommendation: Optional[str] = None,
        fault_label: Optional[str] = None,
        note: Optional[str] = None,
    ) -> dict:
        """人工修改诊断建议（不改变状态机状态，仅改写报告 + 审计留痕）。

        现场工程师常需要根据点检实况修正 AI 给出的维护建议（如把「立即停机检修」
        改为「降载运行并安排次日检修」）。修改内容需与原建议一并留痕，便于复盘
        AI 建议的采纳率与偏差，同时作为后续阈值/知识库优化的依据。
        """
        event = self._get_or_raise(db, event_id)

        diag = dict(event.agent_diagnosis or {})
        report = dict(diag.get("report") or {})

        changes: list[str] = []
        if recommendation is not None and str(recommendation).strip():
            old_rec = str(report.get("recommendation", "") or "")
            if old_rec != str(recommendation).strip():
                changes.append(f"维护建议：{old_rec or '（空）'} → {recommendation}")
                report["recommendation"] = str(recommendation).strip()
        if fault_label is not None and str(fault_label).strip():
            old_label = str(diag.get("fault_label") or diag.get("fault_type") or "")
            if old_label != str(fault_label).strip():
                changes.append(f"故障结论：{old_label or '（空）'} → {fault_label}")
                diag["fault_label"] = str(fault_label).strip()

        if not changes:
            changes.append("未产生字段变更（提交内容与原文一致）")

        diag["report"] = report
        diag["human_revision"] = {
            "operator": operator,
            "note": note or "",
            "changes": changes,
        }
        # JSON 列需整体重新赋值才会被 SQLAlchemy 标记为 dirty
        event.agent_diagnosis = diag

        # 审计留痕：状态不变（from == to），仅记录 who/when/why
        db.add(
            EventTimeline(
                event_id=event.id,
                device_id=event.device_id,
                from_state=event.status_state,
                to_state=event.status_state,
                reason="人工修改建议：" + "；".join(changes) + (f"（说明：{note}）" if note else ""),
                operator=operator,
            )
        )
        db.commit()
        return self.get_event(db, event_id)

    # ------------------------------------------------------------------
    # 指令下发
    # ------------------------------------------------------------------
    def execute(
        self, db: Session, event_id: int, operator: str, command: Optional[str] = None
    ) -> dict:
        """执行指令（handling -> observing）：下发指令并进入观察期。"""
        event = self._get_or_raise(db, event_id)

        report = (event.agent_diagnosis or {}).get("report") or {}
        recommendation = report.get("recommendation", "执行维护指令")
        cmd = command or recommendation

        # 先校验状态转换（handling -> observing），非法状态直接拒绝，
        # 避免「状态不合法却已经把指令发到设备」的副作用。
        state_machine.advance(
            db, event, EventState.OBSERVING, "指令下发成功，进入观察期", operator
        )

        # MQTT 真实下发（Broker 不可用时抛 CommandPublishError；事务未提交会自动回滚）
        published = mqtt_command_publisher.publish_command(
            event.device_id, cmd, {"event_id": event.id}, event_id=event.id
        )
        command_id = published["command_id"]

        # 记录指令（status 由设备回执更新为 done / failed）
        db.add(
            CommandRecord(
                device_id=event.device_id,
                event_id=event.id,
                command=cmd,
                params={
                    "event_id": event.id,
                    "command_id": command_id,
                    "topic": published["topic"],
                },
                status="sent",
            )
        )
        db.commit()
        return {
            "event": self.get_event(db, event_id),
            "command_id": command_id,
            "mqtt_topic": published["topic"],
        }

    # ------------------------------------------------------------------
    # 观察期反馈评估
    # ------------------------------------------------------------------
    def evaluate_feedback(
        self, db: Session, event_id: int, health_score: float, operator: str = "system"
    ) -> dict:
        """观察期反馈评估（observing -> recovered / relapsed）。

        - 恢复：health_score 回升 > 阈值 -> recovered。
        - 未恢复：-> relapsed -> consulting（再诊断）-> pending。
        """
        event = self._get_or_raise(db, event_id)
        recovered = feedback_evaluator.evaluate(health_score)

        if recovered:
            state_machine.advance(
                db, event, EventState.RECOVERED,
                f"反馈偏差小，健康分回升至 {health_score:.1f}，处置生效", operator,
            )
        else:
            state_machine.advance(
                db, event, EventState.RELAPSED,
                f"反馈偏差大，健康分 {health_score:.1f} 未恢复，触发复发再诊断", operator,
            )
            state_machine.advance(
                db, event, EventState.CONSULTING, "复发：重新触发多智能体会诊", "system"
            )
            # 再诊断：用事件保存的原始窗口重新会诊
            window = event.sensor_data if isinstance(event.sensor_data, list) else []
            consult = multi_agent_service.consult(event.device_id, window)
            event.agent_diagnosis = consult
            state_machine.advance(
                db, event, EventState.PENDING, "再诊断完成，重新等待人工确认", "system"
            )

        db.commit()
        return self.get_event(db, event_id)

    # ------------------------------------------------------------------
    # 内部工具
    # ------------------------------------------------------------------
    def _get_or_raise(self, db: Session, event_id: int) -> Event:
        event = db.get(Event, event_id)
        if event is None:
            raise EventNotFoundError(f"事件 {event_id} 不存在")
        return event

    @staticmethod
    def _record_ground_truth_safe(db: Session, event_id: int, actual_fault: str) -> None:
        """安全注入人工根因：事件须已有诊断记录才写入，否则忽略（避免误建孤立记录）。"""
        try:
            accuracy_tracker.record_ground_truth(db, event_id, actual_fault)
        except ValueError:
            logger.warning("事件 %s 无诊断记录，跳过根因注入", event_id)

    @staticmethod
    def _event_to_dict(event: Event) -> dict:
        diag = event.agent_diagnosis or {}
        report = diag.get("report") or {}
        return {
            "id": event.id,
            "device_id": event.device_id,
            "event_type": event.event_type,
            "status_state": event.status_state,
            "severity": event.severity,
            "fault_type": diag.get("fault_type"),
            "confidence": diag.get("confidence"),
            "health_score": diag.get("health_score"),
            "report": report,
            "agent_diagnosis": diag,
            "timestamp": event.timestamp.isoformat() if event.timestamp else None,
        }

    @staticmethod
    def _timeline_to_dict(row: EventTimeline) -> dict:
        return {
            "id": row.id,
            "event_id": row.event_id,
            "device_id": row.device_id,
            "from_state": row.from_state,
            "to_state": row.to_state,
            "reason": row.reason,
            "operator": row.operator,
            "created_at": row.created_at.isoformat() if row.created_at else None,
        }


command_loop_service = CommandLoopService()