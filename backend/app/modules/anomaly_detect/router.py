"""异常检测模块路由。"""
from fastapi import APIRouter

from .service import anomaly_detect_service

router = APIRouter(prefix="/anomaly-detect", tags=["异常检测"])


@router.post("/{device_id}/detect")
def detect(device_id: str, window: list[dict]) -> dict:
    """对设备时间窗口数据进行 PINN + 1D-CNN 异常检测。"""
    return anomaly_detect_service.detect(device_id, window)


@router.post("/{device_id}/residual")
def residual(device_id: str, sample: dict) -> dict:
    """计算单条样本的物理残差（PINN 约束）。"""
    return anomaly_detect_service.physical_residual(sample)