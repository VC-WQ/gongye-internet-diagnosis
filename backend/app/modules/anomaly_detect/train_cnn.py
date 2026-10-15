"""1D-CNN 故障分类器训练脚本（CWRU 4 类）。

用法:
    cd backend
    python -m app.modules.anomaly_detect.train_cnn
    或
    python app/modules/anomaly_detect/train_cnn.py

流程:
    加载数据 -> 训练 50 epoch(Adam + CosineAnnealing, early stopping) ->
    test 集评估(准确率/混淆矩阵/precision/recall/f1) -> 保存 models/cnn_bearing.pt
"""
from __future__ import annotations

import sys
import time
from pathlib import Path

import numpy as np
import torch
import torch.nn as nn
from sklearn.metrics import classification_report, confusion_matrix

# 使 `from app.modules...` 可用（backend 目录加入 sys.path）
BACKEND_DIR = Path(__file__).resolve().parents[3]
PROJECT_ROOT = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND_DIR))

from app.modules.anomaly_detect.cnn_classifier import FAULT_CLASSES, FAULT_LABELS_ZH, LABEL_NAMES, FaultCNN  # noqa: E402
from app.modules.anomaly_detect.data_loader import make_dataloaders  # noqa: E402

MODELS_DIR = PROJECT_ROOT / "models"
WEIGHT_PATH = MODELS_DIR / "cnn_bearing.pt"

EPOCHS = 50
LR = 1e-3
PATIENCE = 10
TARGET_ACC = 0.85


def evaluate(model: nn.Module, loader, criterion: nn.Module, device: str) -> tuple[float, float, np.ndarray, np.ndarray]:
    """计算 loss 与准确率，并收集预测/真实标签。"""
    model.eval()
    total_loss = 0.0
    correct = 0
    total = 0
    all_preds: list[int] = []
    all_labels: list[int] = []
    with torch.no_grad():
        for xb, yb in loader:
            xb, yb = xb.to(device), yb.to(device)
            logits = model(xb)
            loss = criterion(logits, yb)
            total_loss += loss.item() * xb.size(0)
            preds = logits.argmax(dim=1)
            correct += (preds == yb).sum().item()
            total += yb.size(0)
            all_preds.extend(preds.cpu().numpy().tolist())
            all_labels.extend(yb.cpu().numpy().tolist())
    acc = correct / max(total, 1)
    avg_loss = total_loss / max(total, 1)
    return avg_loss, acc, np.array(all_preds), np.array(all_labels)


def _report(model: nn.Module, test_loader, criterion: nn.Module, device: str) -> None:
    """加载最佳权重，在 test 集评估并输出报告（训练与 eval-only 共用）。"""
    print(f"\n加载最佳权重 {WEIGHT_PATH} 在 test 集评估...")
    model.load_state_dict(torch.load(WEIGHT_PATH, map_location=device))
    test_loss, test_acc, preds, labels = evaluate(model, test_loader, criterion, device)

    print("=" * 70)
    print(f"Test 总体准确率: {test_acc:.4f}  (目标 >{TARGET_ACC})")
    print("=" * 70)

    # 混淆矩阵
    cm = confusion_matrix(labels, preds)
    print("\n混淆矩阵（行=真实，列=预测，类别顺序见下）:")
    header = "         " + "".join(f"{LABEL_NAMES[i]:>8}" for i in range(len(LABEL_NAMES)))
    print(header)
    for i, row in enumerate(cm):
        print(f"{LABEL_NAMES[i]:>8} " + "".join(f"{v:>8}" for v in row))

    # 每类 precision / recall / f1
    print("\n每类指标:")
    print(classification_report(labels, preds, target_names=LABEL_NAMES, digits=4))

    # 训练后推理验证：取一条测试样本输出 4 类置信度
    print("=" * 70)
    print("推理验证：随机取一条测试样本输出 4 类置信度")
    x_sample, y_sample = next(iter(test_loader))
    x_sample, y_sample = x_sample[0:1].to(device), y_sample[0].item()
    model.eval()
    with torch.no_grad():
        probs = torch.softmax(model(x_sample), dim=1).squeeze(0).cpu().numpy()
    true_label = LABEL_NAMES[y_sample]
    print(f"真实标签: {true_label}")
    for i, cls in enumerate(FAULT_CLASSES):
        print(f"  {cls:<12} ({FAULT_LABELS_ZH[cls]}): {probs[i]:.4f}")

    # 结果判断
    print("=" * 70)
    if test_acc > TARGET_ACC:
        print(f"✅ 达成目标：test accuracy {test_acc:.4f} > {TARGET_ACC}")
    else:
        print(f"⚠️ 未达目标：test accuracy {test_acc:.4f} <= {TARGET_ACC}，建议调参或加数据")
    print(f"✅ 权重文件: {WEIGHT_PATH} ({WEIGHT_PATH.stat().st_size / 1024:.1f} KB)")


def main() -> None:
    eval_only = "--eval-only" in sys.argv
    print("=" * 70)
    print("CWRU 1D-CNN 故障分类训练" if not eval_only else "CWRU 1D-CNN 故障分类评估(仅推理)")
    print(f"权重保存路径: {WEIGHT_PATH}")
    print("=" * 70)

    train_loader, val_loader, test_loader = make_dataloaders(batch_size=64)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    print(f"训练设备: {device}")

    model = FaultCNN().to(device)
    criterion = nn.CrossEntropyLoss()

    if eval_only:
        if not WEIGHT_PATH.exists():
            print(f"错误：权重文件不存在 {WEIGHT_PATH}，请先运行训练")
            sys.exit(1)
        _report(model, test_loader, criterion, device)
        return

    optimizer = torch.optim.Adam(model.parameters(), lr=LR)
    scheduler = torch.optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=EPOCHS)

    n_params = sum(p.numel() for p in model.parameters())
    print(f"模型参数量: {n_params:,}")

    best_val_loss = float("inf")
    best_epoch = 0
    epochs_no_improve = 0
    start = time.time()

    print("\n开始训练...")
    for epoch in range(1, EPOCHS + 1):
        model.train()
        train_loss = 0.0
        train_correct = 0
        train_total = 0
        for xb, yb in train_loader:
            xb, yb = xb.to(device), yb.to(device)
            optimizer.zero_grad()
            logits = model(xb)
            loss = criterion(logits, yb)
            loss.backward()
            optimizer.step()
            train_loss += loss.item() * xb.size(0)
            train_correct += (logits.argmax(dim=1) == yb).sum().item()
            train_total += yb.size(0)
        scheduler.step()

        train_loss /= train_total
        train_acc = train_correct / train_total
        val_loss, val_acc, _, _ = evaluate(model, val_loader, criterion, device)

        print(
            f"Epoch {epoch:>2}/{EPOCHS} | "
            f"train_loss={train_loss:.4f} train_acc={train_acc:.4f} | "
            f"val_loss={val_loss:.4f} val_acc={val_acc:.4f}"
        )

        # early stopping（监控 val_loss）
        if val_loss < best_val_loss:
            best_val_loss = val_loss
            best_epoch = epoch
            epochs_no_improve = 0
            MODELS_DIR.mkdir(parents=True, exist_ok=True)
            torch.save(model.state_dict(), WEIGHT_PATH)
        else:
            epochs_no_improve += 1
            if epochs_no_improve >= PATIENCE:
                print(f"\nEarly stopping：连续 {PATIENCE} 个 epoch val_loss 无改善，停止于 epoch {epoch}")
                break

    elapsed = time.time() - start
    print(f"\n训练完成，耗时 {elapsed:.1f}s，最佳 epoch={best_epoch} (val_loss={best_val_loss:.4f})")

    _report(model, test_loader, criterion, device)


if __name__ == "__main__":
    main()