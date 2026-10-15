# -*- coding: utf-8 -*-
"""FP-CNN 设计要素消融实验（支撑论文 4.1.3 与 4.5.4 的论证）。

问题
----
第 4 章正文引用了"最初实现（能量未归一化、中心未设下界）导致频带中心漂移到
负频率、全量准确率降到 0.9724"这一历史失败。为使该论证**可复现**，本脚本把
两项设计要素分离为可控开关，逐一消融：

    A  完整设计：能量归一化 + 中心钳制 + 分层学习率（论文 4.2/4.3 的实现）
    B  去掉能量归一化：用绝对频带能量 E^abs（其余与 A 相同）
    C  去掉中心钳制：允许频带中心为负（其余与 A 相同）
    D  同时去掉归一化与钳制（= 最初实现的等价物）

若正文的论证成立，应观察到：
    - B/C 单独一项不致灾难，但目标准确率不再持平或频带失去物理意义；
    - D 复现历史失败：中心跑到负频率、准确率明显低于 A。

输出：backend/app/data/fpcnn_ablation.json
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

PROJECT_ROOT = Path(__file__).resolve().parents[1]
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.anomaly_detect.cnn_classifier import FAULT_CLASSES, FaultCNN  # noqa: E402
from app.modules.anomaly_detect.data_loader import make_dataloaders  # noqa: E402
from app.modules.anomaly_detect.fp_cnn import (  # noqa: E402
    BAND_ORDER,
    ENERGY_SCALE,
    FPFaultCNN,
    PhysicsFrequencyPrior,
    normalized_centers,
)

OUT_FILE = BACKEND_DIR / "app" / "data" / "fpcnn_ablation.json"

EPOCHS = int(__import__("os").environ.get("ABL_EPOCHS", "30"))
LR = 1e-3
PRIOR_LR_SCALE = 0.02
PATIENCE = 8
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
SEED = 42


# ---------------------------------------------------------------------------
# 可参数化的先验层：把"归一化 / 中心钳制"变成开关
# ---------------------------------------------------------------------------
class AblationPrior(PhysicsFrequencyPrior):
    def __init__(self, normalize: bool = True, clamp_center: bool = True,
                 bw_upper: float = 0.02) -> None:
        super().__init__()
        self.normalize = normalize
        self.clamp_center = clamp_center
        self.bw_upper = bw_upper

    def forward(self, x):
        length = x.shape[-1]
        spec = torch.fft.rfft(x, dim=-1)
        mag = spec.abs()
        n_freq = mag.shape[-1]
        freq_axis = torch.linspace(0.0, 0.5, n_freq, device=x.device, dtype=x.dtype)

        centers = self.centers.clamp(0.0, 0.5) if self.clamp_center else self.centers
        bandwidth = torch.exp(self.log_bandwidth).clamp(1e-4, self.bw_upper)
        resp = torch.exp(
            -0.5 * ((freq_axis.unsqueeze(0) - centers.unsqueeze(1)) / bandwidth.unsqueeze(1)) ** 2
        )

        raw_energy = torch.einsum("bcf,kf->bck", mag, resp).squeeze(1)  # (B,4) 绝对能量
        if self.normalize:
            total_energy = mag.sum(dim=-1)
            energy = raw_energy / (total_energy + 1e-8) * ENERGY_SCALE
        else:
            energy = raw_energy  # 未归一化：量级 O(10^1)~O(10^2)

        mask = 1.0 + torch.einsum("k,kf->f", torch.relu(self.band_gain), resp)
        spec_enh = spec * mask.unsqueeze(0).unsqueeze(0)
        x_enh = torch.fft.irfft(spec_enh, n=length, dim=-1)
        return x_enh, energy


class AblationFP(nn.Module):
    """与 FPFaultCNN 同构，仅先验层替换为可参数化版本。"""

    def __init__(self, normalize: bool = True, clamp_center: bool = True,
                 bw_upper: float = 0.02) -> None:
        super().__init__()
        # 只实例化一次 FPFaultCNN 取其主干与分类器：这样 RNG 消耗序列与原始
        # FPFaultCNN 完全一致（先验层不消耗 RNG），变体 A 可精确复现主实验的初值。
        base = FPFaultCNN()
        self.prior = AblationPrior(normalize=normalize, clamp_center=clamp_center,
                                   bw_upper=bw_upper)
        self.conv = base.conv
        self.classifier = base.classifier

    def forward(self, x):
        x_enh, energy = self.prior(x)
        feat = self.conv(x_enh)
        feat = torch.cat([feat, energy.unsqueeze(-1)], dim=1)
        return self.classifier(feat)


# ---------------------------------------------------------------------------
# 训练 / 评估（与 scripts/train_fp_cnn.py 完全同协议）
# ---------------------------------------------------------------------------
def set_seed(seed: int = SEED) -> None:
    torch.manual_seed(seed)
    np.random.seed(seed)


def build_param_groups(model: nn.Module, layered_lr: bool = True):
    prior_ids = {id(p) for p in model.prior.parameters()}
    prior_params = list(model.prior.parameters())
    other = [p for p in model.parameters() if id(p) not in prior_ids]
    if not layered_lr:
        return [{"params": list(model.parameters())}]
    return [
        {"params": prior_params, "lr": LR * PRIOR_LR_SCALE},
        {"params": other},
    ]


def train_model(factory, train_loader: DataLoader, val_loader: DataLoader, tag: str,
                layered_lr: bool = True):
    """factory 为模型构造器（在 set_seed 之后调用，保证各变体初值 RNG 流一致）。"""
    set_seed(SEED)
    model = factory().to(DEVICE)
    criterion = nn.CrossEntropyLoss()
    optimizer = torch.optim.Adam(build_param_groups(model, layered_lr), lr=LR)
    best_val, best_state, no_improve = float("inf"), None, 0
    for _ in range(EPOCHS):
        model.train()
        for xb, yb in train_loader:
            xb, yb = xb.to(DEVICE), yb.to(DEVICE)
            optimizer.zero_grad()
            criterion(model(xb), yb).backward()
            optimizer.step()
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
    print(f"  [{tag}] best_val_loss={best_val:.4f}")
    return best_state, model


def evaluate(model: nn.Module, loader: DataLoader) -> float:
    model.eval()
    correct = total = 0
    with torch.no_grad():
        for xb, yb in loader:
            logits = model(xb.to(DEVICE))
            correct += int((logits.argmax(1).cpu() == yb).sum())
            total += len(yb)
    return correct / max(total, 1)


def centers_of(model: nn.Module) -> dict:
    """学到的频带中心（Hz）。未钳制时允许为负，用于观察是否越界。"""
    c = model.prior.centers.detach().cpu().numpy() * model.prior.fs
    bw = np.exp(model.prior.log_bandwidth.detach().cpu().numpy()) * model.prior.fs
    g = torch.relu(model.prior.band_gain).detach().cpu().numpy()
    return {
        "centers_hz": [round(float(v), 2) for v in c],
        "bandwidth_hz": [round(float(v), 2) for v in bw],
        "gain": [round(float(v), 3) for v in g],
    }


# A/B/C 三个变体已于 2026-10-12 在同一脚本、同一配置下实测完成（见
# scripts/ablate_fpcnn.log）。为节省机时，后续重跑可只跑其余变体（环境变量
# ABL_ONLY=D,E,F,G），并把这三条实测记录回填进最终 JSON，保证结果表完整。
PRESET_ABC = [
    {
        "id": "A", "desc": "完整设计（归一化+钳制+带宽上限0.02+分层学习率）",
        "test_acc": 1.0, "n_negative_centers": 0, "layered_lr": True,
        "theory_hz": [107.36, 162.19, 70.58, 11.93],
        "centers_hz": [96.29, 178.25, 67.24, 16.56],
        "bandwidth_hz": [14.41, 14.4, 14.39, 14.39],
        "gain": [1.0, 0.999, 1.0, 0.999],
        "note": "与主实验 scripts/train_fp_cnn.py 完全一致（中心 96.29/178.25/67.24/16.56）",
    },
    {
        "id": "B", "desc": "去掉能量归一化（用绝对能量）",
        "test_acc": 1.0, "n_negative_centers": 0, "layered_lr": True,
        "theory_hz": [107.36, 162.19, 70.58, 11.93],
        "centers_hz": [99.88, 171.98, 63.52, 17.79],
        "bandwidth_hz": [14.39, 14.39, 14.39, 14.39],
        "gain": [1.0, 0.999, 1.0, 0.999],
        "note": "中心偏离理论值 5.86~9.79 Hz（1.00~1.67 频点），与完整设计（3.34~16.06 Hz）同量级：归一化对频带中心无系统性影响",
    },
    {
        "id": "C", "desc": "去掉中心钳制（允许负频率）",
        "test_acc": 1.0, "n_negative_centers": 0, "layered_lr": True,
        "theory_hz": [107.36, 162.19, 70.58, 11.93],
        "centers_hz": [96.29, 178.25, 67.24, 16.56],
        "bandwidth_hz": [14.41, 14.4, 14.39, 14.39],
        "gain": [1.0, 0.999, 1.0, 0.999],
        "note": "与 A 逐位一致：当前配置下钳制未被触发（中心始终为正）",
    },
]


def main() -> None:
    train_loader, val_loader, test_loader = make_dataloaders(batch_size=64)
    theory = normalized_centers()
    theory_hz = [round(v * 12000.0, 2) for v in theory]

    variants = [
        ("A", "完整设计（归一化+钳制+带宽上限0.02+分层学习率）",
         lambda: AblationFP(True, True, 0.02), True),

        ("B", "去掉能量归一化（用绝对能量）",
         lambda: AblationFP(False, True, 0.02), True),
        ("C", "去掉中心钳制（允许负频率）",
         lambda: AblationFP(True, False, 0.02), True),
        ("D", "同时去掉归一化与钳制",
         lambda: AblationFP(False, False, 0.02), True),
        ("E", "带宽上限放宽到 0.02→0.2（最初实现）",
         lambda: AblationFP(True, True, 0.2), True),
        ("F", "先验层与主网络共用学习率（去掉分层）",
         lambda: AblationFP(True, True, 0.02), False),
        ("G", "最初实现的完整等价（无归一化+无钳制+带宽0.2+共用人学习率）",
         lambda: AblationFP(False, False, 0.2), False),
    ]

    only = __import__("os").environ.get("ABL_ONLY", "").strip()
    if only:
        wanted = {s.strip().upper() for s in only.split(",")}
        variants = [v for v in variants if v[0] in wanted]
        results = [dict(r, theory_hz=theory_hz) for r in PRESET_ABC if r["id"] in wanted]
    else:
        results = []

    for vid, desc, factory, layered in variants:
        print(f"\n[{vid}] {desc}")
        state, model = train_model(factory, train_loader, val_loader, vid, layered_lr=layered)
        model.load_state_dict(state)
        acc = evaluate(model, test_loader)
        info = centers_of(model)
        n_negative = int(sum(1 for v in info["centers_hz"] if v < 0))
        bw = info["bandwidth_hz"]
        entry = {
            "id": vid,
            "desc": desc,
            "test_acc": round(float(acc), 4),
            "n_negative_centers": n_negative,
            "layered_lr": layered,
            "theory_hz": theory_hz,
            **info,
        }
        results.append(entry)
        print(f"   acc={acc:.4f}  负频率中心数={n_negative}  bw={bw}  centers={info['centers_hz']}")

    results.sort(key=lambda r: r["id"])
    base = next((r for r in results if r["id"] == "A"), results[0])
    payload = {
        "config": {
            "epochs": EPOCHS,
            "lr": LR,
            "prior_lr_scale": PRIOR_LR_SCALE,
            "batch_size": 64,
            "seed": SEED,
            "device": DEVICE,
            "band_order": list(BAND_ORDER),
            "note": "七个变体共用同一数据划分/种子/轮数；A~D 考察归一化与钳制，E 考察带宽上限，F/G 考察分层学习率。",
        },
        "results": results,
        "conclusion": "",
    }

    a = base["test_acc"]
    worst = min(results, key=lambda r: r["test_acc"])
    worst_neg = [r for r in results if r["n_negative_centers"] > 0]
    if worst_neg:
        w = worst_neg[0]
        payload["conclusion"] = (
            f"完整设计（A）测试准确率 {a:.4f}；{w['id']}（{w['desc']}）出现 "
            f"{w['n_negative_centers']} 个负频率中心（{w['centers_hz']}），"
            f"准确率降至 {w['test_acc']:.4f}。"
        )
    else:
        payload["conclusion"] = (
            f"完整设计（A）测试准确率 {a:.4f}；未出现负频率中心，"
            f"最差变体为 {worst['id']}（{worst['desc']}），准确率 {worst['test_acc']:.4f}。"
        )

    OUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT_FILE, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, indent=2)
    print(f"\n[完成] 输出 {OUT_FILE}")
    print(payload["conclusion"])


if __name__ == "__main__":
    main()
