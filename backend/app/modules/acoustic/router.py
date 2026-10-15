"""多模态声音融合模块路由。"""
from fastapi import APIRouter

from app.modules.mqtt_pipeline.service import mqtt_pipeline_service

from .service import acoustic_service

router = APIRouter(prefix="/acoustic", tags=["多模态声音融合"])


@router.get("/spectrum/{device_id}")
def spectrum(device_id: str) -> dict:
    """返回模拟声学频谱热力图（概念演示）。"""
    return acoustic_service.spectrum(device_id)


@router.get("/fuse-device/{device_id}")
def fuse_device(device_id: str) -> dict:
    """融合某设备实时窗口内的振动与声学信号，返回跨模态一致性。"""
    window = mqtt_pipeline_service.get_window(device_id)
    return acoustic_service.fuse_device(window)


@router.post("/fuse")
def fuse(vibration_features: list[float], acoustic_features: list[float]) -> dict:
    """振动与声学特征融合。"""
    return acoustic_service.fuse(vibration_features, acoustic_features)