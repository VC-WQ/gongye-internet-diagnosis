"""物理数字孪生模块：基于设备主数据与最新诊断事件提供孪生快照与推演。

数据来源说明：
- 快照全部来自数据库（devices / events），不使用前端或后端临时假数据。
- 推演为「基于当前健康分的线性退化外推」，属于模型推演结果，明确标注
  method 与 disclaimer，不冒充实测数据。
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy.orm import Session

from app.models import Device, Event


class DigitalTwinService:
    """物理数字孪生服务：设备状态镜像 + 假设推演。"""

    def get_snapshot(self, db: Session, device_id: str) -> dict:
        """获取设备孪生体当前快照（读数据库）。"""
        device = db.get(Device, device_id)
        if device is None:
            return {"device_id": device_id, "available": False, "reason": "设备不存在"}

        event = (
            db.query(Event)
            .filter(Event.device_id == device_id)
            .order_by(Event.timestamp.desc(), Event.id.desc())
            .first()
        )
        sensor = event.sensor_data if event and isinstance(event.sensor_data, list) else []
        last = sensor[-1] if sensor else {}
        diag = (event.agent_diagnosis or {}) if event else {}

        return {
            "device_id": device.id,
            "available": True,
            "name": device.name,
            "device_type": device.device_type,
            "status": device.status,
            "health_score": device.health_score,
            "edge_anomaly_score": device.edge_anomaly_score,
            "state": {
                "wear_index": round(1.0 - float(device.health_score or 0.0) / 100.0, 4),
                "vibration": last.get("vibration"),
                "temperature": last.get("temperature"),
                "current": last.get("current"),
                "pressure": last.get("pressure"),
                "speed": last.get("speed"),
                "fault_type": diag.get("fault_type"),
                "last_event_id": event.id if event else None,
                "last_event_time": event.timestamp.isoformat() if event else None,
            },
            "source": "database",
            "updated_at": datetime.utcnow().isoformat(),
        }

    def simulate(self, db: Session, device_id: str, scenario: dict) -> dict:
        """基于当前健康分做线性退化推演（what-if）。

        scenario 支持：
            days: 推演天数，默认 7
            degradation_rate_per_day: 每天健康分下降比例，默认 0.01（1%）
        """
        snapshot = self.get_snapshot(db, device_id)
        if not snapshot.get("available"):
            return snapshot

        days = float(scenario.get("days", 7))
        rate = float(scenario.get("degradation_rate_per_day", 0.01))
        current = float(snapshot["health_score"])
        projected = max(0.0, current * (1.0 - rate * days))

        return {
            "device_id": device_id,
            "available": True,
            "current_health": current,
            "projected_health": round(projected, 2),
            "days": days,
            "degradation_rate_per_day": rate,
            "method": "linear_degradation_projection",
            "disclaimer": "推演结果，非实测数据；仅用于维护计划排期参考。",
        }


digital_twin_service = DigitalTwinService()
