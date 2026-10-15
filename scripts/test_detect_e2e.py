"""异常检测端到端验证：真实 CWRU 窗口走 service.detect 全链路。

对 4 类（Normal / IR / OR / Ball）各取 1 条真实窗口，调用 service.detect，
打印真实标签、CNN 分类结果与置信度、PINN 残差、健康分、cnn_source/pinn_source，
并验证：
    - 至少 3/4 被正确分类
    - cnn_source 与 pinn_source 均为 "trained_model"
    - Normal 的 health_score > 90
    - 故障（IR/OR/Ball）的 health_score < 60

用法: python scripts/test_detect_e2e.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.anomaly_detect.cnn_classifier import FAULT_CLASSES, LABEL_NAMES  # noqa: E402
from app.modules.anomaly_detect.data_loader import load_npz, map_labels  # noqa: E402
from app.modules.anomaly_detect.service import anomaly_detect_service  # noqa: E402


def main() -> None:
    X, Y_str, _ = load_npz()
    Y = map_labels(Y_str)

    print("=" * 70)
    print("端到端验证：service.detect(Normal/IR/OR/Ball 各 1 条真实窗口)")
    print("=" * 70)

    correct = 0
    cnn_sources: list[str] = []
    pinn_sources: list[str] = []
    health_scores: list[float] = []

    for cls in range(4):
        idxs = np.where(Y == cls)[0]
        # 取该类中间位置的样本，更具代表性
        idx = int(idxs[len(idxs) // 2])
        # 一条真实窗口的 2048 个振动点 -> list[dict]
        window = [{"vibration": float(v)} for v in X[idx][0].tolist()]

        res = anomaly_detect_service.detect(f"e2e-dev-{cls}", window)

        true_type = FAULT_CLASSES[cls]
        pred_type = res["cnn"]["fault_type"]
        ok = pred_type == true_type
        if ok:
            correct += 1

        cnn_source = res["cnn_source"]
        pinn_source = res["pinn_source"]
        health_score = res["health"]["health_score"]
        cnn_sources.append(cnn_source)
        pinn_sources.append(pinn_source)
        health_scores.append(health_score)

        print(f"\n--- 样本 {cls} : 真实 {LABEL_NAMES[cls]} ({true_type}) ---")
        print(f"  输入真实标签     : {LABEL_NAMES[cls]}")
        print(
            f"  CNN 分类         : {pred_type} ({res['cnn']['fault_label']}) "
            f"conf={res['cnn']['confidence']:.4f}  {'[OK] 正确' if ok else '[FAIL] 错误'}"
        )
        probs = res["cnn"]["probabilities"]
        print("  4 类置信度       : " + ", ".join(f"{k}={v:.4f}" for k, v in probs.items()))
        print(f"  PINN 残差 residual : {res['pinn'].get('residual')}")
        print(f"  health_score     : {health_score} ({res['health']['level_label']})")
        print(f"  cnn_source       : {cnn_source}")
        print(f"  pinn_source      : {pinn_source}")

    # Normal 是第 0 个样本，故障是 1/2/3
    normal_h = health_scores[0]
    fault_h = health_scores[1:]

    all_cnn_trained = all(s == "trained_model" for s in cnn_sources)
    all_pinn_trained = all(s == "trained_model" for s in pinn_sources)
    normal_ok = normal_h > 90
    fault_ok = all(h < 60 for h in fault_h)

    print("\n" + "=" * 70)
    print(f"正确分类 {correct}/4            {'[OK] 通过(≥3/4)' if correct >= 3 else '[FAIL] 未通过(<3/4)'}")
    print(f"cnn_source 全部为 trained_model : {all_cnn_trained}  ({cnn_sources})")
    print(f"pinn_source 全部为 trained_model: {all_pinn_trained}  ({pinn_sources})")
    print(f"Normal health_score > 90        : {normal_ok}  ({normal_h})")
    print(f"故障 health_score 全部 < 60     : {fault_ok}  ({fault_h})")
    print("=" * 70)

    if not (correct >= 3 and all_cnn_trained and all_pinn_trained and normal_ok and fault_ok):
        sys.exit(1)


if __name__ == "__main__":
    main()