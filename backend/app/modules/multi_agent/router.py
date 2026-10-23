"""模块5 多智能体会诊路由。"""
from typing import Optional

from fastapi import APIRouter

from .service import multi_agent_service

router = APIRouter(prefix="/multi-agent", tags=["多智能体会诊"])


@router.post("/consult")
def consult(device_id: str, window: list[dict], vision: Optional[dict] = None) -> dict:
    """研究页轴承会诊。不是工厂设备的智能诊断。

    只有约 12 kHz、不少于 2048 点、且 CNN 与 PINN 权重都存在时才会运行。
    """
    return multi_agent_service.consult_research(device_id, window, vision)


@router.get("/agents")
def agent_status() -> list[dict]:
    """获取各诊断 Agent 的注册状态。"""
    return multi_agent_service.get_agent_status()
