# -*- coding: utf-8 -*-
"""CWRU 轴承故障 信号处理诊断分析脚本。

数据：datasets/CWRU/processed.npz（11754 段振动信号，每段 2048 点，驱动端 12kHz）
  - 4 类：Normal / IR(内圈) / OR(外圈) / Ball(滚动体)
  - 元数据：severity（故障直径 007/014/021 英寸）、horsepower（负载 0~3HP）

纯 numpy + sklearn（仅 t-SNE 降维）实现。输出「信号层」完整诊断证据链 JSON：

  1. overview          样本规模 + 类别分布 + 故障直径分布
  2. time_domain       时域波形（4 类各 1 条代表振动）
  3. frequency_domain  频域幅值谱（4 类平均谱，特征频率区 0~1000Hz）
  4. tsne              特征空间可分性（PCA→t-SNE 二维嵌入）
  5. severity_heatmap  故障严重度梯度（正常→0.007→0.014→0.021 平均谱）

用法：
    python scripts/analyze_cwru.py
"""
from __future__ import annotations

import json
import os

import numpy as np

DATA_PATH = r"d:\企业云系统\工业互联网系统\datasets\CWRU\processed.npz"
OUT_DIR = r"d:\企业云系统\工业互联网系统\backend\app\data"
OUT_FILE = os.path.join(OUT_DIR, "cwru_signal.json")

# CWRU 驱动端(DE)采样率（公开标准），用于时间轴与频率轴换算
FS = 12000.0
# 频谱展示上限（特征频率集中在 0~1000Hz 内）
FREQ_CAP = 1000.0
# 时域波形下采样点数（前端绘图）
WAVE_POINTS = 256

CLASS_LABEL = {"Normal": "正常", "IR": "内圈故障", "OR": "外圈故障", "Ball": "滚动体故障"}


def load() -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    d = np.load(DATA_PATH)
    return d["X"], d["Y"], d["severity"]


def build_overview(y: np.ndarray, sev: np.ndarray) -> dict:
    from collections import Counter
    class_dist = Counter(y.tolist())
    sev_dist = Counter(x for x in sev.tolist() if x)
    return {
        "n_samples": int(len(y)),
        "n_points": WAVE_POINTS,
        "fs": int(FS),
        "class_dist": [{"name": k, "label": CLASS_LABEL[k], "value": int(v)}
                       for k, v in sorted(class_dist.items())],
        "severity_dist": [{"name": f"0.{k} in", "value": int(v)}
                          for k, v in sorted(sev_dist.items())],
    }


def build_time_domain(x: np.ndarray, y: np.ndarray) -> dict:
    """每类取 1 条代表波形（该类第一段），下采样到 WAVE_POINTS 点。"""
    t = np.arange(x.shape[2]) / FS * 1000.0  # 毫秒
    idx = np.linspace(0, x.shape[2] - 1, WAVE_POINTS, dtype=int)
    waves = []
    for cls in ["Normal", "IR", "OR", "Ball"]:
        first = np.where(y == cls)[0][0]
        waves.append({
            "name": cls,
            "label": CLASS_LABEL[cls],
            "t_ms": [round(float(v), 4) for v in t[idx]],
            "wave": [round(float(v), 4) for v in x[first, 0, :][idx]],
        })
    return {"waves": waves}


def avg_spectrum(x_cls: np.ndarray, cap: float = FREQ_CAP) -> tuple[np.ndarray, np.ndarray]:
    """对某一类所有样本的 |FFT| 求平均，返回 (频率, 平均幅值)。"""
    n = x_cls.shape[2]
    freqs = np.fft.rfftfreq(n, 1.0 / FS)
    mask = freqs <= cap
    amps = np.abs(np.fft.rfft(x_cls[:, 0, :], axis=1)).mean(axis=0)
    return freqs[mask], amps[mask]


def build_frequency_domain(x: np.ndarray, y: np.ndarray) -> dict:
    """4 类平均幅值谱（归一化到各自峰值，便于对比特征频率位置）。"""
    freqs = None
    spectra = []
    for cls in ["Normal", "IR", "OR", "Ball"]:
        x_cls = x[y == cls]
        f, amp = avg_spectrum(x_cls)
        freqs = f
        amp_n = amp / (amp.max() or 1.0)
        spectra.append({
            "name": cls,
            "label": CLASS_LABEL[cls],
            "freqs": [round(float(v), 1) for v in f[::2]],  # 降采样一半
            "amp": [round(float(v), 4) for v in amp_n[::2]],
        })
    return {
        "freqs": [round(float(v), 1) for v in freqs[::2]],
        "spectra": spectra,
    }


def build_tsne(x: np.ndarray, y: np.ndarray, per_class: int = 500) -> dict:
    """PCA(30) → t-SNE(2) 二维嵌入，证明原始信号特征空间可分。"""
    from sklearn.decomposition import PCA
    from sklearn.manifold import TSNE

    rng = np.random.default_rng(42)
    sel_idx = []
    for cls in ["Normal", "IR", "OR", "Ball"]:
        cls_idx = np.where(y == cls)[0]
        if len(cls_idx) > per_class:
            cls_idx = rng.choice(cls_idx, per_class, replace=False)
        sel_idx.append(cls_idx)
    idx = np.concatenate(sel_idx)
    x_sel = x[idx, 0, :]

    x_pca = PCA(n_components=30, random_state=42).fit_transform(x_sel)
    x_tsne = TSNE(n_components=2, random_state=42, perplexity=30,
                  init="pca", learning_rate="auto").fit_transform(x_pca)
    return {
        "points": [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in x_tsne],
        "labels": y[idx].tolist(),
        "class_names": ["Normal", "IR", "OR", "Ball"],
    }


def build_severity_heatmap(x: np.ndarray, y: np.ndarray, sev: np.ndarray) -> dict:
    """以「正常 → 轻(0.007) → 中(0.014) → 重(0.021)」为行，
    展示内圈(IR)故障平均谱随故障直径增大的演化（0~800Hz 特征频率区）。"""
    rows = [("正常", x[y == "Normal"])]
    for s in ["007", "014", "021"]:
        mask = (y == "IR") & (sev == s)
        rows.append((f"0.{s} in", x[mask]))

    freqs = None
    matrix = []
    for _, x_cls in rows:
        f, amp = avg_spectrum(x_cls, cap=800.0)
        freqs = f
        amp_n = amp / (amp.max() or 1.0)
        matrix.append([round(float(v), 4) for v in amp_n[::2]])

    return {
        "freqs": [round(float(v), 1) for v in freqs[::2]],
        "rows": [r[0] for r in rows],
        "matrix": matrix,
    }


def main() -> None:
    x, y, sev = load()
    print(f"[数据] X={x.shape}, 类别={sorted(set(y.tolist()))}")

    result = {
        "overview": build_overview(y, sev),
        "time_domain": build_time_domain(x, y),
        "frequency_domain": build_frequency_domain(x, y),
        "tsne": build_tsne(x, y),
        "severity_heatmap": build_severity_heatmap(x, y, sev),
    }

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False)

    print(f"[完成] 类别分布: {result['overview']['class_dist']}")
    print(f"[完成] t-SNE 点: {len(result['tsne']['points'])}")
    print(f"[完成] 输出 -> {OUT_FILE}")


if __name__ == "__main__":
    main()