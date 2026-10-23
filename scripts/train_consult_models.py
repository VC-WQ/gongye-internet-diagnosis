"""训练会诊用的两个模型，并记下留出数据上的测试指标。

泵：除 anomaly-free.csv 与 other/13.csv 以外的 SKAB 试验。
电机：除 Bearing1_1、Bearing2_1 以外的 XJTU-SY 轴承。
推断代码不读 anomaly、hi、rul。这两个列只在本脚本里作为监督标签。
"""
from __future__ import annotations

import csv
import json
import sys
from pathlib import Path

import joblib
import numpy as np
from sklearn.ensemble import GradientBoostingClassifier, GradientBoostingRegressor
from sklearn.metrics import mean_absolute_error, precision_recall_fscore_support

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.modules.consult_models import (  # noqa: E402
    METRICS_PATH,
    SKAB_MODEL,
    WINDOW,
    XJTU_MODEL,
    motor_feature_row,
    pump_feature_row,
)

SKAB = ROOT / "datasets" / "public" / "skab-repo" / "data"
XJTU = ROOT / "backend" / "app" / "data" / "xjtu_rul.json"
HOLDOUT_FILES = {"anomaly-free/anomaly-free.csv", "other/13.csv"}
HOLDOUT_BEARINGS = {"Bearing1_1", "Bearing2_1"}


def _float(value: object) -> float | None:
    try:
        number = float(str(value).strip())
    except (TypeError, ValueError):
        return None
    if number != number:
        return None
    return number


def _rows(path: Path) -> list[dict[str, str]]:
    with path.open(encoding="utf-8", newline="") as handle:
        sample = handle.read(4096)
        handle.seek(0)
        delimiter = ";" if sample.count(";") > sample.count(",") else ","
        return list(csv.DictReader(handle, delimiter=delimiter))


def _pump_windows(path: Path, relative: str) -> tuple[list[np.ndarray], list[int]]:
    features: list[np.ndarray] = []
    labels: list[int] = []
    points: list[dict] = []
    targets: list[int] = []
    missing_label = relative == "anomaly-free/anomaly-free.csv"
    for row in _rows(path):
        point = {
            "vibration": _float(row.get("Accelerometer1RMS")),
            "current": _float(row.get("Current")),
            "pressure": _float(row.get("Pressure")),
            "temperature": _float(row.get("Temperature")),
            "speed": _float(row.get("Volume Flow RateRMS") or row.get("RateRMS")),
        }
        if any(value is None for value in point.values()):
            continue
        anomaly = _float(row.get("anomaly"))
        if anomaly is None and not missing_label:
            continue
        points.append(point)
        targets.append(0 if anomaly is None else int(anomaly >= 1))
    for end in range(WINDOW - 1, len(points), 5):
        feature = pump_feature_row(points[end - WINDOW + 1 : end + 1])
        if feature is None:
            continue
        features.append(feature)
        labels.append(targets[end])
    return features, labels


def train_pump() -> dict:
    files = sorted(SKAB.rglob("*.csv"))
    if not files:
        raise SystemExit(f"没有找到 SKAB csv：{SKAB}")
    present = {path.relative_to(SKAB).as_posix() for path in files}
    missing = HOLDOUT_FILES - present
    if missing:
        raise SystemExit(f"留出文件不在磁盘上：{sorted(missing)}")
    train_x: list[np.ndarray] = []
    train_y: list[int] = []
    test_x: list[np.ndarray] = []
    test_y: list[int] = []
    train_files: list[str] = []
    for path in files:
        relative = path.relative_to(SKAB).as_posix()
        features, labels = _pump_windows(path, relative)
        if not features:
            continue
        if relative in HOLDOUT_FILES:
            test_x.extend(features)
            test_y.extend(labels)
        else:
            train_files.append(relative)
            train_x.extend(features)
            train_y.extend(labels)
    if not train_x or not test_x:
        raise SystemExit("泵的训练集或留出集为空")
    y = np.asarray(train_y, dtype=int)
    counts = np.bincount(y, minlength=2).astype(float)
    weights = np.array([1.0 / counts[label] for label in y])
    model = GradientBoostingClassifier(
        n_estimators=150,
        max_depth=3,
        learning_rate=0.08,
        subsample=0.8,
        random_state=0,
    )
    model.fit(np.vstack(train_x), y, sample_weight=weights)
    pred = model.predict(np.vstack(test_x))
    precision, recall, f1, _ = precision_recall_fscore_support(
        np.asarray(test_y), pred, average="binary", pos_label=1, zero_division=0
    )
    SKAB_MODEL.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "task": "skab_anomaly"}, SKAB_MODEL)
    return {
        "model_name": "SKAB 工况异常分类",
        "model_file": "models/skab_anomaly.joblib",
        "task": "工况异常分类",
        "algorithm": "梯度提升树",
        "train_range": "除 anomaly-free/anomaly-free.csv 与 other/13.csv 以外的 SKAB 试验",
        "train_files": train_files,
        "holdout": "anomaly-free/anomaly-free.csv、other/13.csv",
        "holdout_files": sorted(HOLDOUT_FILES),
        "window": "最近 30 秒，步长 5 秒做训练和留出计分；会诊使用最近一个 30 秒窗口",
        "score_formula": "100 × 正常概率",
        "score_label": "正常概率换算",
        "test_metric": {
            "name": "留出试验异常类精确率、召回率、F1",
            "precision": round(float(precision), 4),
            "recall": round(float(recall), 4),
            "f1": round(float(f1), 4),
            "positive_class": "anomaly",
            "windows": int(len(test_y)),
        },
    }


def train_motor() -> dict:
    payload = json.loads(XJTU.read_text(encoding="utf-8"))
    bearings = payload.get("bearings") or []
    ids = {item.get("id") for item in bearings}
    missing = HOLDOUT_BEARINGS - ids
    if missing:
        raise SystemExit(f"留出轴承不在文件中：{sorted(missing)}")
    train_x: list[np.ndarray] = []
    train_y: list[float] = []
    per_bearing: dict[str, list[tuple[float, np.ndarray]]] = {name: [] for name in HOLDOUT_BEARINGS}
    train_ids: list[str] = []
    for bearing in bearings:
        name = str(bearing.get("id"))
        series = bearing.get("series") or []
        points = []
        labels = []
        for row in series:
            rms = row.get("rms")
            rul = row.get("rul")
            if not isinstance(rms, (int, float)) or not isinstance(rul, (int, float)):
                continue
            points.append({"vibration": float(rms)})
            labels.append(float(rul))
        if name not in HOLDOUT_BEARINGS:
            train_ids.append(name)
        for end in range(WINDOW - 1, len(points)):
            feature = motor_feature_row(points[: end + 1])
            if feature is None:
                continue
            if name in HOLDOUT_BEARINGS:
                per_bearing[name].append((labels[end], feature))
            else:
                train_x.append(feature)
                train_y.append(labels[end])
    if not train_x or any(not per_bearing[name] for name in HOLDOUT_BEARINGS):
        raise SystemExit("电机的训练集或留出集为空")
    model = GradientBoostingRegressor(
        n_estimators=150,
        max_depth=3,
        learning_rate=0.08,
        subsample=0.8,
        random_state=0,
    )
    model.fit(np.vstack(train_x), np.asarray(train_y, dtype=float))
    per_metric: dict[str, float] = {}
    true_parts: list[np.ndarray] = []
    pred_parts: list[np.ndarray] = []
    windows = 0
    for name in ("Bearing1_1", "Bearing2_1"):
        actual = np.asarray([item[0] for item in per_bearing[name]], dtype=float)
        pred = model.predict(np.vstack([item[1] for item in per_bearing[name]]))
        per_metric[name] = round(float(mean_absolute_error(actual, pred)), 4)
        true_parts.append(actual)
        pred_parts.append(pred)
        windows += int(actual.size)
    mae = float(mean_absolute_error(np.concatenate(true_parts), np.concatenate(pred_parts)))
    XJTU_MODEL.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump({"model": model, "task": "xjtu_rul"}, XJTU_MODEL)
    return {
        "model_name": "XJTU-SY 剩余寿命预测",
        "model_file": "models/xjtu_rul.joblib",
        "task": "剩余寿命预测",
        "algorithm": "梯度提升树",
        "label_note": "训练标签是失效后回推的剩余寿命比例，显示值是模型预测",
        "train_range": "除 Bearing1_1、Bearing2_1 以外的 13 根 XJTU-SY 轴承",
        "train_bearings": train_ids,
        "holdout": "Bearing1_1、Bearing2_1",
        "holdout_bearings": ["Bearing1_1", "Bearing2_1"],
        "window": "当前时刻之前的 30 个振动 RMS，不使用该时刻之后的采样，也不使用 hi",
        "score_formula": "100 × 预测剩余寿命比例",
        "score_label": "预测剩余寿命比例",
        "event_state_rule": "预测值不低于 0.6 为正常，0.3 至 0.6 为预警，低于 0.3 为告警",
        "test_metric": {
            "name": "两根留出轴承的平均绝对误差",
            "mae": round(mae, 4),
            "per_bearing": per_metric,
            "windows": windows,
        },
    }


def main() -> None:
    skab = train_pump()
    xjtu = train_motor()
    METRICS_PATH.write_text(
        json.dumps({"skab": skab, "xjtu": xjtu}, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    print(json.dumps({"skab": skab["test_metric"], "xjtu": xjtu["test_metric"]}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
