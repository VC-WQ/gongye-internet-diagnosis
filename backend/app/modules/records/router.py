"""诊断记录管理路由：历史诊断事件的查询 / 详情 / 删除（admin）。

管理对象为诊断事件（Event），含完整的多智能体会诊结果。
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from app.models import Event, User, get_db
from app.modules.auth.deps import require_admin

router = APIRouter(prefix="/records", tags=["诊断记录管理"])


def _event_to_dict(e: Event) -> dict:
    diag = e.agent_diagnosis or {}
    report = diag.get("report") or {}
    return {
        "id": e.id,
        "device_id": e.device_id,
        "event_type": e.event_type,
        "status_state": e.status_state,
        "severity": e.severity,
        "fault_type": diag.get("fault_type"),
        "fault_label": diag.get("fault_label"),
        "confidence": diag.get("confidence"),
        "health_score": diag.get("health_score"),
        "report": report,
        "timestamp": e.timestamp.isoformat() if e.timestamp else None,
    }


@router.get("")
def list_records(
    device_id: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=200),
    db: Session = Depends(get_db),
    _: User = Depends(require_admin),
) -> dict:
    """诊断记录列表（分页），可按设备过滤。"""
    q = db.query(Event).order_by(Event.id.desc())
    if device_id:
        q = q.filter(Event.device_id == device_id)
    total = q.count()
    rows = q.offset(offset).limit(limit).all()
    return {"total": total, "items": [_event_to_dict(e) for e in rows]}


@router.get("/{record_id}")
def get_record(record_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    """诊断记录详情（含各 Agent 结论）。"""
    event = db.get(Event, record_id)
    if event is None:
        raise HTTPException(status_code=404, detail="诊断记录不存在")
    result = _event_to_dict(event)
    result["agent_results"] = (event.agent_diagnosis or {}).get("agent_results") or []
    return result


@router.delete("/{record_id}")
def delete_record(record_id: int, db: Session = Depends(get_db), _: User = Depends(require_admin)) -> dict:
    """删除诊断记录。"""
    event = db.get(Event, record_id)
    if event is None:
        raise HTTPException(status_code=404, detail="诊断记录不存在")
    db.delete(event)
    db.commit()
    return {"deleted": True, "id": record_id}