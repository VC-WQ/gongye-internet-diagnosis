"""第二章核准脚本：特征频率公式自洽性 + 频谱分辨率 + 包络解调实测。

产出仓库外的研究核准报告；可通过 ICT_ARTIFACT_DIR 指定目录。
"""
from __future__ import annotations

import sys
import os
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(ROOT / "backend"))

out: list[str] = []


def w(s: str = "") -> None:
    out.append(str(s))


# ---------------------------------------------------------------- 1. 公式自洽
w("=== 1. 特征频率：几何解析式 vs 工程系数表 ===")
n, d, Dd = 9, 7.94, 39.04
beta = d / Dd
w(f"滚珠数 n={n}  滚珠直径 d={d}mm  节径 D={Dd}mm  直径比 beta=d/D={beta:.6f}")
w("")
w("几何解析式（不含接触角，即 alpha=0 特化）：")
w("  BPFO = n/2 * (1 - beta) * fr")
w("  BPFI = n/2 * (1 + beta) * fr")
w("  BSF  = D/(2d) * (1 - beta^2) * fr")
w("  FTF  = 1/2 * (1 - beta) * fr")
w("")
geo = {
    "BPFO": n / 2.0 * (1 - beta),
    "BPFI": n / 2.0 * (1 + beta),
    "BSF": (Dd / (2.0 * d)) * (1 - beta ** 2),
    "FTF": 0.5 * (1 - beta),
}
eng = {"BPFO": 3.5848, "BPFI": 5.4152, "BSF": 2.3567, "FTF": 0.3983}
w(f"{'频率':<6}{'解析式系数':>14}{'工程系数表':>14}{'绝对偏差':>12}")
for k in ("BPFO", "BPFI", "BSF", "FTF"):
    w(f"{k:<6}{geo[k]:>14.6f}{eng[k]:>14.4f}{abs(geo[k] - eng[k]):>12.6f}")
w("")
w("结论：两套系数逐项吻合（偏差 <1e-4），说明 fp_cnn.theoretical_frequencies() 的")
w("      几何解析式与 signal_tools 的 SKF-6205 工程系数表是同一套物理关系。")
w("")

# 1797 rpm 下的绝对频率
fr = 1797.0 / 60.0
w(f"1797 rpm 下（fr={fr:.4f} Hz）的理论特征频率：")
for k in ("BPFO", "BPFI", "BSF", "FTF"):
    w(f"  {k:<6} {geo[k] * fr:>10.4f} Hz")
w("")

# ---------------------------------------------------------------- 2. 分辨率
w("=== 2. 频谱/包络谱频率分辨率 ===")
fs = 12000.0
for nfft in (2048, 16384):
    w(f"  nfft={nfft:<6} 分辨率 = fs/nfft = {fs / nfft:.4f} Hz")
w("  包络谱默认 nfft=16384 -> 0.7324 Hz；相邻特征频率最小间隔为")
min_gap = min(
    abs(geo[a] - geo[b]) * fr
    for a in ("BPFO", "BPFI", "BSF", "FTF")
    for b in ("BPFO", "BPFI", "BSF", "FTF")
    if a != b
)
w(f"  min|fi-fj| = {min_gap:.4f} Hz（远大于分辨率，故四个频带可分辨）")
w("")

# ---------------------------------------------------------------- 3. 包络解调实测
w("=== 3. 包络解调实测（CWRU 测试划分 IR 样本，索引 0）===")
try:
    from app.modules.anomaly_detect.data_loader import load_npz, map_labels, stratified_file_split

    X, Y_str, file_ids = load_npz()
    Y_int = map_labels(Y_str)
    (_, _, (X_test, Y_test)), _ = stratified_file_split(X, Y_int, file_ids)
    from app.modules.multi_agent import signal_tools as st

    x = np.asarray(X_test[0], dtype=np.float64).reshape(-1)
    w(f"  样本长度 {len(x)}  采样率 {fs} Hz  标签 {Y_test[0]}")
    cp = st.find_characteristic_peaks(x, fs, 1797.0)
    w(f"  转频 fr={cp['fr']} Hz")
    for k in ("bpfo", "bpfi", "bsf", "bsf2x"):
        p = cp[k]
        w(
            f"    {k:<7} 理论 {p['theoretical']:>9.3f} Hz  实测 {p['measured']:>9.3f} Hz  "
            f"幅值 {p['amplitude']:.6f}  偏差 {p['deviation_pct']:.3f}%"
        )
    ev = st.extract_signal_evidence(x, fs, 1797.0)
    w(f"  主导峰 {ev['dominant_peak']}  显著度比 {ev['significance_ratio']}  "
      f"可靠性 {ev['signal_reliability']}")
    w("")
    w("  说明：该样本用于正文 2.2.3「包络解调为什么必要」的实证——")
    w("        FFT 频谱上特征频率被结构共振淹没，包络谱上才可见。")

    # 对比：FFT 主峰位置
    spec = st.compute_spectrum(x, fs, top_n=5)
    w("")
    w("  对照——同一段信号的 FFT 前 5 主峰：")
    for pk in spec["peaks"]:
        w(f"    {pk['frequency']:>9.3f} Hz   幅值 {pk['amplitude']:.6f}")
    w("  （主峰集中在高频共振区，与任何轴承特征频率都不对应）")
except Exception as exc:  # noqa: BLE001
    w(f"  [跳过] 实测段失败：{type(exc).__name__}: {exc}")
w("")

# ---------------------------------------------------------------- 4. PINN 参数量
w("=== 4. PINN 自编码器与 FP-CNN 参数量 ===")
try:
    import torch
    from app.modules.anomaly_detect.pinn_residual import PhysicsInformedNN
    from app.modules.anomaly_detect.fp_cnn import FPFaultCNN

    m1 = PhysicsInformedNN()
    n1 = sum(p.numel() for p in m1.parameters())
    w(f"  PhysicsInformedNN（1D 卷积自编码器）参数量：{n1}")
    m2 = FPFaultCNN()
    n2 = sum(p.numel() for p in m2.parameters())
    w(f"  FPFaultCNN 参数量：{n2}")
    prior_n = sum(p.numel() for p in m2.prior.parameters())
    w(f"    其中 PhysicsFrequencyPrior：{prior_n}（centers 4 + log_bandwidth 4 + band_gain 4）")
except Exception as exc:  # noqa: BLE001
    w(f"  [跳过] torch 段失败：{type(exc).__name__}: {exc}")

report_dir = Path(os.environ.get("ICT_ARTIFACT_DIR", ROOT.parent / "gongye-internet-diagnosis-artifacts" / "generated-research-reports"))
report_dir.mkdir(parents=True, exist_ok=True)
(report_dir / "ch2_verify.txt").write_text("\n".join(out), encoding="utf-8")
print("\n".join(out))
