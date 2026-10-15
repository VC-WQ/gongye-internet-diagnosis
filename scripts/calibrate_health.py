"""健康评分标定与验证：在 test 集（2358 样本）上跑完整评分流水线。

加载训练好的 CNN + PINN 权重，对每个 test 样本计算 health_score，
输出各类的平均分/最低分/最高分与分数分布直方图数据，
验证：Normal 平均分 > 90，故障平均分 < 60。

用法: python scripts/calibrate_health.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.anomaly_detect.cnn_classifier import LABEL_NAMES, FaultCNN  # noqa: E402
from app.modules.anomaly_detect.data_loader import (  # noqa: E402
    load_npz,
    map_labels,
    stratified_file_split,
)
from app.modules.anomaly_detect.health_scorer import health_scorer  # noqa: E402
from app.modules.anomaly_detect.pinn_residual import PinnResidualGenerator  # noqa: E402

CNN_MODEL = PROJECT_ROOT / "models" / "cnn_bearing.pt"
PINN_MODEL = PROJECT_ROOT / "models" / "pinn_baseline.pt"


def predict_probs(model: FaultCNN, X: np.ndarray, batch: int = 512) -> np.ndarray:
    """批量前向，返回 (N, 4) softmax 概率。"""
    model.eval()
    probs_list = []
    with torch.no_grad():
        for i in range(0, X.shape[0], batch):
            xb = torch.from_numpy(np.ascontiguousarray(X[i:i + batch], dtype=np.float32))
            probs_list.append(torch.softmax(model(xb), dim=1).numpy())
    return np.concatenate(probs_list, axis=0)


def residual_rms(pinn: PinnResidualGenerator, X: np.ndarray, batch: int = 512) -> np.ndarray:
    """批量计算每个窗口的残差 RMS，返回 (N,) 数组。"""
    pinn.model.eval()
    rms_list = []
    with torch.no_grad():
        for i in range(0, X.shape[0], batch):
            xb = torch.from_numpy(np.ascontiguousarray(X[i:i + batch], dtype=np.float32))
            recon = pinn.model(xb)
            r = torch.sqrt(torch.mean((xb - recon) ** 2, dim=(1, 2)))
            rms_list.append(r.numpy())
    return np.concatenate(rms_list)


def main() -> None:
    X, Y_str, file_ids = load_npz()
    Y = map_labels(Y_str)
    (_, _, test_d), (_, _, _) = stratified_file_split(X, Y, file_ids, 0.7, 0.15, 42)
    X_test, y_test = test_d

    cnn = FaultCNN()
    cnn.load_state_dict(torch.load(CNN_MODEL, map_location="cpu"))
    cnn.eval()

    pinn = PinnResidualGenerator()
    pinn.load(str(PINN_MODEL))

    probs = predict_probs(cnn, X_test)
    rms = residual_rms(pinn, X_test)

    health_list = []
    for i in range(X_test.shape[0]):
        cnn_result = {"probabilities": {"normal": float(probs[i, 0])}, "cnn_source": "trained_model"}
        pinn_result = {"residual": float(rms[i]), "pinn_source": "trained_model"}
        h = health_scorer.score(pinn_result, cnn_result)
        health_list.append(h["health_score"])
    health = np.asarray(health_list)

    print("=" * 70)
    print("健康分标定结果（test 集全部样本）")
    print("=" * 70)

    stats = {}
    for cls in range(4):
        hc = health[y_test == cls]
        stats[cls] = hc
        tag = "Normal" if cls == 0 else "故障"
        print(
            f"  {LABEL_NAMES[cls]:<8} ({tag}): n={hc.shape[0]:>4}  "
            f"mean={hc.mean():.2f}  min={hc.min():.2f}  max={hc.max():.2f}"
        )

    normal_h = health[y_test == 0]
    fault_h = health[y_test != 0]
    print("-" * 70)
    print(f"  Normal 平均分 = {normal_h.mean():.2f}  (目标 >90)  {'✅' if normal_h.mean() > 90 else '❌'}")
    print(f"  故障   平均分 = {fault_h.mean():.2f}  (目标 <60)  {'✅' if fault_h.mean() < 60 else '❌'}")

    # 直方图数据（10 分一档）
    print("\n" + "=" * 70)
    print("健康分分布直方图（每 10 分一档）")
    print("=" * 70)
    bins = np.arange(0, 101, 10)
    hist, edges = np.histogram(health, bins=bins)
    print(f"  {'区间':<12}{'全部':>6}   {'Normal':>7}   {'故障':>7}")
    for b in range(len(hist)):
        lo, hi = edges[b], edges[b + 1]
        all_c = hist[b]
        n_c = int(((normal_h >= lo) & (normal_h < hi)).sum())
        f_c = int(((fault_h >= lo) & (fault_h < hi)).sum())
        print(f"  [{lo:>3.0f},{hi:>3.0f}){all_c:>6}   {n_c:>7}   {f_c:>7}")

    print("=" * 70)
    print(f"TOTAL: Normal(samples) avg={normal_h.mean():.2f} | 故障 avg={fault_h.mean():.2f}")


if __name__ == "__main__":
    main()