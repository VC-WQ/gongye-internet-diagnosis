"""模块5 多智能体会诊服务。

工厂里的智能诊断只调用已训练的泵分类模型和电机剩余寿命模型。
轴承会诊图只从 consult_research 进入，并且先检查采样率和权重。
"""
from __future__ import annotations

import logging
from typing import Any

from .graph import consultation_graph

logger = logging.getLogger(__name__)


def _persist_score(device_id: str, result: dict) -> None:
    """把模型分数写到设备卡片。没有模型输出时清空，避免留下标签分。"""
    try:
        from app.models import Device, SessionLocal
    except Exception:
        return
    db = SessionLocal()
    try:
        device = db.get(Device, device_id)
        if device is None:
            return
        basis = result.get("health_basis")
        score = result.get("health_score")
        level = str(result.get("health_level") or "")
        if isinstance(score, (int, float)) and basis in ("skab_probability", "xjtu_rul"):
            device.health_score = float(score)
            device.health_basis = str(basis)
            device.health_observed = True
            device.status = {"healthy": "healthy", "warning": "degraded", "abnormal": "fault"}.get(level, "unknown")
        else:
            device.health_score = None
            device.health_basis = basis if basis in ("simulation", "unobserved") else None
            if device.run_mode != "simulation":
                device.status = "unknown"
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.warning("回写会诊分数失败：%s", exc)
    finally:
        db.close()


class MultiAgentService:
    """多智能体会诊服务（门面）。"""

    def __init__(self) -> None:
        self.graph = consultation_graph

    def consult(self, device_id: str, window: Any, vision: dict | None = None) -> dict:
        """工厂诊断入口。不进入 12 kHz 轴承会诊，也不使用部件图像。"""
        del vision
        records = window if isinstance(window, list) else []
        from .replay_consult import consult_replay

        result = consult_replay(device_id, records)
        _persist_score(device_id, result)
        score = result.get("health_score")
        score_text = f"{float(score):.2f}" if isinstance(score, (int, float)) else "未评分"
        logger.info(
            "设备 %s 会诊完成：%s（%.4f）健康分 %s channels=%s",
            device_id,
            result["fault_label"],
            result["confidence"],
            score_text,
            result["available_channels"],
        )
        return result

    def consult_research(self, device_id: str, window: Any, vision: dict | None = None) -> dict:
        """研究页轴承会诊。采样率或权重不满足时直接返回，不补启发式残差。"""
        from app.modules.anomaly_detect.research_guard import blocked_consult, research_block_reason

        reason = research_block_reason(window)
        if reason:
            return blocked_consult(device_id, reason)
        return self.graph.run(device_id, window, vision)

    def get_agent_status(self) -> list[dict]:
        """返回各诊断 Agent 的注册状态（含决策 Agent）。"""
        pool = [
            {"role": a.role, "name": a.name, "type": type(a).__name__, "active": True}
            for a in self.graph.agents
        ]
        pool.append(
            {
                "role": self.graph.decision_agent.role,
                "name": self.graph.decision_agent.name,
                "type": type(self.graph.decision_agent).__name__,
                "active": True,
            }
        )
        return pool


multi_agent_service = MultiAgentService()
