# -*- coding: utf-8 -*-
"""工业蒸汽量预测 — sklearn 多模型回归对比（算法实验室版）。

与 analyze_steam.py（纯 numpy 版，服务 Dashboard 大屏）互补，本脚本用 sklearn
标准链路做更严谨的多模型对比：线性回归 / 岭回归 / 随机森林 / 梯度提升 / XGBoost，
并输出树模型特征重要性（区别于 Pearson 相关系数）。

输出 backend/app/data/steam_ml.json。

用法：
  python scripts/ml_steam.py
"""
from __future__ import annotations

import json
import os

import numpy as np

try:  # xgboost 可选
    import xgboost as xgb
    HAS_XGB = True
except Exception:  # noqa: BLE001
    xgb = None
    HAS_XGB = False

from sklearn.ensemble import GradientBoostingRegressor, RandomForestRegressor
from sklearn.linear_model import LinearRegression, Ridge
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
from sklearn.model_selection import train_test_split
from sklearn.preprocessing import StandardScaler

DATA_DIR = r"d:\企业云系统\工业互联网系统\datasets\工业蒸汽量预测"
OUT_DIR = r"d:\企业云系统\工业互联网系统\backend\app\data"
OUT_FILE = os.path.join(OUT_DIR, "steam_ml.json")


def load_txt(path: str) -> tuple[np.ndarray, np.ndarray]:
    data = np.loadtxt(path, delimiter="\t", skiprows=1)
    return data[:, :-1], data[:, -1]


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    mse = float(mean_squared_error(y_true, y_pred))
    return {
        "mse": round(mse, 4),
        "rmse": round(float(mse ** 0.5), 4),
        "mae": round(float(mean_absolute_error(y_true, y_pred)), 4),
        "r2": round(float(r2_score(y_true, y_pred)), 4),
    }


def main() -> None:
    X, y = load_txt(os.path.join(DATA_DIR, "zhengqi_train.txt"))
    n_feat = X.shape[1]
    print(f"[数据] 样本 {len(X)}, 特征 {n_feat} 维")

    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, random_state=42)
    scaler = StandardScaler()
    Xtr_s = scaler.fit_transform(Xtr)
    Xte_s = scaler.transform(Xte)

    models: list[tuple[str, object]] = [
        ("线性回归", LinearRegression()),
        ("岭回归", Ridge(alpha=1.0)),
        ("随机森林", RandomForestRegressor(n_estimators=300, random_state=42)),
        ("梯度提升", GradientBoostingRegressor(n_estimators=300, random_state=42)),
    ]
    if HAS_XGB:
        models.append((
            "XGBoost",
            xgb.XGBRegressor(n_estimators=300, max_depth=6, learning_rate=0.1, random_state=42),
        ))

    methods = []
    for mname, model in models:
        model.fit(Xtr_s, ytr)
        pred = model.predict(Xte_s)
        methods.append({
            "name": mname,
            "pred": np.round(pred, 3).tolist(),
            **metrics(yte, pred),
        })
        print(f"  {mname}: R2={methods[-1]['r2']}, RMSE={methods[-1]['rmse']}")

    # 树模型特征重要性（随机森林）
    rf = RandomForestRegressor(n_estimators=300, random_state=42).fit(Xtr_s, ytr)
    imp = rf.feature_importances_
    names = [f"V{i}" for i in range(n_feat)]
    importance = [
        {"feature": names[i], "importance": round(float(imp[i]), 4)}
        for i in np.argsort(imp)[::-1]
    ]

    result = {
        "target_true": np.round(yte, 3).tolist(),
        "methods": methods,
        "feature_importance": importance,
        "xgboost_available": HAS_XGB,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)
    print(f"\n[输出] {OUT_FILE} ({os.path.getsize(OUT_FILE)/1024:.1f} KB)")


if __name__ == "__main__":
    main()