"""边缘轻量推理模块路由。"""
from fastapi import APIRouter

from .service import EdgeProfile, edge_inference_service

router = APIRouter(prefix="/edge-inference", tags=["边缘推理"])


@router.post("/{device_id}/infer")
def infer(device_id: str, window: list[dict]) -> dict:
    """对设备传感器数据窗口进行轻量推理，返回可疑度评分与主导方向。

    window 每条数据可含：vibration / temperature / current / pressure / speed(或 rpm)。
    """
    return edge_inference_service.infer(device_id, window)


@router.post("/{device_id}/register")
def register_device(device_id: str, profile: dict) -> dict:
    """按设备注册边缘推理基准（实现设备异构性）。"""
    edge_inference_service.register_device(device_id, EdgeProfile(**profile))
    return {"status": "registered", "device_id": device_id}