"""模块5 多智能体会诊路由。"""
from typing import Optional

from fastapi import APIRouter

from .service import multi_agent_service

router = APIRouter(prefix="/multi-agent", tags=["多智能体会诊"])


@router.post("/consult")
def consult(device_id: str, window: list[dict], vision: Optional[dict] = None) -> dict:
    """发起多智能体会诊。

    window 为传感器窗口（list[dict]），每条可含 vibration/temperature/
    current/pressure/speed 等字段；当前仅振动（DE）通道有数据。

    vision 为可选的部件表面视觉检测结果（第五路证据）：
        {"available": bool, "damage_type": str|None, "confidence": float, "count": int}
    提供后视觉证据将参与 D-S 融合，并与振动结论做交叉验证（可识别"早期窗口期"）。
    """
    return multi_agent_service.consult(device_id, window, vision)


@router.get("/agents")
def agent_status() -> list[dict]:
    """获取各诊断 Agent 的注册状态。"""
    return multi_agent_service.get_agent_status()