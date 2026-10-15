"""域漂移强度探针（调参用，不产出最终结果）。

用途：在正式跑 domain_adapt_cwru.py 之前，先快速试探"目标域该构造多强的漂移"。

判据：
  · V0（源域直接迁移）应当**明显低于源域准确率**，但不能低到随机水平（25%），
    否则说明漂移过强、模型已完全失效，自适应也无从补起；
  · Oracle（目标域带标签训练）应当接近 100%，说明目标域本身是可学习的，
    差距纯粹来自分布漂移而非"数据不可分"。

理想区间：V0 ≈ 45%~60%，Oracle ≈ 95%+。
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, TensorDataset

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "backend" / "app"))
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(ROOT / "scripts"))

from modules.anomaly_detect.cnn_classifier import FaultCNN  # noqa: E402
from modules.anomaly_detect.data_loader import (  # noqa: E402
    load_npz, map_labels, stratified_file_split,
)

import domain_adapt_cwru as da  # noqa: E402

EPOCHS = int(sys.argv[1]) if len(sys.argv) > 1 else 12


def train(model, X, y, epochs=EPOCHS, bs=128, lr=1e-3):
    opt = torch.optim.Adam(model.parameters(), lr=lr)
    ce = nn.CrossEntropyLoss()
    ld = DataLoader(TensorDataset(torch.from_numpy(X), torch.from_numpy(y)),
                    batch_size=bs, shuffle=True, drop_last=True)
    model.train()
    for _ in range(epochs):
        for xb, yb in ld:
            opt.zero_grad()
            ce(model(xb), yb).backward()
            opt.step()
    return model


def acc(model, X, y):
    model.eval()
    with torch.no_grad():
        p = model(torch.from_numpy(X)).argmax(1).numpy()
    return float((p == y).mean())


def main():
    X, Y_str, file_ids = load_npz()
    y = map_labels(Y_str)
    (tr, va, te), _ = stratified_file_split(X, y, file_ids, 0.7, 0.15, 42)
    Xs, ys = tr
    Xs_te, ys_te = te

    print("训练源域模型（CWRU）…")
    src_model = train(FaultCNN(), Xs, ys)
    print(f"  源域测试准确率 = {acc(src_model, Xs_te, ys_te):.4f}")

    base = list(da.DEVICE_PROFILES.keys())
    candidates = {
        "A：真实转速 + 高信噪比 + 弱共振整形": [
            {"shaft_rpm": 1480.0, "resonance_hz": 3900.0, "snr_db": 14.0, "sensor_gain": 1.00, "transfer_q": 1.4},
            {"shaft_rpm": 2400.0, "resonance_hz": 4500.0, "snr_db": 16.0, "sensor_gain": 1.10, "transfer_q": 1.5},
            {"shaft_rpm": 1450.0, "resonance_hz": 3600.0, "snr_db": 13.0, "sensor_gain": 0.95, "transfer_q": 1.4},
        ],
        "B：同上 + 更高信噪比 + 更弱共振整形": [
            {"shaft_rpm": 1480.0, "resonance_hz": 4000.0, "snr_db": 18.0, "sensor_gain": 1.00, "transfer_q": 1.1},
            {"shaft_rpm": 2400.0, "resonance_hz": 4400.0, "snr_db": 20.0, "sensor_gain": 1.08, "transfer_q": 1.2},
            {"shaft_rpm": 1450.0, "resonance_hz": 3800.0, "snr_db": 17.0, "sensor_gain": 0.95, "transfer_q": 1.1},
        ],
        "C：真实转速 + 中信噪比 + 中共振整形": [
            {"shaft_rpm": 1480.0, "resonance_hz": 3600.0, "snr_db": 11.0, "sensor_gain": 1.05, "transfer_q": 1.8},
            {"shaft_rpm": 2400.0, "resonance_hz": 4700.0, "snr_db": 13.0, "sensor_gain": 1.15, "transfer_q": 1.8},
            {"shaft_rpm": 1450.0, "resonance_hz": 3400.0, "snr_db": 10.0, "sensor_gain": 0.92, "transfer_q": 1.8},
        ],
    }

    for tag, overrides in candidates.items():
        print(f"\n=== {tag} ===")
        v0s = []
        Xall, yall = [], []
        for dev, ov in zip(base, overrides):
            prof = dict(da.DEVICE_PROFILES[dev]); prof.update(ov)
            rng = np.random.RandomState(da._seed_of(dev))
            idx = rng.choice(len(Xs), size=900, replace=False)
            Xt = da.transform_to_device(Xs[idx], prof, rng)
            yt = ys[idx]
            v0 = acc(src_model, Xt[:300], yt[:300])
            v0s.append(v0)
            Xall.append(Xt); yall.append(yt)
            print(f"  {dev:<9} V0={v0:.4f}  转速比={prof['shaft_rpm']/1797:.3f} "
                  f"共振={prof['resonance_hz']:.0f}Hz SNR={prof['snr_db']:+.0f}dB q={prof.get('transfer_q')}")
        v0m = float(np.mean(v0s))
        torch.manual_seed(42)
        oracle = train(FaultCNN(), np.concatenate(Xall), np.concatenate(yall))
        oa = acc(oracle, Xall[0][:300], yall[0][:300])
        verdict = 'OK' if 0.40 <= v0m <= 0.62 else ('过强' if v0m < 0.40 else '过弱')
        print(f"  → V0 宏平均 = {v0m:.4f}   Oracle = {oa:.4f}   判定：V0 {verdict}")


if __name__ == "__main__":
    main()
