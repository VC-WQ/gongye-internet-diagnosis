# -*- coding: utf-8 -*-
"""第 6 章振动-视觉多模态交叉验证的场景数值核准。

在真实 CWRU 样本证据上叠加视觉证据，给出四类交叉验证场景的
融合分布、冲突系数 K 与最终判定，并做视觉置信度敏感性分析。
"""
from __future__ import annotations

import io
import json
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend"))

from app.modules.multi_agent.ds_fusion import fuse_evidence  # noqa: E402
from app.modules.multi_agent.vision_agent import cross_check  # noqa: E402

OUT = ROOT / "scripts" / "_ch6_vision.txt"
buf = io.StringIO()


def w(s=""):
    buf.write(str(s) + "\n")


# 真实证据（取自 CWRU 测试集的典型样本，与 ch6_ds_fusion.py 口径一致）
# --- 样本 X1：真值 inner_race，包络谱主导峰 BPFI/medium，PINN severe ---
CNN_IR = {"normal": 0.0004, "inner_race": 0.9981, "outer_race": 0.0009, "ball": 0.0006}
# --- 样本 X2：真值 normal，无显著特征峰 low，PINN normal ---
CNNN = {"normal": 0.9972, "inner_race": 0.0011, "outer_race": 0.0010, "ball": 0.0007}

SCEN = [
    ("S1 强互证", CNN_IR, "BPFI", "medium", "severe", "pitted_surface", 0.82, "inner_race"),
    ("S2 早期预警", CNNN, "none", "low", "normal", "pitted_surface", 0.82, "normal"),
    ("S3 重定向提示", CNN_IR, "BPFI", "medium", "severe", None, 0.0, "inner_race"),
    ("S4 一致正常", CNNN, "none", "low", "normal", None, 0.0, "normal"),
]

w("=== 四类交叉验证场景（视觉 disonf=0.82 或无损伤）===")
rows = []
for name, probs, dom, rel, sev, vis, vconf, truth in SCEN:
    f = fuse_evidence(
        cnn_probabilities=probs,
        cnn_trained=True,
        dominant_peak=dom,
        signal_reliability=rel,
        physics_severity=sev,
        vision_damage_type=vis,
        vision_confidence=vconf,
    )
    cc = cross_check(f["fault_type"], vis, True)
    rows.append({
        "scenario": name,
        "truth": truth,
        "fusion": f["fault_type"],
        "confidence": f["confidence"],
        "K": f["conflict_k"],
        "distribution": f["distribution"],
        "cross_kind": cc["kind"],
        "cross_text": cc["text"],
        "is_early_warning": cc["is_early_warning"],
    })
    w(f"\n{name}   真值={truth}")
    w(f"  判定={f['fault_type']:<12} 置信度={f['confidence']:.4f}  K={f['conflict_k']:.4f}")
    w(f"  分布={f['distribution']}")
    w(f"  交叉验证={cc['kind']}  |  {cc['text']}")
    w(f"  BPA={f['bpas']}")

# --- 对照：无视觉证据时同一批样本的融合结果 ---
w("\n\n=== 对照：不提供视觉证据（vision=None）===")
for name, probs, dom, rel, sev, vis, vconf, truth in SCEN:
    f = fuse_evidence(probs, True, dom, rel, sev, None, 0.0)
    w(f"  {name}: 判定={f['fault_type']:<12} 置信度={f['confidence']:.4f}  K={f['conflict_k']:.4f}")

# --- 敏感性分析：S2 场景下视觉置信度从 0 扫到 1.0 ---
w("\n\n=== 敏感性：S2（振动判正常，视觉报点蚀）视觉置信度扫描 ===")
w("  conf   判定           置信度     K        normal      inner_race")
for c in np.arange(0.0, 1.01, 0.1):
    f = fuse_evidence(CNNN, True, "none", "low", "normal", "pitted_surface", float(c))
    d = f["distribution"]
    w(f"  {c:.1f}    {f['fault_type']:<12} {f['confidence']:.4f}  {f['conflict_k']:.4f}   "
      f"{d['normal']:.4f}   {d['inner_race']:.4f}")

# --- S4 场景：视觉"确认表面完好"当前实现不入融合的量化影响 ---
w("\n\n=== 补充核算：S4 场景把「视觉确认表面完好」纳入融合的影响 ===")
f_now = fuse_evidence(CNNN, True, "none", "low", "normal", None, 0.0)
w(f"  当前实现（视觉不入合成）: {f_now['fault_type']:<12} {f_now['confidence']:.4f}  "
  f"K={f_now['conflict_k']:.4f}")
for c in np.arange(0.0, 1.01, 0.1):
    pass
# 手工核算：把 vision 完好证据（α=0.35 支持 normal）显式加入合成
from app.modules.multi_agent.ds_fusion import (  # noqa: E402
    cnn_bpa, combine_all, discount, physics_bpa, signal_bpa, to_class_distribution,
)
m_cnn = cnn_bpa(CNNN, True)
m_sig = signal_bpa("none", "low")
m_phys = physics_bpa("normal")
m_vis_ok = discount({frozenset(("normal",)): 1.0}, 0.35)
fused4, k4 = combine_all([m_cnn, m_sig, m_phys, m_vis_ok])
d4 = to_class_distribution(fused4)
best4 = max(d4, key=d4.get)
w(f"  若纳入视觉完好证据(α=0.35): {best4:<12} {d4[best4]:.4f}  K={k4:.4f}  "
  f"分布={ {k: round(v, 4) for k, v in d4.items()} }")

# --- 视觉置信度扫描：S1 强互证下视觉额外带来的增益 ---
w("\n\n=== 敏感性：S1（振动已判内圈，视觉报点蚀）视觉置信度扫描 ===")
w("  conf   判定           置信度     K")
for c in np.arange(0.0, 1.01, 0.1):
    f = fuse_evidence(CNN_IR, True, "BPFI", "medium", "severe", "pitted_surface", float(c))
    w(f"  {c:.1f}    {f['fault_type']:<12} {f['confidence']:.4f}  {f['conflict_k']:.4f}")

open(OUT, "w", encoding="utf-8").write(buf.getvalue())
print("OK")
