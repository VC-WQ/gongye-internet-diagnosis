# -*- coding: utf-8 -*-
"""第八章功能验证：关键链路时延实测（CPU）+ 无 torch 降级路径验证。

用法： .venv\\Scripts\\python.exe scripts\\ch8_perf.py
输出： scripts/_ch8_perf.txt
"""
from __future__ import annotations

import builtins
import importlib
import importlib.util
import io
import sys
import time
from pathlib import Path

import numpy as np

ROOT = Path(r"D:\企业云系统\工业互联网系统")
for _p in (str(ROOT), str(ROOT / "backend")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

out: list[str] = []
w = out.append


def bench(fn, n: int = 30, warm: int = 5):
    for _ in range(warm):
        fn()
    ts = []
    for _ in range(n):
        t0 = time.perf_counter()
        fn()
        ts.append((time.perf_counter() - t0) * 1000.0)
    a = np.array(ts)
    return float(a.mean()), float(a.min()), float(a.max()), float(np.median(a))


def row(label: str, m) -> None:
    w(f"{label:<32s}{m[0]:>10.3f}{m[3]:>10.3f}{m[1]:>10.3f}{m[2]:>10.3f}")


rng = np.random.default_rng(0)
WIN = 2048
FS = 12000.0
RPM = 1797.0

t = np.arange(WIN) / FS
_base = (
    0.3 * np.sin(2 * np.pi * 50 * t)
    + 0.1 * np.sin(2 * np.pi * 162.19 * t)
    + 0.2 * np.exp(-800 * (t % 0.01)) * np.sin(2 * np.pi * 4200 * (t % 0.01))
)
sig = (_base + 0.05 * rng.standard_normal(WIN)).astype(np.float32)
cnn_in = sig.reshape(1, 1, WIN)
window = [{"vibration": float(v)} for v in sig]

w("=== 8.5 关键链路时延实测（CPU，30 次重复，单位 ms）===")
w(f"{'环节':<32s}{'均值':>10s}{'中位':>10s}{'最小':>10s}{'最大':>10s}")
w("-" * 72)

# ---------- 1. 1D-CNN ----------
from backend.app.modules.anomaly_detect import cnn_classifier as cc

w(f"\n[环境] torch 可用 = {cc._HAS_TORCH}；权重文件存在 = {cc.CNN_WEIGHT_PATH.exists()}")
r0 = cc.cnn_classifier.classify(cnn_in)
w(f"CNN 首调输出: fault={r0.get('fault_type')} conf={r0.get('confidence')} src={r0.get('cnn_source')}")
row("1D-CNN 分类（2048 点窗口）", bench(lambda: cc.cnn_classifier.classify(cnn_in)))

# ---------- 2. PINN 残差 ----------
from backend.app.modules.anomaly_detect import pinn_residual as pr

p0 = pr.pinn_residual_generator.compute_residual(window)
w(f"PINN 首调输出: {str(p0)[:120]}")
row("PINN 物理残差（窗口）", bench(lambda: pr.pinn_residual_generator.compute_residual(window)))

# ---------- 3. 信号 Agent ----------
from backend.app.modules.multi_agent import signal_tools as st

s0 = st.extract_signal_evidence(sig, FS, RPM)
w(f"\n信号 Agent 首调输出: dominant={s0.get('dominant_peak')} "
  f"reliability={s0.get('signal_reliability')} ratio={s0.get('significance_ratio')}")
row("包络谱+特征频率匹配", bench(lambda: st.extract_signal_evidence(sig, FS, RPM)))

# ---------- 4. D-S 融合 ----------
from backend.app.modules.multi_agent import ds_fusion as ds

probs = {"normal": 0.02, "inner_race": 0.90, "outer_race": 0.05, "ball": 0.03}
d0 = ds.fuse_evidence(
    cnn_probabilities=probs,
    cnn_trained=True,
    dominant_peak="BPFI",
    signal_reliability="high",
    physics_severity="severe",
)
w(f"\nD-S 首调输出: fault={d0.get('fault_type')} conf={d0.get('confidence')} K={d0.get('conflict_k')}")
row("D-S 证据融合（4 路）", bench(lambda: ds.fuse_evidence(
    cnn_probabilities=probs, cnn_trained=True, dominant_peak="BPFI",
    signal_reliability="high", physics_severity="severe"), n=200))

# ---------- 5. 粒子滤波单步 ----------
spec = importlib.util.spec_from_file_location("rul_sde_pf", ROOT / "scripts" / "rul_sde_pf.py")
rul_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rul_mod)

pf = rul_mod.SdeParticleFilter(c=6.0, n_particles=300, seed=42)
for i in range(20):
    pf.step(float(np.log(1.0 + i * 0.15)))
rul20 = pf.estimate_rul()
w(f"\nPF 20 步后 RUL 估计 = {rul20}")
row("粒子滤波单步（300 粒子）", bench(lambda: pf.step(float(np.log(2.0))), n=200))

# ---------- 6. 汇总：诊断主链路（不含 LLM） ----------
def full_chain():
    p = pr.pinn_residual_generator.compute_residual(window)
    c = cc.cnn_classifier.classify(cnn_in)
    s = st.extract_signal_evidence(sig, FS, RPM)
    pr_dict = {"pinn": p, "cnn": c, "signal": s}
    return pr_dict


row("诊断主链路合计（不含LLM）", bench(full_chain, n=20))

# ---------- 7. 无 torch 降级路径 ----------
w("\n\n=== 8.5.4 无 torch 降级路径验证 ===")
real_import = builtins.__import__


def blocked(name, *a, **k):
    if name == "torch" or name.startswith("torch."):
        raise ImportError("blocked by test")
    return real_import(name, *a, **k)


try:
    builtins.__import__ = blocked
    mm = importlib.import_module("backend.app.modules.anomaly_detect.cnn_classifier")
    mm = importlib.reload(mm)
    w(f"reload 后 _HAS_TORCH = {mm._HAS_TORCH}")
    c2 = mm.cnn_classifier
    r2 = c2.classify(cnn_in)
    w(f"  降级模式输出: fault={r2.get('fault_type')} conf={r2.get('confidence')} "
      f"src={r2.get('cnn_source')}")
    w(f"  use_torch = {c2.use_torch}")
    p2 = importlib.reload(
        importlib.import_module("backend.app.modules.anomaly_detect.pinn_residual")
    ).pinn_residual_generator.compute_residual(window)
    w(f"  降级模式 PINN 输出: {str(p2)[:120]}")
    w("  >>> 结论：无 torch 时后端分类与残差链路仍可正常返回（启发式），服务不中断")
except Exception as e:  # pragma: no cover
    w(f"降级路径验证异常: {type(e).__name__}: {e}")
finally:
    builtins.__import__ = real_import

# 复原（把被 reload 污染过的模块恢复为 torch 版本）
try:
    importlib.reload(cc)
    w(f"复原后 _HAS_TORCH = {cc._HAS_TORCH}")
except Exception as e:  # pragma: no cover
    w(f"复原异常: {e}")

io.open(ROOT / "scripts" / "_ch8_perf.txt", "w", encoding="utf-8").write("\n".join(out))
print("\n".join(out))
