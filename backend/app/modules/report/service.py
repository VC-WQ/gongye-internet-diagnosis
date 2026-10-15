"""模块8 报告中心服务：快报 + 事件报告（动态生成，不落库）。

数据来源契约：
- 事件主表：app.models.event.Event（含 sensor_data / agent_diagnosis / feedback_result）
- 诊断结论（PINN/CNN/信号/会诊）：Event.agent_diagnosis 的 agent_results（按 role 筛选）
- 人工确认记录：event_timelines 表
- 控制指令：command_records 表
- 系统自评：复用模块7 accuracy_tracker.metrics

注意：Event.pinn_residual / cnn_result 两个列在当前管线从未写入，本模块
不从这两列取数，避免读空值；真实数值均已落在 agent_diagnosis.agent_results 内。
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from app.models.device import Device
from app.models.event import Event
from app.modules.command_loop.models import CommandRecord, EventTimeline
from app.modules.multi_agent.schemas import FAULT_TYPE_LABELS_ZH

# 快报包含的最近事件条数
RECENT_EVENTS = 5

# 状态 -> 态势归类
_NORMAL_STATES = {"normal", "recovered"}
_WARNING_STATES = {"warning"}
_ALARM_STATES = {"alarm", "consulting", "pending", "handling", "observing", "relapsed"}

_VERDICT_ZH = {"recovered": "恢复", "relapsed": "复发", "extend": "延长观察"}


def _s(v, ndigits: int = 2) -> str:
    """安全字符串化：float 保留小数，None 用占位符。"""
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:.{ndigits}f}"
    return str(v)


def _ts(t) -> str:
    """安全的 ISO 时间字符串（秒精度）。"""
    return t.isoformat(timespec="seconds") if t else "—"


def _label(fault_type: Optional[str]) -> str:
    """故障类型 -> 中文标签（未知原样返回）。"""
    if not fault_type:
        return "—"
    return FAULT_TYPE_LABELS_ZH.get(fault_type, fault_type)


def _find_agent(agent_diagnosis: dict, role: str) -> dict:
    """从 agent_diagnosis.agent_results 中按 role 筛选单个 Agent 结论。"""
    for r in (agent_diagnosis or {}).get("agent_results") or []:
        if isinstance(r, dict) and r.get("agent_role") == role:
            return r
    return {}


class ReportService:
    """AI 报告生成服务（动态生成）。"""

    # ------------------------------------------------------------------
    # 快报
    # ------------------------------------------------------------------
    def generate_flash(self, db: Session, device_id: Optional[str] = None) -> str:
        """生成短文本快报（<200字）：最近事件 + 整体态势 + 一句话总结。

        Args:
            db: 数据库会话。
            device_id: 可选，不传则统计全设备。

        Returns:
            快报纯文本。
        """
        # 1. 最近 N 条事件关键信息
        q = db.query(Event).order_by(Event.timestamp.desc(), Event.id.desc())
        if device_id:
            q = q.filter(Event.device_id == device_id)
        recent = q.limit(RECENT_EVENTS).all()

        event_lines: list[str] = []
        for ev in recent:
            diag = ev.agent_diagnosis or {}
            ft = diag.get("fault_type", "normal")
            hs = diag.get("health_score")
            hs_txt = _s(hs, 1) if isinstance(hs, (int, float)) else "—"
            event_lines.append(
                f"{_ts(ev.timestamp)[5:16]} {ev.device_id} 故障={_label(ft)} 健康分={hs_txt}"
            )

        # 2. 整体态势（events 表按 device_id 取最新一条 status_state 聚合）
        normal = warning = alarm = 0
        latest: dict[str, str] = {}
        all_events = db.query(Event).order_by(Event.timestamp.desc(), Event.id.desc()).all()
        for ev in all_events:
            if device_id and ev.device_id != device_id:
                continue
            if ev.device_id not in latest:
                latest[ev.device_id] = ev.status_state or "normal"
        for state in latest.values():
            if state in _NORMAL_STATES:
                normal += 1
            elif state in _WARNING_STATES:
                warning += 1
            elif state in _ALARM_STATES:
                alarm += 1

        # 3. 一句话总结
        if alarm > 0:
            summary = f"{alarm}台设备处于异常/处置状态，需持续跟进"
        elif warning > 0:
            summary = f"{warning}台设备处于预警，需重点关注"
        else:
            summary = "设备整体运行平稳"

        event_text = "无" if not event_lines else "；".join(event_lines)
        return (
            f"【AI快报】整体态势：正常{normal}台 / 预警{warning}台 / 告警{alarm}台。"
            f"最近事件：{event_text}。一句话总结：{summary}。"
        )

    # ------------------------------------------------------------------
    # 事件报告（Markdown，10 部分）
    # ------------------------------------------------------------------
    def generate_event_report(self, db: Session, event_id: int) -> str:
        """生成指定事件的完整 Markdown 报告（10 部分）。

        Args:
            db: 数据库会话。
            event_id: 事件 ID。

        Returns:
            Markdown 文本。
        """
        event = db.get(Event, event_id)
        if event is None:
            raise ValueError(f"事件 {event_id} 不存在")

        diag = event.agent_diagnosis or {}
        report = diag.get("report") or {}
        diagnosis = report.get("diagnosis") or {}

        device = db.get(Device, event.device_id)

        # 各 Agent 结论
        signal = _find_agent(diag, "signal_analyst")
        physics = _find_agent(diag, "physical_residual")
        cnn = _find_agent(diag, "fault_diagnosis")

        lines: list[str] = []
        a = lines.append

        # 标题与概览
        a(f"# 事件诊断报告 #{event_id}")
        a("")

        # 1. 设备基本信息
        a("## 1. 设备基本信息")
        a(f"- 设备ID：{event.device_id}")
        a(f"- 设备名称：{device.name if device else '—'}")
        a(f"- 设备类型：{device.device_type if device else '—'}")
        a("")

        # 2. 异常事件概述
        a("## 2. 异常事件概述")
        a(f"- 触发时间：{_ts(event.timestamp)}")
        a(f"- 健康分：{_s(diag.get('health_score'))}（{diag.get('level_label', '—')}）")
        a(f"- 严重度：{event.severity or '—'}")
        a("")

        # 3. 信号变化描述
        a("## 3. 信号变化描述")
        channels = diag.get("available_channels") or []
        a(f"- 可用通道：{', '.join(channels) if channels else '—'}")
        if signal:
            a(f"- 信号结论：{signal.get('conclusion', '—')}")
            a(f"- 信号证据：{signal.get('evidence', '—')}")
        else:
            a("- 信号结论：—")
        a("")

        # 4. PINN 物理残差说明
        a("## 4. PINN 物理残差说明")
        p_details = physics.get("details") or {}
        if physics:
            a(f"- 残差值：{_s(p_details.get('residual'), 4)}")
            a(f"- 相对基线倍数：{_s(p_details.get('residual_ratio'), 1)} 倍（Normal 基线 0.019）")
            a(f"- 残差严重度：{p_details.get('residual_severity', '—')}")
            a(f"- 说明：{physics.get('evidence', '—')}")
        else:
            a("- 暂无物理残差数据")
        a("")

        # 5. 模型判断结果与置信度
        a("## 5. 模型判断结果与置信度")
        c_details = cnn.get("details") or {}
        cnn_ft = cnn.get("fault_type") or diag.get("fault_type") or "normal"
        cnn_conf = cnn.get("confidence") if cnn.get("confidence") is not None else diag.get("confidence")
        a(f"- 故障类型：{_label(cnn_ft)}（{cnn_ft}）")
        a(f"- 置信度：{_s(cnn_conf, 4)}")
        probs = c_details.get("probabilities")
        a(f"- 各类置信度：{probs if probs else '—'}")
        a("")

        # 6. 多Agent会诊结论
        a("## 6. 多Agent会诊结论")
        a(f"- 冲突检测：{'检测到冲突' if diag.get('conflict_detected') else '未检测到冲突'}")
        a(f"- 会诊摘要：{report.get('summary') or diagnosis.get('reasoning') or '—'}")
        a(f"- 诊断推理：{diagnosis.get('reasoning', '—')}")
        a("- 各 Agent 结论：")
        for r in diag.get("agent_results") or []:
            if not isinstance(r, dict):
                continue
            a(f"  - {r.get('agent_name', r.get('agent_role', '—'))}：{r.get('conclusion', '—')}")
        a("")

        # 7. 人工确认记录
        a("## 7. 人工确认记录")
        confirm_rows = (
            db.query(EventTimeline)
            .filter(
                EventTimeline.event_id == event_id,
                EventTimeline.from_state == "pending",
                EventTimeline.to_state.in_(["handling", "alarm"]),
            )
            .order_by(EventTimeline.id.asc())
            .all()
        )
        if confirm_rows:
            for row in confirm_rows:
                a(f"- [{_ts(row.created_at)}] {row.operator or '—'}："
                  f"{row.from_state} -> {row.to_state}（{row.reason or '—'}）")
        else:
            a("- 暂无人工确认记录")
        a("")

        # 8. 控制指令与执行结果
        a("## 8. 控制指令与执行结果")
        cmd_rows = (
            db.query(CommandRecord)
            .filter(CommandRecord.event_id == event_id)
            .order_by(CommandRecord.id.asc())
            .all()
        )
        if cmd_rows:
            for row in cmd_rows:
                a(f"- 指令：{row.command or '—'}　状态：{row.status or '—'}　下发时间：{_ts(row.created_at)}")
        else:
            a("- 暂无控制指令记录")
        a("")

        # 9. 反馈评估结果
        a("## 9. 反馈评估结果")
        fb = event.feedback_result or {}
        verdict = fb.get("verdict")
        if verdict:
            a(f"- 判定：{_VERDICT_ZH.get(verdict, verdict)}")
            a(f"- 偏差：{_s(fb.get('deviation_pct'))}%")
            a(f"- 诊断是否确认：{fb.get('diagnosis_confirmed', '—')}")
        else:
            a("- 未进入反馈评估")
        a("")

        # 10. AI 维护建议
        a("## 10. AI 维护建议")
        recommendation = report.get("recommendation") or diag.get("recommendation") or "暂无维护建议"
        a(f"- {recommendation}")

        return "\n".join(lines)


report_service = ReportService()