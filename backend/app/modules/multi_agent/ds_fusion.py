"""Dempster-Shafer 证据理论融合（技术增量：多证据不确定性推理）。

背景与动机
----------
原决策 Agent 的融合规则为「信号与 CNN 一致 -> 置信度 +0.02；冲突 -> 保持 CNN 原值」，
属于经验性加权，缺乏数学依据，且未真正利用物理残差与视觉证据。

本模块将其升级为 Dempster-Shafer（D-S）证据理论合成：
1. 每个证据源先经 Shafer 折扣（折扣因子 = 该证据源可靠性）转为基本概率分配 BPA；
2. 用 Dempster 合成规则组合多路证据，得到各故障类型的信任度 belief；
3. 合成过程中的冲突系数 K 直接量化「各证据相互矛盾的程度」，
   作为会诊主席可解释性输出（K 越大说明证据越不一致）。

辨识框架 Θ = {normal, inner_race, outer_race, ball}。

证据源
------
- CNN 故障分类：softmax 四类概率（单元素焦元）
- 信号分析：包络谱主导特征频率 -> 单一故障类型（可靠性 high/medium/low 决定折扣）
- 物理残差 PINN：只判「有无物理异常」，焦元为 {normal} 或 {inner,outer,ball}
- 视觉检测（可选）：部件表面损伤类型，映射为对应故障集合
"""
from __future__ import annotations

from typing import Iterable

# 辨识框架：轴承四类故障
FRAME: tuple[str, ...] = ("normal", "inner_race", "outer_race", "ball")

# 全部故障类（非 normal）构成的复合焦元
FAULT_SET = frozenset(("inner_race", "outer_race", "ball"))

# 全集（表示"不确定"）
THETA = frozenset(FRAME)


# ---------------------------------------------------------------------------
# BPA 基础操作
# ---------------------------------------------------------------------------
def _normalize(bpa: dict[frozenset[str], float]) -> dict[frozenset[str], float]:
    """归一化 BPA（消除浮点误差与折扣残留）。"""
    total = sum(bpa.values())
    if total <= 0:
        return {THETA: 1.0}
    return {k: v / total for k, v in bpa.items() if v > 0}


def discount(bpa: dict[frozenset[str], float], alpha: float) -> dict[frozenset[str], float]:
    """Shafer 折扣：以可靠性 alpha（0~1）将证据部分转化为不确定性。

    m'(A) = alpha * m(A)          (A != Θ)
    m'(Θ) = 1 - alpha + alpha * m(Θ)

    alpha=1 表示完全信任该证据；alpha=0 表示证据无信息（全给全集）。
    """
    alpha = max(0.0, min(1.0, float(alpha)))
    out: dict[frozenset[str], float] = {}
    for focal, mass in bpa.items():
        # 焦元质量按可靠性缩放（全集 Θ 同样缩放，它代表该证据自身的不确定性）
        out[focal] = out.get(focal, 0.0) + alpha * mass
    # 折扣"扣除"的 (1-alpha) 质量全部归入全集，表示对该证据的不信任
    # 注意：无论原 BPA 是否含 Θ，这一步都必须执行，否则折扣失效。
    out[THETA] = out.get(THETA, 0.0) + (1.0 - alpha)
    return _normalize(out)


def dempster_combine(
    m1: dict[frozenset[str], float],
    m2: dict[frozenset[str], float],
) -> tuple[dict[frozenset[str], float], float]:
    """Dempster 合成规则，返回 (合成后的 BPA, 冲突系数 K)。

    K = Σ_{A∩B=∅} m1(A)·m2(B)
    m(C) = [Σ_{A∩B=C} m1(A)·m2(B)] / (1 - K)
    """
    conflict = 0.0
    combined: dict[frozenset[str], float] = {}

    for f1, v1 in m1.items():
        for f2, v2 in m2.items():
            inter = f1 & f2
            if not inter:
                conflict += v1 * v2
            else:
                combined[inter] = combined.get(inter, 0.0) + v1 * v2

    if conflict >= 1.0 - 1e-12:
        # 完全冲突：Dempster 规则失效，退化为等权平均
        merged: dict[frozenset[str], float] = {}
        for m in (m1, m2):
            for f, v in m.items():
                merged[f] = merged.get(f, 0.0) + v / 2.0
        return _normalize(merged), 1.0

    norm = 1.0 - conflict
    combined = {f: v / norm for f, v in combined.items() if v > 0}
    return _normalize(combined), conflict


def combine_all(
    bpas: Iterable[dict[frozenset[str], float]],
) -> tuple[dict[frozenset[str], float], float]:
    """依次合成多路证据，返回 (最终 BPA, 累计冲突系数 K)。"""
    result: dict[frozenset[str], float] | None = None
    total_conflict = 0.0
    for bpa in bpas:
        if result is None:
            result = dict(bpa)
            continue
        result, k = dempster_combine(result, bpa)
        # 累计冲突按"未归一化前的冲突占比"累加，便于衡量整体矛盾程度
        total_conflict = total_conflict + (1.0 - total_conflict) * k
    return (result or {THETA: 1.0}), total_conflict


def belief_of(bpa: dict[frozenset[str], float], cls: str) -> float:
    """计算对单元素 {cls} 的信任度 belief（所有包含于 {cls} 的焦元 mass 之和）。"""
    return sum(v for f, v in bpa.items() if f == frozenset((cls,)))


def to_class_distribution(bpa: dict[frozenset[str], float]) -> dict[str, float]:
    """把 BPA 折算为四类上的可比较分布。

    复合焦元（如 {inner,outer,ball}）的 mass 按集合内元素均分，
    全集 Θ 的不确定性 mass 同样均分到四类——保证输出为合法概率分布。
    """
    dist = {c: 0.0 for c in FRAME}
    for focal, mass in bpa.items():
        if not focal:
            continue
        share = mass / len(focal)
        for c in focal:
            if c in dist:
                dist[c] += share
    total = sum(dist.values())
    if total > 0:
        dist = {c: v / total for c, v in dist.items()}
    return dist


# ---------------------------------------------------------------------------
# 各证据源 BPA 构造
# ---------------------------------------------------------------------------
def cnn_bpa(probabilities: dict[str, float], trained: bool) -> dict[frozenset[str], float]:
    """CNN 证据：softmax 概率作为 BPA，可靠性折扣取决于是否为训练模型推理。

    trained_model -> alpha=0.90（真实模型，高可信）
    heuristic     -> alpha=0.50（无 torch 降级路径，可信度减半）
    """
    bpa: dict[frozenset[str], float] = {}
    known = {c: max(0.0, float(p)) for c, p in probabilities.items() if c in FRAME}
    if not known:
        return {THETA: 1.0}
    unknown = max(0.0, 1.0 - sum(known.values()))
    for c, p in known.items():
        bpa[frozenset((c,))] = p
    if unknown > 0:
        bpa[THETA] = unknown
    return discount(_normalize(bpa), 0.90 if trained else 0.50)


def signal_bpa(dominant_peak: str, reliability: str) -> dict[frozenset[str], float]:
    """信号证据：主导特征频率指向单一故障类型，可靠性决定折扣因子。

    high->0.85 / medium->0.60 / low->0.0（low 视为无信息）。
    """
    from .signal_agent import DOMINANT_TO_FAULT  # 局部导入避免循环依赖

    alpha_map = {"high": 0.85, "medium": 0.60, "low": 0.0}
    alpha = alpha_map.get(reliability, 0.0)
    if alpha <= 0.0 or dominant_peak in ("none", "", None):
        return {THETA: 1.0}
    fault = DOMINANT_TO_FAULT.get(dominant_peak, "normal")
    if fault not in FRAME:
        return {THETA: 1.0}
    return discount({frozenset((fault,)): 1.0}, alpha)


def physics_bpa(severity: str) -> dict[frozenset[str], float]:
    """物理残差证据（PINN）：只判有无物理异常，不判具体类型。

    normal -> 支持 {normal}
    mild   -> 支持故障集合 {inner,outer,ball}（弱）
    severe -> 支持故障集合 {inner,outer,ball}（强）
    """
    if severity == "normal":
        return discount({frozenset(("normal",)): 1.0}, 0.55)
    if severity == "mild":
        return discount({FAULT_SET: 1.0}, 0.40)
    if severity == "severe":
        return discount({FAULT_SET: 1.0}, 0.70)
    return {THETA: 1.0}


# 视觉检测（NEU-DET 表面缺陷）-> 轴承故障类型的映射
# 说明：表面损伤与故障部位的对应关系为工程经验映射，属弱证据。
VISION_TO_FAULT = {
    "pitted_surface": "inner_race",   # 点蚀：滚道/滚动体表面，多见于内圈早期
    "scratches": "outer_race",        # 划痕：滚道划伤，外圈承载区常见
    "crazing": "ball",                # 裂纹：滚动体/保持架裂纹
    "patches": "outer_race",          # 斑块：磨损斑、胶合区
    "inclusion": "ball",              # 夹杂：材料缺陷诱发滚动体剥落
    "rolled-in_scale": "outer_race",  # 氧化/锈蚀：外圈暴露面
}


def vision_bpa(damage_type: str | None, confidence: float = 0.0) -> dict[frozenset[str], float]:
    """视觉证据：部件表面损伤类型映射为故障假设。

    damage_type 为 None / "none" 表示未检出损伤 -> 支持 {normal}。
    由于视觉模型在 NEU-DET 钢材数据集上训练、迁移应用于设备部件，
    存在域差异，故可靠性折扣取较低值（0.45），作为弱证据参与融合。
    """
    if not damage_type or damage_type == "none":
        return discount({frozenset(("normal",)): 1.0}, 0.35)
    fault = VISION_TO_FAULT.get(damage_type)
    if fault is None:
        return {THETA: 1.0}
    # 注意：必须用 `is not None` 而非真值判断——confidence=0.0 是合法输入，
    # 若按真值判断会把 0.0 替换为默认 1.0，使置信度最低的视觉检测反而获得
    # 最高可靠性折扣（历史上此处为 `if confidence else 1.0`）。
    conf = float(confidence) if confidence is not None else 1.0
    alpha = 0.45 * max(0.0, min(1.0, conf))
    return discount({frozenset((fault,)): 1.0}, alpha)


# ---------------------------------------------------------------------------
# 对外主入口
# ---------------------------------------------------------------------------
def fuse_evidence(
    cnn_probabilities: dict[str, float],
    cnn_trained: bool,
    dominant_peak: str,
    signal_reliability: str,
    physics_severity: str,
    vision_damage_type: str | None = None,
    vision_confidence: float = 0.0,
) -> dict:
    """融合多路证据，返回决策所需的融合结果。

    Returns
    -------
    dict:
        fault_type  : 融合后判定的故障类型
        confidence  : 该类型的信任度（0~1），可替代原 CNN 置信度
        distribution: 四类上的融合分布
        conflict_k  : 证据冲突系数（0~1，越大说明各方越矛盾）
        bpas        : 各证据源折扣后的 BPA（用于前端展示证据链）
    """
    bpas = [
        cnn_bpa(cnn_probabilities, cnn_trained),
        signal_bpa(dominant_peak, signal_reliability),
        physics_bpa(physics_severity),
    ]
    if vision_damage_type is not None:
        bpas.append(vision_bpa(vision_damage_type, vision_confidence))

    fused, conflict_k = combine_all(bpas)
    dist = to_class_distribution(fused)

    fault_type = max(dist, key=lambda c: dist[c]) if dist else "normal"
    return {
        "fault_type": fault_type,
        "confidence": round(dist.get(fault_type, 0.0), 4),
        "distribution": {c: round(v, 4) for c, v in dist.items()},
        "conflict_k": round(conflict_k, 4),
        "bpas": [
            {"/".join(sorted(f)) or "Θ": round(v, 4) for f, v in b.items()} for b in bpas
        ],
    }


__all__ = [
    "FRAME",
    "VISION_TO_FAULT",
    "fuse_evidence",
    "dempster_combine",
    "combine_all",
    "discount",
    "to_class_distribution",
]
