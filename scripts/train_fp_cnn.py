# -*- coding: utf-8 -*-
"""物理频率先验引导 CNN（FP-CNN）与基线 1D-CNN 的对比实验。

对比维度（每个维度都给出"物理先验带来了什么"的证据）：
  1. 全量数据测试准确率
  2. 少样本学习（训练集 50% / 20% / 10%）—— 物理先验应当缓解数据稀缺
  3. 抗噪鲁棒性（测试集叠加 SNR=10/5/0/-5 dB 噪声）—— 物理先验应当抑制无关频段
  4. 可解释性：FP-CNN 学到的频带中心 vs 轴承理论特征频率（BPFO/BPFI/BSF/FTF）

输出：backend/app/data/fp_cnn_compare.json（供算法实验室页面直接绘制）

用法：
    python scripts/train_fp_cnn.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

BACKEND_DIR = Path(__file__).resolve().parents[1] / "backend"
PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.anomaly_detect.cnn_classifier import (  # noqa: E402
    FAULT_CLASSES,
    LABEL_NAMES,
    FaultCNN,
)
from app.modules.anomaly_detect.data_loader import make_dataloaders  # noqa: E402
from app.modules.anomaly_detect.fp_cnn import FPFaultCNN, theoretical_frequencies  # noqa: E402

OUT_FILE = PROJECT_ROOT / "backend" / "app" / "data" / "fp_cnn_compare.json"

# 轮数可用环境变量覆盖（便于快速冒烟：FP_EPOCHS=3 python scripts/train_fp_cnn.py）
EPOCHS = int(os.environ.get("FP_EPOCHS", "30"))
LR = 1e-3
PATIENCE = 8
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED = 42


def set_seed(seed: int = SEED) -> None:
    torch.manual_seed(seed)
    np.random.seed(seed)


def subset_loader(loader: DataLoader, ratio: float, seed: int = SEED, batch_size: int = 64) -> DataLoader:
    """按比例抽取训练子集（固定随机种子，保证两模型对比公平）。"""
    ds = loader.dataset
    x, y = ds.tensors
    n = len(x)
    rng = np.random.default_rng(seed)
    idx = rng.permutation(n)[: max(8, int(n * ratio))]
    return DataLoader(TensorDataset(x[idx], y[idx]), batch_size=batch_size, shuffle=True)


def evaluate(model: nn.Module, loader: DataLoader, noise_snr: float | None = None) -> tuple[float, np.ndarray, np.ndarray]:
    """评估准确率，可选在输入上叠加指定 SNR(dB) 的高斯噪声。"""
    model.eval()
    correct = total = 0
    preds: list[int] = []
    labels: list[int] = []
    with torch.no_grad():
        for xb, yb in loader:
            xb = xb.to(DEVICE)
            if noise_snr is not None:
                sig_power = float((xb ** 2).mean().item())
                noise_power = sig_power / (10 ** (noise_snr / 10.0))
                xb = xb + torch.randn_like(xb) * float(np.sqrt(noise_power))
            logits = model(xb)
            p = logits.argmax(dim=1).cpu()
            preds.extend(p.numpy().tolist())
            labels.extend(yb.numpy().tolist())
            correct += int((p == yb).sum().item())
            total += len(yb)
    return correct / max(total, 1), np.array(preds), np.array(labels)


def build_param_groups(model: nn.Module):
    """为物理先验参数单独设置更小的学习率。

    频带中心/带宽是归一化频率（量级 ~1e-3），若与主网络共用 1e-3 的学习率，
    单步位移可达十几 Hz —— 四个频带会迅速塌缩到同一位置、失去物理意义。
    这里给先验参数 1/50 的学习率，让它们"围绕理论频率小幅微调"，
    既保留物理先验的可解释性，又允许数据驱动的修正。
    """
    prior_params = []
    other_params = []
    prior = getattr(model, "prior", None)
    prior_ids = set()
    if prior is not None:
        prior_ids = {id(p) for p in prior.parameters()}
        prior_params = list(prior.parameters())
    for p in model.parameters():
        if id(p) not in prior_ids:
            other_params.append(p)
    groups = []
    if prior_params:
        groups.append({"params": prior_params, "lr": LR * 0.02})
    groups.append({"params": other_params})
    return groups


def train_model(model_cls, train_loader: DataLoader, val_loader: DataLoader, tag: str):
    """训练一个模型，返回 (最佳权重 state_dict, 验证最优 epoch)。"""
    set_seed(SEED)
    model = model_cls().to(DEVICE)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(build_param_groups(model), lr=LR)

    best_val = float("inf")
    best_state = None
    no_improve = 0
    for epoch in range(1, EPOCHS + 1):
        model.train()
        for xb, yb in train_loader:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()
        # 验证
        model.eval()
        vloss = 0.0
        with torch.no_grad():
            for xb, yb in val_loader:
                xb, yb = xb.to(DEVICE), yb.to(DEVICE)
                vloss += criterion(model(xb), yb).item() * len(xb)
        vloss /= max(len(val_loader.dataset), 1)
        if vloss < best_val:
            best_val = vloss
            best_state = {k: v.detach().cpu().clone() for k, v in model.state_dict().items()}
            no_improve = 0
        else:
            no_improve += 1
            if no_improve >= PATIENCE:
                break
    print(f"  [{tag}] 训练完成，最佳 val_loss={best_val:.4f}")
    return best_state


def confusion_of(preds: np.ndarray, labels: np.ndarray, n_cls: int) -> list[list[int]]:
    cm = [[0] * n_cls for _ in range(n_cls)]
    for p, l in zip(preds, labels):
        cm[int(l)][int(p)] += 1
    return cm


def main() -> None:
    print(f"设备: {DEVICE}")
    train_loader, val_loader, test_loader = make_dataloaders(batch_size=64)
    n_cls = len(FAULT_CLASSES)

    result: dict = {
        "full": {},
        "few_shot": [],
        "noise": [],
        "confusion": {},
        "bands": {},
        "config": {
            "epochs": EPOCHS,
            "device": DEVICE,
            "classes": list(LABEL_NAMES),
            "note": "基线与 FP-CNN 使用完全相同的数据划分、随机种子与训练轮数，保证对比公平。",
        },
    }

    # ---------- 1. 全量训练与测试 ----------
    print("\n[1/4] 全量数据训练 ...")
    base_state = train_model(FaultCNN, train_loader, val_loader, "基线 1D-CNN")
    fp_state = train_model(FPFaultCNN, train_loader, val_loader, "FP-CNN")

    baseline = FaultCNN().to(DEVICE)
    baseline.load_state_dict(base_state)
    fpnet = FPFaultCNN().to(DEVICE)
    fpnet.load_state_dict(fp_state)

    acc_b, pb, lb = evaluate(baseline, test_loader)
    acc_f, pf, lf = evaluate(fpnet, test_loader)
    result["full"] = {
        "baseline_acc": round(float(acc_b), 4),
        "fp_acc": round(float(acc_f), 4),
        "delta": round(float(acc_f - acc_b), 4),
    }
    result["confusion"] = {
        "baseline": confusion_of(pb, lb, n_cls),
        "fp_cnn": confusion_of(pf, lf, n_cls),
    }
    print(f"  基线 acc={acc_b:.4f} | FP-CNN acc={acc_f:.4f} | Δ={acc_f - acc_b:+.4f}")

    # 保存 FP-CNN 权重，供后续接入在线推理
    models_dir = PROJECT_ROOT / "models"
    models_dir.mkdir(parents=True, exist_ok=True)
    torch.save(fp_state, models_dir / "cnn_bearing_fp.pt")
    print(f"  权重已保存: {models_dir / 'cnn_bearing_fp.pt'}")

    # ---------- 2. 少样本 ----------
    print("\n[2/4] 少样本对比 ...")
    for ratio in (0.5, 0.2, 0.1):
        sub = subset_loader(train_loader, ratio)
        sb = train_model(FaultCNN, sub, val_loader, f"基线@{int(ratio*100)}%")
        sf = train_model(FPFaultCNN, sub, val_loader, f"FP@{int(ratio*100)}%")
        mb = FaultCNN().to(DEVICE); mb.load_state_dict(sb)
        mf = FPFaultCNN().to(DEVICE); mf.load_state_dict(sf)
        ab, _, _ = evaluate(mb, test_loader)
        af, _, _ = evaluate(mf, test_loader)
        result["few_shot"].append({
            "ratio": ratio,
            "n_train": len(sub.dataset),
            "baseline_acc": round(float(ab), 4),
            "fp_acc": round(float(af), 4),
            "delta": round(float(af - ab), 4),
        })
        print(f"  训练比例 {int(ratio*100):>3}%: 基线 {ab:.4f} | FP {af:.4f} | Δ={af-ab:+.4f}")

    # ---------- 3. 抗噪 ----------
    print("\n[3/4] 抗噪对比 ...")
    for snr in (10, 5, 0, -5):
        ab, _, _ = evaluate(baseline, test_loader, noise_snr=float(snr))
        af, _, _ = evaluate(fpnet, test_loader, noise_snr=float(snr))
        result["noise"].append({
            "snr_db": snr,
            "baseline_acc": round(float(ab), 4),
            "fp_acc": round(float(af), 4),
            "delta": round(float(af - ab), 4),
        })
        print(f"  SNR={snr:>3}dB: 基线 {ab:.4f} | FP {af:.4f} | Δ={af-ab:+.4f}")

    # ---------- 4. 可解释性：学到的频带 vs 理论频率 ----------
    print("\n[4/4] 提取学到的物理频带 ...")
    result["bands"] = {
        "theory_hz": {k: round(v, 2) for k, v in theoretical_frequencies().items()},
        "learned": fpnet.prior.learned_vs_theory(),
    }
    print("  理论频率:", result["bands"]["theory_hz"])
    print("  学到频带:", json.dumps(result["bands"]["learned"], ensure_ascii=False))

    # ---------- 输出 ----------
    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"\n[完成] 输出 {OUT_FILE} ({OUT_FILE.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
