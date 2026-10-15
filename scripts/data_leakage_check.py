"""数据划分无泄漏自检。

验证：
1. 按物理文件切分后 train/val/test 三个集合的 file_ids 两两交集为空（无泄漏）；
2. 训练好的 CNN 在 train / test 上的准确率差距；
3. 从 test 集每类抽 5 条（共 20 条）打印真实/预测/4 类置信度分布；
4. 输出 4x4 混淆矩阵。

用法: python scripts/data_leakage_check.py
"""
from __future__ import annotations

import sys
from pathlib import Path

import numpy as np
import torch
from sklearn.metrics import confusion_matrix

PROJECT_ROOT = Path(__file__).resolve().parent.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.anomaly_detect.cnn_classifier import LABEL_NAMES, FaultCNN  # noqa: E402
from app.modules.anomaly_detect.data_loader import (  # noqa: E402
    load_npz,
    map_labels,
    stratified_file_split,
)

MODEL_PATH = PROJECT_ROOT / "models" / "cnn_bearing.pt"


def predict_probs(model: FaultCNN, X: np.ndarray, batch_size: int = 256) -> np.ndarray:
    """批量前向，返回 (N, 4) 的 softmax 概率。"""
    model.eval()
    X_t = torch.from_numpy(np.ascontiguousarray(X, dtype=np.float32))
    probs_list = []
    with torch.no_grad():
        for i in range(0, X_t.size(0), batch_size):
            logits = model(X_t[i:i + batch_size])
            probs_list.append(torch.softmax(logits, dim=1).numpy())
    return np.concatenate(probs_list, axis=0)


def main() -> None:
    X, Y_str, file_ids = load_npz()
    Y = map_labels(Y_str)

    (train_d, val_d, test_d), (train_idx, val_idx, test_idx) = stratified_file_split(
        X, Y, file_ids, train_ratio=0.7, val_ratio=0.15, seed=42
    )
    X_train, y_train = train_d
    X_test, y_test = test_d

    # 1) 各集合 file_ids
    train_files = set(file_ids[train_idx].tolist())
    val_files = set(file_ids[val_idx].tolist())
    test_files = set(file_ids[test_idx].tolist())
    print("=" * 70)
    print("1) 各集合的 file_ids 集合")
    print(f"   train files ({len(train_files)}): {sorted(train_files)}")
    print(f"   val   files ({len(val_files)}): {sorted(val_files)}")
    print(f"   test  files ({len(test_files)}): {sorted(test_files)}")

    # 2) 交集检查
    print("\n2) 两两交集（应均为空集）")
    print(f"   train ∩ val       = {sorted(train_files & val_files)}")
    print(f"   train ∩ test      = {sorted(train_files & test_files)}")
    print(f"   val   ∩ test      = {sorted(val_files & test_files)}")
    print(f"   train ∩ val ∩ test= {sorted(train_files & val_files & test_files)}")
    assert not (train_files & test_files), "train/test 存在数据泄漏！"
    assert not (train_files & val_files & test_files), "三集合存在泄漏！"
    print("   ✅ 无泄漏：三集合交集为空集，file 级别严格隔离")

    # 3) 准确率差距
    model = FaultCNN()
    model.load_state_dict(torch.load(MODEL_PATH, map_location="cpu"))
    model.eval()

    train_probs = predict_probs(model, X_train)
    test_probs = predict_probs(model, X_test)
    train_pred = train_probs.argmax(axis=1)
    test_pred = test_probs.argmax(axis=1)
    train_acc = float((train_pred == y_train).mean())
    test_acc = float((test_pred == y_test).mean())
    gap = abs(train_acc - test_acc)

    print("\n" + "=" * 70)
    print(f"3) 准确率  train_acc={train_acc:.4f}  test_acc={test_acc:.4f}")
    print(f"   差距 = {gap:.4f}  ->  {'✅ < 2%' if gap < 0.02 else '⚠️ >= 2%'}")

    # 4) 每类抽 5 条
    print("\n" + "=" * 70)
    print("4) 每类抽 5 条测试样本的真实/预测标签与 4 类置信度")
    print(f"   {'idx':<6}{'真实':>8}{'预测':>8}  " + "".join(f"{n:>9}" for n in LABEL_NAMES) + "  判定")
    for cls in range(4):
        idxs = np.where(y_test == cls)[0]
        rng = np.random.default_rng(cls)
        chosen = rng.choice(idxs, size=min(5, len(idxs)), replace=False)
        for j in chosen:
            p = test_probs[j]
            pstr = "".join(f"{v:9.4f}" for v in p)
            maxp = float(p.max())
            tag = "高置信(>0.9)" if maxp > 0.9 else ("摇摆(0.4~0.7)" if 0.4 <= maxp <= 0.7 else "中等")
            print(
                f"   {int(j):<6}{LABEL_NAMES[y_test[j]]:>8}{LABEL_NAMES[test_pred[j]]:>8}  {pstr}  {tag}"
            )

    # 5) 混淆矩阵
    cm = confusion_matrix(y_test, test_pred)
    print("\n" + "=" * 70)
    print("5) 4x4 混淆矩阵（行=真实，列=预测）")
    print("     " + "".join(f"{n:>8}" for n in LABEL_NAMES))
    for i, row in enumerate(cm):
        print(f"{LABEL_NAMES[i]:>8}" + "".join(f"{v:>8}" for v in row))
    print("=" * 70)


if __name__ == "__main__":
    main()