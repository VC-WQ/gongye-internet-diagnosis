"""把采样写入 SQLite，并按设备读回最近窗口。"""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import inspect, text

from app.models import Base, Device, SensorReading, SessionLocal, engine

logger = logging.getLogger(__name__)

KEEP_PER_DEVICE = 2000
_writes = 0
MODEL_BASES = {"skab_probability", "xjtu_rul"}


def ensure_runtime_columns() -> None:
    """已有库不会自动加列。缺列时补上，不影响新建表。"""
    Base.metadata.create_all(bind=engine)
    inspector = inspect(engine)
    if not inspector.has_table("devices"):
        return
    present = {column["name"] for column in inspector.get_columns("devices")}
    statements = []
    if "run_mode" not in present:
        statements.append("ALTER TABLE devices ADD COLUMN run_mode VARCHAR(32) DEFAULT 'public_replay'")
    if "dataset_name" not in present:
        statements.append("ALTER TABLE devices ADD COLUMN dataset_name VARCHAR(64)")
    if "health_basis" not in present:
        statements.append("ALTER TABLE devices ADD COLUMN health_basis VARCHAR(32)")
    if "health_observed" not in present:
        statements.append("ALTER TABLE devices ADD COLUMN health_observed BOOLEAN DEFAULT 0")
    if "last_seen" not in present:
        statements.append("ALTER TABLE devices ADD COLUMN last_seen DATETIME")
    if not statements:
        return
    with engine.begin() as conn:
        for statement in statements:
            conn.execute(text(statement))


def device_mode(device_id: str) -> str:
    """未单独切换时，设备处于公开数据回放。"""
    db = SessionLocal()
    try:
        device = db.get(Device, device_id)
        if device is None or not device.run_mode:
            return "public_replay"
        return str(device.run_mode)
    finally:
        db.close()


def set_device_mode(device_id: str, run_mode: str) -> dict:
    """切换回放或仿真。进入仿真时清掉上一段回放评分，避免串用。"""
    if run_mode not in ("public_replay", "simulation"):
        raise ValueError("run_mode 只能是 public_replay 或 simulation")
    db = SessionLocal()
    try:
        device = db.get(Device, device_id)
        if device is None:
            raise KeyError(device_id)
        device.run_mode = run_mode
        if run_mode == "simulation":
            device.health_observed = False
            device.health_score = None
            device.health_basis = None
            device.dataset_name = None
            device.status = "offline"
            device.edge_anomaly_score = 0.0
        db.commit()
        return {"id": device.id, "run_mode": device.run_mode}
    finally:
        db.close()


def _number(value: Any) -> Optional[float]:
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    number = float(value)
    if number != number or number in (float("inf"), float("-inf")):
        return None
    return number


def save_point(point: dict[str, Any]) -> None:
    """写入一条采样。采样本身不带健康分；已有模型分数不被新采样冲掉。"""
    global _writes
    device_id = str(point.get("device_id") or "")
    timestamp = _number(point.get("timestamp"))
    if not device_id or timestamp is None:
        return
    source = point.get("source") if point.get("source") in ("public_replay", "simulation") else "unknown"
    db = SessionLocal()
    try:
        db.add(
            SensorReading(
                device_id=device_id,
                timestamp=timestamp,
                original_timestamp=_number(point.get("original_timestamp")),
                vibration=_number(point.get("vibration")),
                temperature=_number(point.get("temperature")),
                current=_number(point.get("current")),
                pressure=_number(point.get("pressure")),
                speed=_number(point.get("speed")),
                acoustic=_number(point.get("acoustic")),
                source=source,
                dataset=point.get("dataset") if isinstance(point.get("dataset"), str) else None,
                sample_note=point.get("sample_note") if isinstance(point.get("sample_note"), str) else None,
                health_score=None,
                health_basis=None,
                fault_label=None,
                edge_anomaly_score=None,
            )
        )
        device = db.get(Device, device_id)
        if device is not None:
            device.last_seen = datetime.fromtimestamp(timestamp, timezone.utc).replace(tzinfo=None)
            device.health_observed = True
            if isinstance(point.get("dataset"), str):
                device.dataset_name = point["dataset"]
            if device.health_basis not in MODEL_BASES:
                device.health_score = None
                device.edge_anomaly_score = 0.0
                if source == "simulation":
                    device.health_basis = "simulation"
                    if isinstance(point.get("device_status"), str):
                        device.status = point["device_status"]
                else:
                    device.health_basis = None
                    device.status = "unknown"
        _writes += 1
        if _writes % 60 == 0:
            _prune(db, device_id)
        db.commit()
    except Exception as exc:  # pragma: no cover - 采集线程不能把服务打崩
        db.rollback()
        logger.warning("采样入库失败：%s", exc)
    finally:
        db.close()


def _prune(db, device_id: str) -> None:
    cutoff = (
        db.query(SensorReading.id)
        .filter(SensorReading.device_id == device_id)
        .order_by(SensorReading.id.desc())
        .offset(KEEP_PER_DEVICE)
        .limit(1)
        .scalar()
    )
    if cutoff is None:
        return
    (
        db.query(SensorReading)
        .filter(SensorReading.device_id == device_id, SensorReading.id <= cutoff)
        .delete(synchronize_session=False)
    )


def load_window(device_id: str, limit: int = 64) -> list[dict[str, Any]]:
    """按时间升序返回最近采样。库中没有记录时返回空列表。"""
    db = SessionLocal()
    try:
        rows = (
            db.query(SensorReading)
            .filter(SensorReading.device_id == device_id)
            .order_by(SensorReading.id.desc())
            .limit(max(1, min(limit, 200)))
            .all()
        )
        rows.reverse()
        return [_row_dict(row) for row in rows]
    except Exception as exc:  # pragma: no cover
        logger.warning("读取采样窗口失败：%s", exc)
        return []
    finally:
        db.close()


def _row_dict(row: SensorReading) -> dict[str, Any]:
    return {
        "device_id": row.device_id,
        "timestamp": row.timestamp,
        "original_timestamp": row.original_timestamp,
        "vibration": row.vibration,
        "temperature": row.temperature,
        "current": row.current,
        "pressure": row.pressure,
        "speed": row.speed,
        "acoustic": row.acoustic,
        "source": row.source,
        "dataset": row.dataset,
        "sample_note": row.sample_note,
        "health_score": row.health_score,
        "health_basis": row.health_basis,
        "fault_label": row.fault_label,
        "edge_anomaly_score": row.edge_anomaly_score,
    }
