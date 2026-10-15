# -*- coding: utf-8 -*-
"""表格数据二元分类：机器故障预测 + 工业制造缺陷预测。

使用 sklearn 标准机器学习链路（LogisticRegression 基线 → 随机森林 →
梯度提升 → XGBoost 若可用），输出：
  - 各模型指标对比（准确率 / 精确率 / 召回率 / F1 / AUC）
  - 最优模型混淆矩阵
  - ROC 曲线点（供前端绘制）
  - 特征重要性（树模型 feature_importances_）

统一输出 JSON 到 backend/app/data/ml_classification.json，
供前端「算法实验室」页展示。

用法：
  python scripts/ml_classification.py
"""
from __future__ import annotations

import json
import os

import numpy as np

try:  # xgboost 为可选依赖，缺失时自动退化到 sklearn 梯度提升
    import xgboost as xgb
    HAS_XGB = True
except Exception:  # noqa: BLE001
    xgb = None
    HAS_XGB = False

from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score,
    confusion_matrix,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
    roc_curve,
)
from sklearn.model_selection import train_test_split

OUT_DIR = r"d:\企业云系统\工业互联网系统\backend\app\data"
OUT_FILE = os.path.join(OUT_DIR, "ml_classification.json")

# 每个数据集：(名称, 路径, 目标列名, 中文特征名映射函数)
DATASETS = [
    {
        "name": "机器故障预测",
        "path": r"d:\企业云系统\工业互联网系统\datasets\机器故障数据集\data.csv",
        "target": "fail",
        "features": ["footfall", "tempMode", "AQ", "USS", "CS", "VOC", "RP", "IP", "Temperature"],
    },
    {
        "name": "工业制造缺陷预测",
        "path": r"d:\企业云系统\工业互联网系统\datasets\工业制造缺陷预测数据集\manufacturing_defect_dataset.csv",
        "target": "DefectStatus",
        "features": [
            "ProductionVolume", "ProductionCost", "SupplierQuality", "DeliveryDelay",
            "DefectRate", "QualityScore", "MaintenanceHours", "DowntimePercentage",
            "InventoryTurnover", "StockoutRate", "WorkerProductivity", "SafetyIncidents",
            "EnergyConsumption", "EnergyEfficiency", "AdditiveProcessTime", "AdditiveMaterialCost",
        ],
    },
]


def load_csv(path: str, features: list[str], target: str) -> tuple[np.ndarray, np.ndarray]:
    """读取 CSV：特征列为 features，目标为 target。"""
    data = np.loadtxt(path, delimiter=",", skiprows=1)
    # 列顺序与文件表头一致，构造列名 -> 下标映射
    with open(path, "r", encoding="utf-8") as f:
        header = f.readline().strip().split(",")
    idx = {name: i for i, name in enumerate(header)}
    X = data[:, [idx[f] for f in features]]
    y = data[:, idx[target]].astype(int)
    return X, y


def build_models() -> list[tuple[str, object]]:
    """构建候选模型列表（名称, 模型实例）。"""
    models: list[tuple[str, object]] = [
        ("逻辑回归", LogisticRegression(max_iter=2000)),
        ("随机森林", RandomForestClassifier(n_estimators=300, random_state=42)),
        ("梯度提升", GradientBoostingClassifier(n_estimators=300, random_state=42)),
    ]
    if HAS_XGB:
        models.append((
            "XGBoost",
            xgb.XGBClassifier(n_estimators=300, max_depth=6, learning_rate=0.1,
                              eval_metric="logloss", random_state=42),
        ))
    return models


def evaluate(name: str, features: list[str], target: str, path: str) -> dict:
    """对一个数据集执行完整分类评估。"""
    X, y = load_csv(path, features, target)
    n_pos = int(y.sum())
    print(f"[{name}] 样本 {len(X)}, 正样本 {n_pos} ({n_pos/len(y):.1%}), 特征 {X.shape[1]} 维")

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.25, random_state=42,
                                          stratify=y)

    model_rows = []
    best = None  # (auc, 模型, Xte, yte, 名称)
    for mname, model in build_models():
        model.fit(Xtr, ytr)
        pred = model.predict(Xte)
        proba = model.predict_proba(Xte)[:, 1]
        auc = roc_auc_score(yte, proba)
        row = {
            "name": mname,
            "accuracy": round(float(accuracy_score(yte, pred)), 4),
            "precision": round(float(precision_score(yte, pred, zero_division=0)), 4),
            "recall": round(float(recall_score(yte, pred, zero_division=0)), 4),
            "f1": round(float(f1_score(yte, pred, zero_division=0)), 4),
            "auc": round(float(auc), 4),
        }
        model_rows.append(row)
        print(f"    {mname}: acc={row['accuracy']}, f1={row['f1']}, auc={row['auc']}")
        if best is None or auc > best[0]:
            best = (auc, model, Xte, yte, mname)

    _, best_model, best_Xte, best_yte, best_name = best
    best_proba = best_model.predict_proba(best_Xte)[:, 1]
    best_pred = best_model.predict(best_Xte)

    # 混淆矩阵（tn, fp / fn, tp）
    cm = confusion_matrix(best_yte, best_pred)
    tn, fp, fn, tp = int(cm[0, 0]), int(cm[0, 1]), int(cm[1, 0]), int(cm[1, 1])

    # ROC 曲线（降采样到 ~60 个点，控制体积）
    fpr, tpr, _ = roc_curve(best_yte, best_proba)
    step = max(1, len(fpr) // 60)
    roc = {"fpr": np.round(fpr[::step], 4).tolist(), "tpr": np.round(tpr[::step], 4).tolist()}

    # 特征重要性（树模型）
    importance: list[dict] = []
    if hasattr(best_model, "feature_importances_"):
        imp = best_model.feature_importances_
        importance = [
            {"feature": features[i], "importance": round(float(imp[i]), 4)}
            for i in np.argsort(imp)[::-1]
        ]

    return {
        "name": name,
        "samples": int(len(X)),
        "features_dim": int(X.shape[1]),
        "positive_rate": round(float(y.mean()), 4),
        "best_model": best_name,
        "models": model_rows,
        "confusion_matrix": {"tn": tn, "fp": fp, "fn": fn, "tp": tp},
        "roc": roc,
        "feature_importance": importance,
    }


def main() -> None:
    results = [evaluate(d["name"], d["features"], d["target"], d["path"]) for d in DATASETS]
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump({"datasets": results, "xgboost_available": HAS_XGB}, f, ensure_ascii=False)
    print(f"\n[输出] {OUT_FILE} ({os.path.getsize(OUT_FILE)/1024:.1f} KB)")
    print(f"[XGBoost] {'可用' if HAS_XGB else '不可用（已退化到 sklearn 梯度提升）'}")


if __name__ == "__main__":
    main()