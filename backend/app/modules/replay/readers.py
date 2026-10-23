"""把公开数据集的一行转换成系统采样。不补造缺失通道，也不写入标签分数。"""
from __future__ import annotations

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional


def _float(value: Any) -> Optional[float]:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _epoch(text: str) -> Optional[float]:
    text = text.strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M:%S.%f"):
        try:
            parsed = datetime.strptime(text, fmt).replace(tzinfo=timezone.utc)
            return parsed.timestamp()
        except ValueError:
            continue
    return None


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(encoding="utf-8", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        delimiter = ";" if sample.count(";") > sample.count(",") else ","
        return list(csv.DictReader(handle, delimiter=delimiter))


def skab_points(rows: list[dict[str, str]], note: str) -> list[dict[str, Any]]:
    """SKAB 试验台采样。anomaly 列不进入回放。"""
    points: list[dict[str, Any]] = []
    for row in rows:
        original = _epoch(row.get("datetime", ""))
        if original is None:
            continue
        points.append(
            {
                "source": "public_replay",
                "dataset": "SKAB",
                "sample_note": note,
                "original_timestamp": original,
                "vibration": _float(row.get("Accelerometer1RMS")),
                "current": _float(row.get("Current")),
                "pressure": _float(row.get("Pressure")),
                "temperature": _float(row.get("Temperature")),
                "speed": _float(row.get("Volume Flow RateRMS") or row.get("RateRMS")),
            }
        )
    return points


def xjtu_points(path: Path, bearing_id: str) -> list[dict[str, Any]]:
    """XJTU-SY 振动 RMS。不读取 hi 和 rul。"""
    if not path.exists():
        return []
    payload = json.loads(path.read_text(encoding="utf-8"))
    bearing = next((item for item in payload.get("bearings", []) if item.get("id") == bearing_id), None)
    if bearing is None:
        return []
    origin = datetime(2018, 1, 1, tzinfo=timezone.utc).timestamp()
    points: list[dict[str, Any]] = []
    for row in bearing.get("series") or []:
        minute = _float(row.get("t"))
        vibration = _float(row.get("rms"))
        if minute is None or vibration is None:
            continue
        points.append(
            {
                "source": "public_replay",
                "dataset": "XJTU-SY",
                "sample_note": f"{bearing_id} {bearing.get('condition') or ''}".strip(),
                "original_timestamp": origin + minute * 60.0,
                "vibration": vibration,
            }
        )
    return points


def metropt_points(rows: list[dict[str, str]], note: str) -> list[dict[str, Any]]:
    """MetroPT-3 现场空压机。没有逐点标签，也不生成健康分。"""
    points: list[dict[str, Any]] = []
    for row in rows:
        original = _epoch(str(row.get("timestamp") or row.get("datetime") or ""))
        if original is None:
            continue
        lowered = {key.lower(): value for key, value in row.items()}
        points.append(
            {
                "source": "public_replay",
                "dataset": "MetroPT-3",
                "sample_note": note,
                "original_timestamp": original,
                "temperature": _float(lowered.get("oil_temperature")),
                "current": _float(lowered.get("motor_current")),
                "pressure": _float(lowered.get("tp2") or lowered.get("reservoirs")),
            }
        )
    return points
