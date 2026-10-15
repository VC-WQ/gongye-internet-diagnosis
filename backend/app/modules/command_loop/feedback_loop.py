"""模块7 闭环1 编排：观察期曲线评估 -> 状态流转 -> 写反馈 -> 联动闭环2/3。

承接模块6 的 state_machine（不修改其核心），在 observing 阶段用升级后的
feedback_evaluator.evaluate_recovery 做恢复曲线对比：
    - recovered：写 feedback_result，状态 -> recovered，记录诊断（闭环3）
    - relapsed ：写 feedback_result，状态 -> relapsed -> consulting -> pending
                 （再诊断），并自动触发阈值建议（闭环2）
    - extend   ：延长观察期，保持 observing，不记录、不触发建议（补充2）
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models.event import Event
from app.modules.multi_agent.service import multi_agent_service

from . import state_machine
from .accuracy_tracker import accuracy_tracker
from .feedback_evaluator import feedback_evaluator
from .models import EventState
from .threshold_adapter import threshold_adapter


class FeedbackLoopService:
    """闭环1 编排服务。"""

    def observe_and_evaluate(
        self,
        db: Session,
        event_id: int,
        actual_curve: list[float],
        operator: str = "system",
    ) -> dict:
        """对处于 observing 的事件做恢复曲线对比并推进状态。

        Args:
            db: 数据库会话。
            event_id: 事件 ID（当前应为 observing 状态）。
            actual_curve: 观察期实际健康分采样序列（验收注入）。
            operator: 操作人（who）。

        Returns:
            {event_id, status_state, feedback_result}
        """
        event = db.get(Event, event_id)
        if event is None:
            raise ValueError(f"事件 {event_id} 不存在")

        device_id = event.device_id
        ts = event.timestamp
        fault_type = str((event.agent_diagnosis or {}).get("fault_type", "normal"))
        latency = (datetime.utcnow() - ts).total_seconds() if ts else 0.0

        verdict = feedback_evaluator.evaluate_recovery(actual_curve)
        event.feedback_result = verdict
        v = verdict["verdict"]

        if v == "recovered":
            state_machine.advance(
                db, event, EventState.RECOVERED,
                f"恢复曲线偏差{verdict['deviation_pct']}%<15%，诊断确认", operator,
            )
        elif v == "relapsed":
            state_machine.advance(
                db, event, EventState.RELAPSED,
                f"恢复曲线偏差{verdict['deviation_pct']}%>30%，触发再诊断", operator,
            )
            state_machine.advance(
                db, event, EventState.CONSULTING, "复发：重新会诊", "system"
            )
            window = event.sensor_data if isinstance(event.sensor_data, list) else []
            consult = multi_agent_service.consult(device_id, window)
            event.agent_diagnosis = consult
            fault_type = str(consult.get("fault_type", fault_type))
            state_machine.advance(
                db, event, EventState.PENDING, "再诊断完成，等待人工确认", "system"
            )
        # extend：不推进状态，保持 observing
        db.commit()

        # 事件结束（recovered/relapsed）才记录诊断（闭环3）；extend 暂不记录
        if v in ("recovered", "relapsed"):
            accuracy_tracker.record(db, event.id, fault_type, latency)
        # 诊断未确认 -> 自动触发阈值建议（闭环2，补充2）
        if v == "relapsed":
            threshold_adapter.generate_suggestions(db, device_id)

        return {
            "event_id": event.id,
            "status_state": event.status_state,
            "feedback_result": verdict,
        }


feedback_loop_service = FeedbackLoopService()