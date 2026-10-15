"""物理数字孪生模块路由。"""
from fastapi import APIRouter

from .service import digital_twin_service

router = APIRouter(prefix="/digital-twin", tags=["数字孪生"])


@router.get("/{device_id}/snapshot")
def get_snapshot(device_id: str) -> dict:
    """获取设备孪生体快照。"""
    return digital_twin_service.get_snapshot(device_id)


@router.post("/{device_id}/simulate")
def simulate(device_id: str, scenario: dict) -> dict:
    """对设备进行仿真推演。"""
    return digital_twin_service.simulate(device_id, scenario)