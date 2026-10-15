"""可视化数据接口模块。

读取 scripts/ 预计算得到的数据分析结果 JSON（存放于 backend/app/data/），
以统一前缀 /api/v1/viz 提供给前端 ECharts 直接绘制：

- GET  /viz/xjtu-rul   轴承全寿命健康退化 + 剩余寿命(RUL)
- GET  /viz/steam      蒸汽量：相关性矩阵 / 特征重要性 / 三方法回归对比

另外三个接口服务于"算法创新实验验证"：
- GET  /viz/fp-cnn-compare  创新点一：FP-CNN vs 基线 CNN
- GET  /viz/rul-sde-pf      创新点二：SDE + 粒子滤波 RUL
- GET  /viz/domain-adapt    创新点四：跨域自适应
"""
from __future__ import annotations

import json
import os

from fastapi import APIRouter

router = APIRouter(prefix="/viz", tags=["可视化分析"])

# backend/app 目录（本文件位于 backend/app/modules/viz/，向上三级即 app）
_APP_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
_DATA_DIR = os.path.join(_APP_DIR, "data")


def _load(name: str) -> dict:
    """读取指定 JSON 文件，不存在时返回空结构（避免接口 500）。"""
    path = os.path.join(_DATA_DIR, name)
    if not os.path.exists(path):
        return {}
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (json.JSONDecodeError, OSError):
        return {}


@router.get("/xjtu-rul")
def get_xjtu_rul() -> dict:
    """XJTU-SY 轴承退化曲线与 RUL 数据。"""
    return _load("xjtu_rul.json")


@router.get("/steam")
def get_steam_analysis() -> dict:
    """蒸汽量相关性 / 特征重要性 / 三方法回归对比。"""
    return _load("steam_analysis.json")


@router.get("/classification")
def get_classification() -> dict:
    """表格分类：机器故障 / 制造缺陷（混淆矩阵 / ROC / 特征重要性）。"""
    return _load("ml_classification.json")


@router.get("/rul-ml")
def get_rul_ml() -> dict:
    """XJTU-SY 轴承 RUL 预测（机器学习回归，按轴承分组切分）。"""
    return _load("ml_rul.json")


@router.get("/steam-ml")
def get_steam_ml() -> dict:
    """蒸汽量 sklearn 多模型回归对比 + 树模型特征重要性。"""
    return _load("steam_ml.json")


@router.get("/pump-phm")
def get_pump_phm() -> dict:
    """数字孪生泵预测性维护：退化轨迹 / TTF 预测精度 / 维护价值闭环。"""
    return _load("pump_phm.json")


@router.get("/cwru-signal")
def get_cwru_signal() -> dict:
    """CWRU 轴承故障信号诊断：时域波形 / 频域频谱 / t-SNE / 严重度梯度。"""
    return _load("cwru_signal.json")


@router.get("/smartfactory")
def get_smartfactory() -> dict:
    """SmartFactory 产线级异常态势：工段故障率 / 传感器异常度 / 设备健康分布。"""
    return _load("smartfactory.json")


@router.get("/dataset-registry")
def get_dataset_registry() -> dict:
    """数据资产总览：8 个公开数据集规模 / 维度 / 任务类型目录。"""
    return _load("dataset_registry.json")


@router.get("/fp-cnn-compare")
def get_fp_cnn_compare() -> dict:
    """创新点一：物理频率先验 CNN（FP-CNN）vs 基线 1D-CNN 对比实验。"""
    return _load("fp_cnn_compare.json")


@router.get("/rul-sde-pf")
def get_rul_sde_pf() -> dict:
    """创新点二：数字孪生 SDE + 粒子滤波 RUL 预测 vs 指数外推基线。"""
    return _load("rul_sde_pf.json")


@router.get("/domain-adapt")
def get_domain_adapt() -> dict:
    """创新点四：跨域自适应（CWRU 试验台 -> 三类仿真设备）。"""
    return _load("domain_adapt.json")