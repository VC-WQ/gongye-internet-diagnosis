"""设备目录模块路由：设备列表与详情查询。

前端大屏（Dashboard）与设备详情页（DeviceDetail）依赖本模块：
- GET  /devices          设备列表（6 台，含健康评分 / 边缘自检 / 状态）
- GET  /devices/{id}     单台设备详情
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.models import Device, Event, User, get_db
from app.modules.auth.deps import require_admin
from app.modules.mqtt_pipeline.service import mqtt_pipeline_service

router = APIRouter(prefix="/devices", tags=["设备目录"])


def _device_dict(device: Device) -> dict:
    """将设备实体转换为前端友好的字典，并补充最近数据更新时间。"""
    # 从 MQTT 数据管道读取该设备滑动窗口的最后一条时间戳作为"最后更新"
    last_updated: float | None = None
    window = mqtt_pipeline_service.get_window(device.id)
    if window:
        ts = window[-1].get("timestamp")
        if isinstance(ts, (int, float)):
            last_updated = float(ts)

    return {
        "id": device.id,
        "name": device.name,
        "device_type": device.device_type,
        "status": device.status,
        "health_score": device.health_score,
        "edge_anomaly_score": device.edge_anomaly_score,
        "threshold_vibration": device.threshold_vibration,
        "threshold_temp": device.threshold_temp,
        "last_updated": last_updated,
    }


@router.get("")
def list_devices(db: Session = Depends(get_db)) -> list[dict]:
    """返回全部设备列表（含健康评分与边缘自检状态）。"""
    devices = db.query(Device).order_by(Device.id.asc()).all()
    return [_device_dict(d) for d in devices]


@router.get("/{device_id}")
def get_device(device_id: str, db: Session = Depends(get_db)) -> dict:
    """返回单台设备详情。"""
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"设备 {device_id} 不存在")
    return _device_dict(device)


@router.get("/{device_id}/health-history")
def health_history(device_id: str, limit: int = 50, db: Session = Depends(get_db)) -> list[dict]:
    """返回设备健康评分历史（按时间升序，来自诊断事件）。"""
    events = (
        db.query(Event)
        .filter(Event.device_id == device_id)
        .order_by(Event.timestamp.asc(), Event.id.asc())
        .limit(max(1, min(200, limit)))
        .all()
    )
    result: list[dict] = []
    for ev in events:
        diag = ev.agent_diagnosis or {}
        hs = diag.get("health_score")
        if hs is None:
            continue
        result.append(
            {
                "event_id": ev.id,
                "timestamp": ev.timestamp.isoformat() if ev.timestamp else None,
                "health_score": float(hs),
            }
        )
    return result


class InjectBody(BaseModel):
    """故障注入模式。"""

    mode: str = "degradation"  # normal / degradation / fault


_INJECT_PRESETS = {
    "normal": {"health_score": 95.0, "status": "healthy", "edge_anomaly_score": 0.05},
    "degradation": {"health_score": 70.0, "status": "degraded", "edge_anomaly_score": 0.45},
    "fault": {"health_score": 45.0, "status": "fault", "edge_anomaly_score": 0.80},
}


@router.post("/{device_id}/inject")
def inject_fault(device_id: str, body: InjectBody, db: Session = Depends(get_db)) -> dict:
    """设置设备故障/退化场景（概念演示：直接改设备健康状态）。

    真实产品中故障应由物理数字孪生隐状态涌现驱动；此处为前端演示提供
    可重复、可控的三种模式。
    """
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"设备 {device_id} 不存在")
    preset = _INJECT_PRESETS.get(body.mode)
    if preset is None:
        raise HTTPException(status_code=400, detail=f"未知模式 {body.mode}")
    device.health_score = preset["health_score"]
    device.status = preset["status"]
    device.edge_anomaly_score = preset["edge_anomaly_score"]
    db.commit()
    return _device_dict(device)


class DeviceCreateBody(BaseModel):
    id: str
    name: str
    device_type: str = "pump"
    status: str = "healthy"
    health_score: float = 100.0
    edge_anomaly_score: float = 0.0


class DeviceUpdateBody(BaseModel):
    name: str | None = None
    device_type: str | None = None
    status: str | None = None
    health_score: float | None = None
    threshold_vibration: float | None = None
    threshold_temp: float | None = None


@router.post("")
def create_device(
    body: DeviceCreateBody, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> dict:
    """创建设备（仅管理员）。"""
    if db.get(Device, body.id):
        raise HTTPException(status_code=409, detail=f"设备 {body.id} 已存在")
    device = Device(
        id=body.id,
        name=body.name,
        device_type=body.device_type,
        status=body.status,
        health_score=body.health_score,
        edge_anomaly_score=body.edge_anomaly_score,
    )
    db.add(device)
    db.commit()
    db.refresh(device)
    return _device_dict(device)


@router.put("/{device_id}")
def update_device(
    device_id: str, body: DeviceUpdateBody, db: Session = Depends(get_db), _: User = Depends(require_admin)
) -> dict:
    """更新设备信息（仅管理员）。"""
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"设备 {device_id} 不存在")
    if body.name is not None:
        device.name = body.name
    if body.device_type is not None:
        device.device_type = body.device_type
    if body.status is not None:
        device.status = body.status
    if body.health_score is not None:
        device.health_score = body.health_score
    if body.threshold_vibration is not None:
        device.threshold_vibration = body.threshold_vibration
    if body.threshold_temp is not None:
        device.threshold_temp = body.threshold_temp
    db.commit()
    db.refresh(device)
    return _device_dict(device)


@router.delete("/{device_id}")
def delete_device(device_id: str, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    """删除设备（仅管理员）。"""
    device = db.get(Device, device_id)
    if device is None:
        raise HTTPException(status_code=404, detail=f"设备 {device_id} 不存在")
    db.delete(device)
    db.commit()
    return {"deleted": True, "id": device_id}