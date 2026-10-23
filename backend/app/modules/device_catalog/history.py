"""Bounded history from persisted diagnoses, shared by the UI and Pico.

These are diagnosis scores, never reconstructed telemetry or a synthetic curve.
"""
from __future__ import annotations

import math
from datetime import timezone

from sqlalchemy.orm import Session

from app.models import Event


def observation_source(event: Event) -> str:
    samples = event.sensor_data if isinstance(event.sensor_data, list) else []
    kinds = {row.get("source") for row in samples if isinstance(row, dict) and isinstance(row.get("source"), str)}
    normalized = {"real" if kind == "real" else "simulated" if kind in ("simulation", "simulated") else "offline" if kind in ("history", "offline", "replay") else "unknown" for kind in kinds}
    return next(iter(normalized)) if len(normalized) == 1 else "unknown"


def health_history(db: Session, device_id: str, limit: int = 50) -> list[dict]:
    limit = max(1, min(200, limit))
    # Invalid recent rows must not crowd valid points out of a small requested
    # window. Scan at most 600 persisted records, independently of point limit.
    events = db.query(Event).filter(Event.device_id == device_id).order_by(Event.timestamp.desc(), Event.id.desc()).limit(600).all()
    points = []
    for event in events:
        diagnosis = event.agent_diagnosis if isinstance(event.agent_diagnosis, dict) else {}
        score = diagnosis.get("health_score")
        if isinstance(score, bool) or not isinstance(score, (int, float)) or not 0 <= score <= 100 or not math.isfinite(score) or event.timestamp is None:
            continue
        stamp = event.timestamp.replace(tzinfo=timezone.utc) if event.timestamp.tzinfo is None else event.timestamp.astimezone(timezone.utc)
        points.append({"event_id": event.id, "timestamp": stamp.isoformat(), "health_score": float(score), "source": "command_loop.events", "source_kind": observation_source(event)})
        if len(points) == limit:
            break
    return list(reversed(points))
