# -*- coding: utf-8 -*-
"""工业蒸汽量预测数据集 — 相关性分析与多方法回归对比。

纯 numpy 实现。对 38 维特征 V0~V37 预测目标 target：
  1. 计算特征间相关系数矩阵（供前端热力图）
  2. 计算各特征与 target 的 Pearson 相关系数并排序（特征重要性近似）
  3. 三种方法的回归预测对比：
       - 线性回归（最小二乘）
       - 岭回归（L2 正则）
       - 多项式回归（2 阶，仅用 top-k 特征）
     输出各方法在测试集上的预测值与误差（MSE / R2 / MAE）

输出 JSON 供前端 ECharts 绘制相关性热力图 / 特征重要性柱状图 / 三方法预测对比。

用法：
  python scripts/analyze_steam.py
"""
from __future__ import annotations

import json
import os
import urllib.request

import numpy as np

# 数据（天池比赛，train/test 为 txt，以空白分隔，无表头）
TRAIN_URL_TEMPLATE = ""  # 已本地化的数据不再远程下载
DATA_DIR = r"d:\企业云系统\工业互联网系统\datasets\工业蒸汽量预测"
OUT_DIR = r"d:\企业云系统\工业互联网系统\backend\app\data"
OUT_FILE = os.path.join(OUT_DIR, "steam_analysis.json")


def load_txt(path: str) -> tuple[np.ndarray, np.ndarray]:
    """读取 txt 数据集：前 38 列为特征 V0~V37，最后一列为 target。"""
    data = np.loadtxt(path, delimiter="\t", skiprows=1)
    X, y = data[:, :-1], data[:, -1]
    return X, y


def pearson_r(X: np.ndarray, y: np.ndarray) -> np.ndarray:
    """计算每个特征与目标的 Pearson 相关系数。"""
    xc = X - X.mean(axis=0)
    yc = y - y.mean()
    cov = xc.T @ yc
    denom = np.sqrt((xc ** 2).sum(axis=0) * (yc ** 2).sum())
    return cov / np.where(denom == 0, 1e-12, denom)


def corr_matrix(X: np.ndarray) -> np.ndarray:
    """特征间相关系数矩阵。"""
    xc = X - X.mean(axis=0)
    std = np.sqrt((xc ** 2).sum(axis=0))
    return (xc.T @ xc) / np.outer(std, std).clip(min=1e-12)


def fit_linear(X: np.ndarray, y: np.ndarray, reg: float = 0.0) -> np.ndarray:
    """最小二乘 / 岭回归（reg=0 即普通线性回归）。"""
    d = X.shape[1]
    A = X.T @ X + reg * np.eye(d)
    b = X.T @ y
    w = np.linalg.solve(A, b)
    return w


def metrics(y_true: np.ndarray, y_pred: np.ndarray) -> dict:
    """MSE / RMSE / MAE / R2。"""
    err = y_true - y_pred
    mse = float((err ** 2).mean())
    rmse = float(np.sqrt(mse))
    mae = float(np.abs(err).mean())
    ss_res = float((err ** 2).sum())
    ss_tot = float(((y_true - y_true.mean()) ** 2).sum())
    r2 = 1 - ss_res / ss_tot if ss_tot > 0 else 0.0
    return {"mse": round(mse, 4), "rmse": round(rmse, 4), "mae": round(mae, 4), "r2": round(r2, 4)}


def train_test_split(X: np.ndarray, y: np.ndarray, ratio: float = 0.8, seed: int = 42):
    """按比例切分训练 / 测试集（随机打乱）。"""
    rng = np.random.default_rng(seed)
    idx = rng.permutation(len(X))
    n = int(len(X) * ratio)
    return X[idx[:n]], X[idx[n:]], y[idx[:n]], y[idx[n:]]


def main() -> None:
    train_path = os.path.join(DATA_DIR, "zhengqi_train.txt")
    X, y = load_txt(train_path)
    n_feat = X.shape[1]
    print(f"[数据] 样本 {len(X)} 行, 特征 {n_feat} 维, target 范围 [{y.min():.2f}, {y.max():.2f}]")

    # 1) 相关性矩阵
    C = corr_matrix(X)
    feature_names = [f"V{i}" for i in range(n_feat)]
    corr = {
        "names": feature_names,
        "matrix": np.round(C, 4).tolist(),
    }

    # 2) 特征与 target 的相关性（特征重要性近似）
    r = pearson_r(X, y)
    importance = [
        {"feature": feature_names[i], "importance": round(float(abs(r[i])), 4), "corr": round(float(r[i]), 4)}
        for i in range(n_feat)
    ]
    importance.sort(key=lambda e: e["importance"], reverse=True)

    # 3) 训练 / 测试切分（标准化到零均值单位方差，便于三种方法公平对比）
    Xtr, Xte, ytr, yte = train_test_split(X, y)
    mu, std = Xtr.mean(axis=0), Xtr.std(axis=0).clip(min=1e-9)
    Xtr_s, Xte_s = (Xtr - mu) / std, (Xte - mu) / std

    methods = []
    # 线性回归
    w = fit_linear(Xtr_s, ytr)
    pred_lin = Xte_s @ w
    methods.append({"name": "线性回归", "pred": pred_lin.tolist()})

    # 岭回归
    w_ridge = fit_linear(Xtr_s, ytr, reg=1.0)
    pred_ridge = Xte_s @ w_ridge
    methods.append({"name": "岭回归", "pred": pred_ridge.tolist()})

    # 多项式回归（2 阶，仅用 top-8 特征，控制规模）
    top_idx = [i for i in range(n_feat) if r[i] in sorted(np.abs(r), reverse=True)[:8]]
    Xp_tr = np.hstack([Xtr_s[:, top_idx], Xtr_s[:, top_idx] ** 2])
    Xp_te = np.hstack([Xte_s[:, top_idx], Xte_s[:, top_idx] ** 2])
    w_poly = fit_linear(Xp_tr, ytr)
    pred_poly = Xp_te @ w_poly
    methods.append({"name": "多项式回归", "pred": pred_poly.tolist()})

    result = {
        "target_true": np.round(yte, 3).tolist(),
        "methods": [
            {**m, "metrics": metrics(yte, np.asarray(m["pred"]))}
            for m in methods
        ],
        "correlation": corr,
        "importance": importance,
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print("\n[方法对比]")
    for m in result["methods"]:
        print(f"  {m['name']}: MSE={m['metrics']['mse']}, RMSE={m['metrics']['rmse']}, R2={m['metrics']['r2']}")
    print(f"\n[输出] {OUT_FILE} ({os.path.getsize(OUT_FILE)/1024:.1f} KB)")


if __name__ == "__main__":
    main()