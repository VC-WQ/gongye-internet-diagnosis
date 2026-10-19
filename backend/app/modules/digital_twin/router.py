"""物理数字孪生模块路由。"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.models import get_db

from .service import digital_twin_service

router = APIRouter(prefix="/digital-twin", tags=["数字孪生"])


@router.get("/{device_id}/snapshot")
def get_snapshot(device_id: str, db: Session = Depends(get_db)) -> dict:
    """获取设备孪生体快照（数据来自数据库）。"""
    return digital_twin_service.get_snapshot(db, device_id)


@router.post("/{device_id}/simulate")
def simulate(device_id: str, scenario: dict, db: Session = Depends(get_db)) -> dict:
    """对设备进行退化推演（what-if，结果标注为非实测）。"""
    return digital_twin_service.simulate(db, device_id, scenario)
