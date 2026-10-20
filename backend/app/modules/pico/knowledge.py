"""小型可审计知识目录与固定实验读取器；不访问任意文件或 URL。"""
from __future__ import annotations

import math
import re
from typing import Any

from sqlalchemy.orm import Session

from app.modules.command_loop.accuracy_tracker import loops
from app.modules.multi_agent.knowledge_tools import KB_FILE
from app.modules.vision.service import vision_service
from importlib import import_module

viz = import_module("app.modules.viz.router")
CATALOG_SOURCE = "frontend/src/features/about/research.ts"

# Mirror of the V2.3 research directory; contract-tested against its IDs/titles/APIs.
TOPICS = {
    "signal": "数据与信号", "diagnosis": "诊断与识别", "health": "健康与寿命",
    "mechanism": "系统机理", "results": "实验与成果",
}
POINTS = [
    {"topic_id": "signal", "point_id": "assets", "title": "数据资产登记", "summary": "登记公开与仿真数据的来源、规模、用途，不将训练或仿真数据称为现场采集。", "api": "/api/v1/viz/dataset-registry", "kind": "mixed", "aliases": ["数据集", "数据资产", "数据来源", "CWRU", "XJTU-SY", "NEU-DET"]},
    {"topic_id": "signal", "point_id": "cwru", "title": "CWRU 轴承信号", "summary": "CWRU 公开振动信号的时域、频谱、包络与故障特征；不是当前设备实时采样。", "api": "/api/v1/viz/cwru-signal", "kind": "offline_public", "aliases": ["CWRU", "轴承信号", "时域", "频谱", "包络"]},
    {"topic_id": "diagnosis", "point_id": "fpcnn", "title": "FP-CNN 分类对照", "summary": "将轴承故障特征频率作为物理先验引入卷积网络，与基线CNN同划分对照；不能把零提升改写成提升。", "api": "/api/v1/viz/fp-cnn-compare", "kind": "offline_public", "aliases": ["FP-CNN", "FPCNN", "物理先验", "分类模型", "CNN"]},
    {"topic_id": "diagnosis", "point_id": "domain", "title": "跨域自适应", "summary": "用CORAL、DANN等方法比较CWRU源域与物理变换构造目标域；不是工业现场实采验证。", "api": "/api/v1/viz/domain-adapt", "kind": "constructed_domain", "aliases": ["跨域", "域自适应", "CORAL", "DANN", "迁移学习"]},
    {"topic_id": "health", "point_id": "rul", "title": "SDE + 粒子滤波 RUL", "summary": "SDE以随机微分方程描述退化过程，粒子滤波在线更新隐状态并估计剩余寿命分布；离线实验采用XJTU-SY和留一法，与指数外推基线比较。", "api": "/api/v1/viz/rul-sde-pf", "kind": "offline_public", "aliases": ["SDE", "SDE-PF", "粒子滤波", "PF", "RUL", "剩余寿命", "随机微分方程"]},
    {"topic_id": "health", "point_id": "xjtu", "title": "全寿命退化曲线", "summary": "XJTU-SY全寿命健康指标与退化曲线，为寿命模型提供离线建模依据。", "api": "/api/v1/viz/xjtu-rul", "kind": "offline_public", "aliases": ["XJTU-SY", "全寿命", "退化曲线", "健康指标"]},
    {"topic_id": "health", "point_id": "twin", "title": "数字孪生 PHM", "summary": "数字孪生泵的隐状态、退化轨迹、TTF和预测性维护价值来自仿真实验产物，不能证明真实设备效果。", "api": "/api/v1/viz/pump-phm", "kind": "simulation", "aliases": ["PHM", "数字孪生", "TTF", "预测性维护", "维护价值"]},
    {"topic_id": "mechanism", "point_id": "loop", "title": "双闭环自进化", "summary": "内闭环围绕事件、处置和观察期，外闭环统计阈值建议与人工采纳；没有人工根因样本时不报告准确率。", "api": "/api/v1/self-eval/loops", "kind": "runtime", "aliases": ["双闭环", "自进化", "阈值", "人工反馈", "准确率统计"]},
    {"topic_id": "mechanism", "point_id": "factory", "title": "工厂运行组织", "summary": "SmartFactory仿真产线的设备、工段与传感器分布用于解释工厂组织；不等同于当前工厂实时设备数。", "api": "/api/v1/viz/smartfactory", "kind": "simulation", "aliases": ["SmartFactory", "工厂组织", "工段", "产线"]},
    {"topic_id": "results", "point_id": "evidence", "title": "证据索引", "summary": "以真实数据资产登记与实验接口索引研究证据；缺失产物保持缺失，不生成数值。", "api": "/api/v1/viz/dataset-registry", "kind": "mixed", "aliases": ["证据索引", "研究成果", "实验结果"]},
    {"topic_id": "results", "point_id": "classification", "title": "表格分类横评", "summary": "机器故障和工业制造缺陷公开数据上的分类模型、F1、AUC与混淆矩阵，属于离线横评。", "api": "/api/v1/viz/classification", "kind": "offline_public", "aliases": ["随机森林", "XGBoost", "逻辑回归", "梯度提升", "表格分类", "F1", "AUC"]},
    {"topic_id": "results", "point_id": "steam", "title": "蒸汽量回归横评", "summary": "工业蒸汽量公开数据上的多模型回归、RMSE、MAE和R²对照。", "api": "/api/v1/viz/steam-ml", "kind": "offline_public", "aliases": ["蒸汽", "回归", "RMSE", "MAE", "R2"]},
    {"topic_id": "results", "point_id": "vision", "title": "视觉模型对照", "summary": "YOLOv8s与RT-DETR在NEU-DET上的mAP、速度和参数量离线对照；权重可用性与实验指标是不同事实。", "api": "/api/v1/vision/comparison", "kind": "offline_public", "aliases": ["视觉", "检测效果", "YOLOv8s", "YOLO", "RT-DETR", "RTDETR", "NEU-DET", "mAP"]},
]

KNOWLEDGE = [
    {"id": "architecture", "title": "平台架构与业务数据流", "summary": "平台前端为React，后端为FastAPI与SQLAlchemy；MQTT管道提供传感器窗口，诊断模块计算故障与健康指标，多智能体会诊解读硬数据，command_loop保存事件及状态机，报告读取落库诊断。Pico复用这些只读业务数据，不能自主下发控制命令。", "source": "README.md; backend/app/main.py", "aliases": ["系统架构", "平台架构", "数据流", "FastAPI", "MQTT", "React"], "route": "/research/mechanism"},
    {"id": "diagnosis-methods", "title": "项目已有诊断与预测方法", "summary": "代码包含1D-CNN故障分类、PINN物理残差与健康评分；研究目录包含FP-CNN物理先验分类、CORAL/DANN跨域、SDE+粒子滤波寿命预测，以及表格分类、蒸汽回归和YOLOv8s/RT-DETR视觉对照。各方法的效果必须回到对应实验，不能声称所有方法都在当前设备生产运行。", "source": "README.md; backend/app/modules/anomaly_detect/service.py; frontend/src/features/about/research.ts", "aliases": ["系统算法", "诊断算法", "故障诊断方法", "用了哪些算法", "PINN", "1D-CNN"], "route": "/research/diagnosis"},
]


def _norm(text: str) -> str:
    return re.sub(r"[\s+_.\-]+", "", text).casefold()


def search_research_topics(query: str, limit: int = 5) -> list[dict[str, Any]]:
    """只在固定索引召回；未知模型名称没有泛化到“全部模型”的后门。"""
    q = _norm(query)
    broad = bool(re.search(r"(?:系统|平台|项目|我们).*(?:哪些|什么).*(?:算法|方法)|(?:列出|介绍).*(?:所有|全部).*(?:算法|研究)|研究中心有什么", query))
    known_terms = [_norm(term) for p in [*POINTS, *KNOWLEDGE] for term in p["aliases"]]
    if any(not any(_norm(token) in term for term in known_terms) for token in re.findall(r"[A-Za-z][A-Za-z0-9_-]+", query)):
        broad = False
    scored: list[tuple[int, dict]] = []
    for point in POINTS:
        terms = [point["title"], f"{point['topic_id']}/{point['point_id']}", *point["aliases"]]
        score = max((len(_norm(term)) for term in terms if len(_norm(term)) >= 2 and _norm(term) in q), default=0)
        if broad and (point["topic_id"] in ("diagnosis", "health") or point["point_id"] == "vision"):
            score = max(score, 1)
        if score:
            scored.append((score, {**point, "provenance_kind": point["kind"], "kind": "research", "id": f"{point['topic_id']}/{point['point_id']}", "source": CATALOG_SOURCE, "route": f"/research/{point['topic_id']}/{point['point_id']}"}))
    for entry in KNOWLEDGE:
        score = max((len(_norm(term)) for term in entry["aliases"] if _norm(term) in q), default=0)
        if broad and entry["id"] == "diagnosis-methods":
            score = max(score, 100)
        if score:
            scored.append((score, {"kind": "knowledge", **entry}))
    # CWRU knowledge excerpts use a single fixed file, not a model supplied path.
    fault_names = {"inner_race": ["内圈", "BPFI"], "outer_race": ["外圈", "BPFO"], "ball": ["滚动体", "BSF"]}
    for fault, aliases in fault_names.items():
        if any(_norm(alias) in q for alias in aliases):
            try:
                text = KB_FILE.read_text(encoding="utf-8")
                section = text.split(f"## {fault}\n", 1)[1].split("\n## ", 1)[0].strip()[:1200]
            except (OSError, IndexError):
                continue
            scored.append((20, {"kind": "knowledge", "id": f"fault-{fault}", "title": f"CWRU SKF6205 {aliases[0]}故障模式", "summary": section, "source": "backend/app/modules/multi_agent/knowledge_base/cwru_fault_modes.md", "route": "/research/signal/cwru"}))
    scored.sort(key=lambda item: -item[0])
    return [entry for _, entry in scored[:max(1, min(limit, 8))]]


def _pick(data: Any, *keys: str) -> dict:
    if not isinstance(data, dict):
        return {}
    return {key: data[key] for key in keys if key in data and isinstance(data[key], (str, int, float, bool)) and (not isinstance(data[key], float) or math.isfinite(data[key])) and (not isinstance(data[key], str) or len(data[key]) <= 400)}


def _summarize(point: dict, data: dict) -> dict:
    key = point["point_id"]
    if key in ("assets", "evidence"):
        return {"datasets": [_pick(row, "name", "label", "source", "samples", "task_label", "used_in") for row in data.get("datasets", [])[:12]]} if isinstance(data.get("datasets"), list) and data["datasets"] else {}
    if key in ("cwru", "factory"):
        return {"overview": _pick(data.get("overview"), "n_samples", "n_points", "fs", "n_machines", "n_sections", "failure_rate")} if data.get("overview") else {}
    if key == "fpcnn":
        return {"full": _pick(data.get("full"), "baseline_acc", "fp_acc", "delta"), "config": _pick(data.get("config"), "epochs", "note")} if data.get("full") else {}
    if key == "domain":
        return {"target_construction": str(data.get("target_construction", ""))[:600], "results": [_pick(row, "id", "title", "source_test_accuracy", "target_macro_accuracy", "gain_vs_v0") for row in data.get("results", [])[:8]]} if isinstance(data.get("results"), list) and data["results"] else {}
    if key == "rul":
        metrics = data.get("metrics", {})
        return {"method": str(data.get("method", ""))[:300], "metrics": {name: _pick(metrics.get(name), "rmse", "mae", "r2", "n_points") for name in ("sde_pf", "baseline")}, "config": _pick(data.get("config"), "n_particles", "note")} if isinstance(metrics, dict) and metrics.get("sde_pf") else {}
    if key == "xjtu":
        return {"bearings": [{**_pick(row, "id"), "series_points": len(row.get("series", []))} for row in data.get("bearings", [])[:20]]} if isinstance(data.get("bearings"), list) and data["bearings"] else {}
    if key == "twin":
        return {"overview": _pick(data.get("overview"), "n_trajectories", "n_steps"), "ttf_metrics": _pick((data.get("ttf_prediction") or {}).get("metrics"), "mae_hours", "rmse_hours", "corr"), "maintenance": _pick(data.get("maintenance_roi"), "roi", "avg_maintenance_cost", "avg_expected_savings")} if data.get("overview") else {}
    if key == "classification":
        return {"datasets": [{**_pick(row, "name", "samples", "best_model"), "models": [_pick(model, "name", "accuracy", "precision", "recall", "f1", "auc") for model in row.get("models", [])[:8]]} for row in data.get("datasets", [])[:4]]} if isinstance(data.get("datasets"), list) and data["datasets"] else {}
    if key == "steam":
        return {"methods": [_pick(row, "name", "rmse", "mae", "r2") for row in data.get("methods", [])[:8]]} if isinstance(data.get("methods"), list) and data["methods"] else {}
    if key == "vision":
        return {"models": [_pick(row, "name", "mAP50", "mAP50_95", "precision", "recall", "fps", "params_M", "imgsz") for row in data.get("models", [])[:4]]} if isinstance(data.get("models"), list) and data["models"] else {}
    if key == "loop":
        result = {"inner_loop": _pick(data.get("inner_loop"), "total_events", "auto_reconsult"), "outer_loop": _pick(data.get("outer_loop"), "suggestions_total", "accepted", "rejected")}
        metrics = data.get("metrics") if isinstance(data.get("metrics"), dict) else {}
        result["metrics"] = _pick(metrics, "total", "correct", "accuracy", "false_alarm_rate", "miss_rate") if metrics.get("total", 0) else {"total": 0, "note": "没有人工根因样本，不报告准确率或误报漏报率"}
        return result
    return {}


LOADERS = {
    "assets": viz.get_dataset_registry, "cwru": viz.get_cwru_signal,
    "fpcnn": viz.get_fp_cnn_compare, "domain": viz.get_domain_adapt,
    "rul": viz.get_rul_sde_pf, "xjtu": viz.get_xjtu_rul,
    "twin": viz.get_pump_phm, "factory": viz.get_smartfactory,
    "evidence": viz.get_dataset_registry, "classification": viz.get_classification,
    "steam": viz.get_steam_ml, "vision": vision_service.comparison,
}


def _valid_evidence(point: dict, data: dict) -> bool:
    def numeric(record, *keys):
        return isinstance(record, dict) and all(isinstance(record.get(k), (int, float)) and not isinstance(record.get(k), bool) and math.isfinite(record[k]) for k in keys)

    def rows(value):
        return isinstance(value, list) and bool(value)

    key = point["point_id"]
    if key in ("assets", "evidence"):
        return rows(data.get("datasets")) and all(isinstance(row, dict) and isinstance(row.get("name"), str) and isinstance(row.get("source"), str) and numeric(row, "samples") for row in data["datasets"])
    if key == "cwru":
        return numeric(data.get("overview"), "n_samples", "fs") and rows((data.get("time_domain") or {}).get("waves")) and rows((data.get("frequency_domain") or {}).get("spectra"))
    if key == "factory":
        return numeric(data.get("overview"), "n_samples", "n_machines", "n_sections", "failure_rate")
    if key == "fpcnn":
        return numeric(data.get("full"), "baseline_acc", "fp_acc", "delta") and rows(data.get("few_shot")) and rows(data.get("noise"))
    if key == "domain":
        return bool(data.get("target_domains")) and rows(data.get("results")) and all(numeric(row, "target_macro_accuracy") for row in data["results"])
    if key == "rul":
        metrics = data.get("metrics") or {}
        return numeric(metrics.get("sde_pf"), "rmse", "mae", "r2") and numeric(metrics.get("baseline"), "rmse", "mae", "r2") and rows(data.get("curves"))
    if key == "xjtu":
        return rows(data.get("bearings")) and all(isinstance(row, dict) and rows(row.get("series")) and all(numeric(sample, "t", "hi", "rul") for sample in row["series"]) for row in data["bearings"])
    if key == "twin":
        return numeric(data.get("overview"), "n_trajectories", "n_steps") and numeric((data.get("ttf_prediction") or {}).get("metrics"), "mae_hours", "rmse_hours", "corr")
    if key == "classification":
        return rows(data.get("datasets")) and all(isinstance(row, dict) and rows(row.get("models")) and all(numeric(model, "accuracy", "precision", "recall", "f1", "auc") for model in row["models"]) for row in data["datasets"])
    if key == "steam":
        return rows(data.get("target_true")) and rows(data.get("methods")) and all(numeric(row, "rmse", "mae", "r2") and len(row.get("pred", [])) == len(data["target_true"]) for row in data["methods"])
    if key == "vision":
        return rows(data.get("models")) and all(numeric(row, "mAP50", "mAP50_95", "precision", "recall", "fps", "params_M", "imgsz") for row in data["models"])
    if key == "loop":
        return numeric(data.get("inner_loop"), "total_events") and numeric(data.get("outer_loop"), "suggestions_total") and isinstance(data.get("metrics"), dict)
    return False


def get_research_evidence(db: Session, topic_id: str, point_id: str | None = None) -> list[dict]:
    selected = [p for p in POINTS if p["topic_id"] == topic_id and (point_id is None or p["point_id"] == point_id)]
    result = []
    for point in selected:
        try:
            payload = loops(db=db) if point["point_id"] == "loop" else LOADERS[point["point_id"]]()
            valid = isinstance(payload, dict) and _valid_evidence(point, payload)
            summary = _summarize(point, payload) if valid else {}
            status = "available" if summary else "incomplete" if payload and any(key != "_meta" for key in payload) else "missing"
        except (OSError, ValueError, KeyError, TypeError, AttributeError):
            summary, status = {}, "missing"
        result.append({"id": f"{point['topic_id']}/{point['point_id']}", "title": point["title"], "method": point["summary"], "source": point["api"], "kind": point["kind"], "status": status, "evidence": summary, "route": f"/research/{point['topic_id']}/{point['point_id']}"})
    return result
