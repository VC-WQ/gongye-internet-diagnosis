# -*- coding: utf-8 -*-
"""第 6 章 D-S 证据融合实验核准脚本。

核准目标
--------
1. 协议 A：干净测试集上，三种决策规则（仅 CNN / 原经验规则 / D-S 融合）的准确率
2. 协议 B：噪声鲁棒性（SNR = 20/10/5/0 dB）
3. 协议 C：CNN 降级为启发式（后端真实降级路径）时的融合纠错能力
4. 协议 D：Shafer 折扣因子敏感性（信号证据可靠性 α）
5. 协议 E：冲突系数 K 的分布与高冲突案例剖析

输出：backend/app/data/ch6_ds_fusion.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.anomaly_detect.cnn_classifier import (  # noqa: E402
    FAULT_CLASSES,
    cnn_classifier,
)
from app.modules.anomaly_detect.data_loader import load_npz, map_labels, stratified_file_split  # noqa: E402
from app.modules.anomaly_detect.pinn_residual import pinn_residual_generator  # noqa: E402
from app.modules.multi_agent.ds_fusion import combine_all, cnn_bpa, physics_bpa, signal_bpa, to_class_distribution  # noqa: E402
from app.modules.multi_agent.signal_agent import DOMINANT_TO_FAULT  # noqa: E402
from app.modules.multi_agent.signal_tools import SAMPLE_RATE, extract_signal_evidence  # noqa: E402

SEED = 42
SNR_LIST = [None, 20.0, 10.0, 5.0, 0.0]

# ---------------------------------------------------------------------------
# 证据提取
# ---------------------------------------------------------------------------
def add_noise(x: np.ndarray, snr_db: float, rng: np.random.Generator) -> np.ndarray:
    """按给定信噪比注入高斯噪声。"""
    power = float(np.mean(x ** 2))
    noise_power = power / (10.0 ** (snr_db / 10.0))
    return x + rng.standard_normal(x.shape).astype(np.float32) * np.sqrt(noise_power)


def physics_severity(residual: float) -> str:
    """PINN 残差 -> 严重度分级（与 PhysicalResidualAgent 保持一致）。"""
    if residual < 0.05:
        return "normal"
    if residual <= 0.2:
        return "mild"
    return "severe"


def legacy_rule(
    cnn_result: dict, dominant: str, reliability: str
) -> tuple[str, float]:
    """原经验规则：信号与 CNN 一致 -> 置信度 +0.02；冲突 -> 保持 CNN 原值。

    注意：该规则**从不改变 CNN 的判定类别**，只调整置信度数值。
    """
    fault_type = cnn_result["fault_type"]
    confidence = float(cnn_result["confidence"])
    signal_fault = DOMINANT_TO_FAULT.get(dominant, "normal")
    if reliability != "low" and dominant != "none" and signal_fault == fault_type:
        confidence = min(1.0, confidence + 0.02)
    return fault_type, confidence


def ds_decide(
    cnn_result: dict,
    dominant: str,
    reliability: str,
    severity: str,
    signal_alpha: dict | None = None,
) -> tuple[str, float, dict, float]:
    """D-S 融合决策，返回 (类型, 置信度, 分布, 冲突系数K)。"""
    from app.modules.multi_agent.ds_fusion import discount

    # CNN 证据
    known = {c: max(0.0, float(p)) for c, p in cnn_result["probabilities"].items() if c in FAULT_CLASSES}
    trained = cnn_result.get("cnn_source") == "trained_model"
    m_cnn = cnn_bpa(known, trained)

    # 信号证据（可覆盖折扣因子以做敏感性分析）
    alpha_map = signal_alpha or {"high": 0.85, "medium": 0.60, "low": 0.0}
    alpha = alpha_map.get(reliability, 0.0)
    from app.modules.multi_agent.ds_fusion import FRAME, THETA

    if alpha <= 0.0 or dominant in ("none", "", None):
        m_sig = {THETA: 1.0}
    else:
        fault = DOMINANT_TO_FAULT.get(dominant, "normal")
        m_sig = discount({frozenset((fault,)): 1.0}, alpha) if fault in FRAME else {THETA: 1.0}

    m_phys = physics_bpa(severity)

    fused, k = combine_all([m_cnn, m_sig, m_phys])
    dist = to_class_distribution(fused)
    fault_type = max(dist, key=lambda c: dist[c])
    return fault_type, dist[fault_type], dist, k


# ---------------------------------------------------------------------------
# 数据准备
# ---------------------------------------------------------------------------
def load_test_set():
    """按第 4 章同一协议（物理文件划分，seed=42）取出测试集。"""
    X, Y_str, file_ids = load_npz()
    Y = map_labels(Y_str)
    (_, _, test_d), _ = stratified_file_split(X, Y, file_ids, 0.7, 0.15, SEED)
    return test_d[0], test_d[1]


def build_evidence(X_test: np.ndarray, snr_db: float | None) -> tuple[list[dict], list[str], list[float]]:
    """对每个样本构造 CNN / 信号 / 物理三路证据。

    Returns: (cnn_results, severities, k_list_of_signal)
    """
    rng = np.random.default_rng(SEED)
    Xn = X_test.copy()
    if snr_db is not None:
        for i in range(len(Xn)):
            Xn[i, 0] = add_noise(Xn[i, 0], snr_db, rng)

    # --- CNN 批量推理 ---
    cnn_classifier.ensure_weights()
    probs_list = []
    with torch.no_grad():
        xt = torch.from_numpy(np.ascontiguousarray(Xn, dtype=np.float32))
        for i in range(0, len(xt), 128):
            logits = cnn_classifier.model(xt[i : i + 128])
            probs_list.append(torch.softmax(logits, dim=1).numpy())
    probs = np.concatenate(probs_list, axis=0)
    cnn_results = [
        {
            "fault_type": FAULT_CLASSES[int(np.argmax(p))],
            "confidence": float(p.max()),
            "probabilities": {c: float(p[j]) for j, c in enumerate(FAULT_CLASSES)},
            "cnn_source": "trained_model",
        }
        for p in probs
    ]

    # --- PINN 残差 ---
    pinn_residual_generator.ensure_weights()
    severities = []
    with torch.no_grad():
        xt = torch.from_numpy(np.ascontiguousarray(Xn, dtype=np.float32))
        for i in range(0, len(xt), 128):
            xb = xt[i : i + 128]
            if xb.ndim == 2:
                xb = xb[:, None, :]
            recon = pinn_residual_generator.model(xb)
            resid = torch.sqrt(torch.mean((xb - recon) ** 2, dim=(1, 2)) + 1e-8)
            severities.extend([physics_severity(float(v)) for v in resid])

    # --- 信号证据 ---
    signal_evs = []
    for i in range(len(Xn)):
        x1 = np.asarray(Xn[i, 0], dtype=np.float64)
        ev = extract_signal_evidence(x1, SAMPLE_RATE, 1797.0)
        signal_evs.append(ev)

    return cnn_results, severities, signal_evs


def evaluate(X_test, Y_test, cnn_results, severities, signal_evs, signal_alpha=None,
             force_heuristic: bool = False) -> dict:
    """在给定证据上评估三种规则。"""
    n = len(Y_test)
    cnt = {"cnn_only": 0, "legacy": 0, "ds": 0}
    ds_conf, legacy_conf, cnn_conf = [], [], []
    k_list = []
    per_class = {i: {"total": 0, "cnn_only": 0, "legacy": 0, "ds": 0} for i in range(4)}
    flips = []  # DS 相对 CNN 翻转的样本

    for i in range(n):
        true_cls = FAULT_CLASSES[Y_test[i]]
        cr = dict(cnn_results[i])
        if force_heuristic:
            # 后端真实降级路径：无 torch 时 CNN 恒判正常
            cr = {
                "fault_type": "normal",
                "confidence": 1.0,
                "probabilities": {c: (1.0 if c == "normal" else 0.0) for c in FAULT_CLASSES},
                "cnn_source": "heuristic",
            }
        dom = signal_evs[i]["dominant_peak"]
        rel = signal_evs[i]["signal_reliability"]

        # 规则 1：仅 CNN
        cnt["cnn_only"] += int(cr["fault_type"] == true_cls)
        cnn_conf.append(cr["confidence"])

        # 规则 2：原经验规则
        lg_type, lg_conf = legacy_rule(cr, dom, rel)
        cnt["legacy"] += int(lg_type == true_cls)
        legacy_conf.append(lg_conf)

        # 规则 3：D-S 融合
        ds_type, ds_c, dist, k = ds_decide(cr, dom, rel, severities[i], signal_alpha)
        cnt["ds"] += int(ds_type == true_cls)
        ds_conf.append(ds_c)
        k_list.append(k)

        pc = per_class[Y_test[i]]
        pc["total"] += 1
        pc["cnn_only"] += int(cr["fault_type"] == true_cls)
        pc["legacy"] += int(lg_type == true_cls)
        pc["ds"] += int(ds_type == true_cls)

        if ds_type != cr["fault_type"] and len(flips) < 40:
            flips.append({
                "index": int(i),
                "true": true_cls,
                "cnn": cr["fault_type"],
                "cnn_conf": round(cr["confidence"], 4),
                "signal": f"{dom}/{rel}",
                "dominant": dom,
                "reliability": rel,
                "physics": severities[i],
                "ds": ds_type,
                "ds_conf": round(ds_c, 4),
                "dist": {c: round(v, 4) for c, v in dist.items()},
                "K": round(k, 4),
                "corrected": ds_type == true_cls,
            })

    ks = np.array(k_list, dtype=float)
    return {
        "n": n,
        "accuracy": {k2: round(v / n, 4) for k2, v in cnt.items()},
        "mean_confidence": {
            "cnn_only": round(float(np.mean(cnn_conf)), 4),
            "legacy": round(float(np.mean(legacy_conf)), 4),
            "ds": round(float(np.mean(ds_conf)), 4),
        },
        "per_class": {
            FAULT_CLASSES[i]: {
                "n": per_class[i]["total"],
                "cnn_only": round(per_class[i]["cnn_only"] / max(per_class[i]["total"], 1), 4),
                "legacy": round(per_class[i]["legacy"] / max(per_class[i]["total"], 1), 4),
                "ds": round(per_class[i]["ds"] / max(per_class[i]["total"], 1), 4),
            }
            for i in range(4)
        },
        "K": {
            "mean": round(float(ks.mean()), 4),
            "std": round(float(ks.std()), 4),
            "min": round(float(ks.min()), 4),
            "max": round(float(ks.max()), 4),
            "median": round(float(np.median(ks)), 4),
            "p90": round(float(np.percentile(ks, 90)), 4),
            "frac_gt_0.5": round(float((ks > 0.5).mean()), 4),
            "frac_gt_0.7": round(float((ks > 0.7).mean()), 4),
        },
        "flips": flips,
    }


def main() -> None:
    print("载入测试集 ...")
    X_test, Y_test = load_test_set()
    print(f"测试样本 {len(X_test)}，类别分布：")
    for i in range(4):
        print(f"  {FAULT_CLASSES[i]}: {int((Y_test == i).sum())}")

    out: dict = {}

    # ---------- 协议 A：干净测试集 ----------
    print("\n[协议 A] 干净测试集证据构造 ...")
    cnn_r, sev, sig = build_evidence(X_test, None)
    out["A_clean"] = evaluate(X_test, Y_test, cnn_r, sev, sig)
    print(f"  仅CNN={out['A_clean']['accuracy']['cnn_only']}  "
          f"原规则={out['A_clean']['accuracy']['legacy']}  "
          f"D-S={out['A_clean']['accuracy']['ds']}")
    print(f"  K: mean={out['A_clean']['K']['mean']} max={out['A_clean']['K']['max']} "
          f"frac>0.5={out['A_clean']['K']['frac_gt_0.5']}")

    # ---------- 协议 C：CNN 降级（启发式恒判正常）----------
    print("\n[协议 C] CNN 降级为启发式 ...")
    out["C_cnn_degraded"] = evaluate(X_test, Y_test, cnn_r, sev, sig, force_heuristic=True)
    print(f"  仅CNN={out['C_cnn_degraded']['accuracy']['cnn_only']}  "
          f"原规则={out['C_cnn_degraded']['accuracy']['legacy']}  "
          f"D-S={out['C_cnn_degraded']['accuracy']['ds']}")

    # ---------- 协议 B：噪声鲁棒性 ----------
    print("\n[协议 B] 噪声鲁棒性 ...")
    out["B_noise"] = {}
    for snr in SNR_LIST:
        if snr is None:
            continue
        c_r, s_v, s_g = build_evidence(X_test, snr)
        res = evaluate(X_test, Y_test, c_r, s_v, s_g)
        key = f"snr_{int(snr)}dB"
        out["B_noise"][key] = res
        print(f"  SNR={int(snr):>3}dB  仅CNN={res['accuracy']['cnn_only']}  "
              f"原规则={res['accuracy']['legacy']}  D-S={res['accuracy']['ds']}  "
              f"K均值={res['K']['mean']}")

    # ---------- 有区分度的条件（用于协议 D/E）----------
    # 干净数据上三规则均为 1.0000（天花板），α 敏感性做不出区分度，
    # 故必须在「CNN 降级」与「SNR=5dB」这两个有区分度的条件下重做。
    conditions = {
        "clean": (cnn_r, sev, sig, False),
        "cnn_degraded": (cnn_r, sev, sig, True),
        "snr_5dB": build_evidence(X_test, 5.0) + (False,),
    }

    # ---------- 协议 D：折扣因子敏感性 ----------
    print("\n[协议 D] 折扣因子敏感性（三种条件下）...")
    out["D_alpha"] = {}
    for hid, mid in ((0.85, 0.60), (0.60, 0.45), (0.40, 0.30), (0.20, 0.10), (0.0, 0.0)):
        alpha_map = {"high": hid, "medium": mid, "low": 0.0}
        row = {}
        for cname, (c_r, s_v, s_g, fh) in conditions.items():
            res = evaluate(X_test, Y_test, c_r, s_v, s_g, signal_alpha=alpha_map,
                           force_heuristic=fh)
            row[cname] = {
                "ds": res["accuracy"]["ds"],
                "cnn_only": res["accuracy"]["cnn_only"],
                "K_mean": res["K"]["mean"],
            }
        key = f"high_{hid}_medium_{mid}"
        out["D_alpha"][key] = row
        print(f"  α(high/medium)={hid}/{mid}: " + "  ".join(
            f"{c}={row[c]['ds']}" for c in row))

    # ---------- 协议 E：证据消融 ----------
    print("\n[协议 E] 证据消融（三种条件下）...")
    out["E_ablation"] = {}
    variants = {
        "full": lambda s_v, s_g: (s_v, s_g),
        "no_physics": lambda s_v, s_g: (["unknown"] * len(s_v), s_g),
        "no_signal": lambda s_v, s_g: (
            s_v, [{"dominant_peak": "none", "signal_reliability": "low"} for _ in s_g]),
        "cnn_only_evidence": lambda s_v, s_g: (
            ["unknown"] * len(s_v),
            [{"dominant_peak": "none", "signal_reliability": "low"} for _ in s_g]),
    }
    for vname, fn in variants.items():
        row = {}
        for cname, (c_r, s_v0, s_g0, fh) in conditions.items():
            s_v, s_g = fn(s_v0, s_g0)
            res = evaluate(X_test, Y_test, c_r, s_v, s_g, force_heuristic=fh)
            row[cname] = {
                "ds": res["accuracy"]["ds"],
                "cnn_only": res["accuracy"]["cnn_only"],
            }
        out["E_ablation"][vname] = row
        print(f"  {vname:<18}: " + "  ".join(f"{c}={row[c]['ds']}" for c in row))

    out["config"] = {
        "dataset": "CWRU 驱动端 DE，12kHz",
        "split": "物理文件分层划分 train0.7/val0.15/test0.15，seed=42（与第4章一致）",
        "n_test": int(len(X_test)),
        "rules": {
            "cnn_only": "直接取 CNN softmax argmax",
            "legacy": "原经验规则：信号与CNN一致则置信度+0.02，否则保持原值（从不改变判定类别）",
            "ds": "CNN/信号/物理三路 Shafer 折扣后 Dempster 合成",
        },
        "alpha_default": {"cnn_trained": 0.90, "cnn_heuristic": 0.50,
                          "signal_high": 0.85, "signal_medium": 0.60, "signal_low": 0.0,
                          "physics_normal": 0.55, "physics_mild": 0.40, "physics_severe": 0.70},
    }

    OUT = PROJECT_ROOT / "backend" / "app" / "data" / "ch6_ds_fusion.json"
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False, indent=2)
    print(f"\n输出: {OUT}")


if __name__ == "__main__":
    main()
