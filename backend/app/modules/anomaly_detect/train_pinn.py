"""训练 PINN 物理残差基线（CWRU Normal 工况自编码器）。

只加载 Normal 类窗口训练自编码器，学习重构正常振动信号。
保存 models/pinn_baseline.pt，并在故障类上评估残差分离度。

用法:
    cd backend
    python -m app.modules.anomaly_detect.train_pinn
    或
    python app/modules/anomaly_detect/train_pinn.py

训练细节:
    - 损失 = MSE(输入, 重构) + λ * MSE(RMS(重构), RMS(输入))
    - λ=0.1，50 epoch，Adam(lr=1e-3)，early stopping patience=10
    - batch_size=64
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

# 使 `from app.modules...` 可用（backend 目录加入 sys.path）
BACKEND_DIR = Path(__file__).resolve().parents[3]
PROJECT_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.anomaly_detect.data_loader import load_npz, map_labels  # noqa: E402
from app.modules.anomaly_detect.pinn_residual import (  # noqa: E402
    PINN_WEIGHT_PATH,
    PinnResidualGenerator,
)

MODEL_PATH = PROJECT_ROOT / "models" / "pinn_baseline.pt"

EPOCHS = 50
LR = 1e-3
BATCH_SIZE = 64
PHYSICS_WEIGHT = 0.1
PATIENCE = 10


def mean_residual_rms(gen: PinnResidualGenerator, X: np.ndarray, batch: int = 512):
    """批量计算每个窗口的残差 RMS，返回 (均值, 数组)。"""
    model = gen.model
    model.eval()
    rms_list = []
    with torch.no_grad():
        for i in range(0, X.shape[0], batch):
            xb = torch.from_numpy(np.ascontiguousarray(X[i:i + batch], dtype=np.float32))
            recon = model(xb)
            r = torch.sqrt(torch.mean((xb - recon) ** 2, dim=(1, 2)))
            rms_list.append(r.numpy())
    rms = np.concatenate(rms_list)
    return float(rms.mean()), rms


def main() -> None:
    X, Y_str, _ = load_npz()
    Y = map_labels(Y_str)  # {0=Normal,1=IR,2=OR,3=Ball}

    normal_mask = Y == 0
    X_normal = X[normal_mask]
    print("=" * 70)
    print(f"PINN 训练：仅用 Normal 窗口 {X_normal.shape[0]} 个")
    print("=" * 70)

    # 85/15 切分 train/val（早停用），val 不参与梯度更新
    rng = np.random.default_rng(42)
    perm = rng.permutation(X_normal.shape[0])
    n_train = int(X_normal.shape[0] * 0.85)
    X_train = X_normal[perm[:n_train]]
    X_val = X_normal[perm[n_train:]]
    print(f"  train={X_train.shape[0]}  val={X_val.shape[0]}")

    # 训练
    gen = PinnResidualGenerator()
    history = gen.train(
        X_train,
        epochs=EPOCHS,
        lr=LR,
        batch_size=BATCH_SIZE,
        physics_weight=PHYSICS_WEIGHT,
        val_windows=X_val,
        patience=PATIENCE,
    )
    gen.save(str(MODEL_PATH))
    kb = MODEL_PATH.stat().st_size / 1024
    print(f"\n[OK] 已保存 PINN 权重: {MODEL_PATH} ({kb:.1f} KB)  "
          f"{'(>100KB)' if kb > 100 else '[WARN] 偏小'}")

    # 用刚保存的权重重新加载，确保复原后再评估
    gen2 = PinnResidualGenerator()
    gen2.load(str(MODEL_PATH))

    # 残差评估：Normal(val 未参与训练) vs IR/OR/Ball
    print("\n" + "=" * 70)
    print("残差分离度评估（残差 RMS，越小越接近正常基线）")
    print("=" * 70)

    normal_mean, normal_rms = mean_residual_rms(gen2, X_val)
    print(f"  Normal (val {X_val.shape[0]}): mean={normal_mean:.6f}")

    class_names = ["IR", "OR", "Ball"]
    fault_means = []
    for cls, name in zip([1, 2, 3], class_names):
        X_cls = X[Y == cls]
        m, _ = mean_residual_rms(gen2, X_cls)
        fault_means.append(m)
        print(f"  {name:<6} ({X_cls.shape[0]:>3}): mean={m:.6f}")

    fault_mean = float(np.mean(fault_means))
    separation = fault_mean / max(normal_mean, 1e-8)
    print("-" * 70)
    print(f"  故障平均残差 = {fault_mean:.6f}")
    print(f"  分离度 = 故障/正常 = {separation:.3f}")

    if separation >= 2.0:
        print(f"  [OK] 分离度 {separation:.2f} >= 2.0，PINN 能区分正常与故障")
    elif separation >= 1.5:
        print(f"  [WARN] 分离度 {separation:.2f} 在 [1.5, 2.0) 之间，勉强可用")
    else:
        print(f"  [FAIL] 分离度 {separation:.2f} < 1.5 —— PINN 训练失败，需要调整架构")
        sys.exit(1)
    print("=" * 70)


if __name__ == "__main__":
    main()