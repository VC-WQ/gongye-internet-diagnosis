"""CWRU 数据加载器。

从 datasets/CWRU/processed.npz 加载数据，映射标签，按物理文件分层切分
train/val/test（避免同一文件跨集合造成数据泄漏），并产出 PyTorch DataLoader。

processed.npz 结构：
    X        : (11754, 1, 2048) float32 振动窗口
    Y        : (11754,) <U6  4 类 {Normal, IR, OR, Ball}
    file_ids : (11754,) int32 窗口来源文件索引
    severity / horsepower / location : 结构化元数据
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

import numpy as np
import torch
from torch.utils.data import DataLoader, TensorDataset

import cwru

from .cnn_classifier import LABEL_MAP, LABEL_NAMES

# 项目根目录：backend/app/modules/anomaly_detect -> 上溯 4 级
PROJECT_ROOT = Path(__file__).resolve().parents[4]
DATASET_DIR = PROJECT_ROOT / "datasets" / "CWRU"
NPZ_PATH = DATASET_DIR / "processed.npz"
LABEL_MAP_FILE = DATASET_DIR / "label_map.json"


# ---------------------------------------------------------------------------
# 数据加载
# ---------------------------------------------------------------------------
def load_npz(npz_path: Optional[str] = None) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """加载 processed.npz，返回 (X, Y_str, file_ids)。"""
    path = Path(npz_path) if npz_path else NPZ_PATH
    data = np.load(path)
    X = data["X"]
    Y_str = data["Y"]
    file_ids = data["file_ids"]
    data.close()
    return X, Y_str, file_ids


def map_labels(Y_str: np.ndarray) -> np.ndarray:
    """将字符串标签映射为整数索引（LABEL_MAP）。"""
    Y_int = np.array([LABEL_MAP[str(y)] for y in Y_str], dtype=np.int64)
    return Y_int


def save_label_map(path: Optional[str] = None) -> None:
    """保存标签映射到 datasets/CWRU/label_map.json。"""
    p = Path(path) if path else LABEL_MAP_FILE
    p.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "string_to_index": LABEL_MAP,
        "index_to_string": {v: k for k, v in LABEL_MAP.items()},
        "class_names": {i: n for i, n in enumerate(LABEL_NAMES)},
    }
    p.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"标签映射已保存：{p}")


# ---------------------------------------------------------------------------
# 数据集切分与 DataLoader
# ---------------------------------------------------------------------------
def stratified_file_split(
    X: np.ndarray,
    Y_int: np.ndarray,
    file_ids: np.ndarray,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    seed: int = 42,
) -> tuple[tuple, tuple]:
    """按物理文件分层切分，杜绝数据泄漏。

    直接委托 cwru.stratified_file_split，返回
    ((train_d, val_d, test_d), (train_idx, val_idx, test_idx))，
    其中 train_d = (X_train, y_train)。
    """
    (train_d, val_d, test_d), (train_idx, val_idx, test_idx) = cwru.stratified_file_split(
        X=X,
        y=Y_int,
        file_ids=file_ids,
        train_ratio=train_ratio,
        val_ratio=val_ratio,
        random_seed=seed,
    )
    return (train_d, val_d, test_d), (train_idx, val_idx, test_idx)


def make_dataloaders(
    batch_size: int = 64,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    seed: int = 42,
    num_workers: int = 0,
) -> tuple[DataLoader, DataLoader, DataLoader]:
    """加载数据并返回 (train_loader, val_loader, test_loader)。"""
    X, Y_str, file_ids = load_npz()
    Y_int = map_labels(Y_str)
    save_label_map()

    (train_d, val_d, test_d), _ = stratified_file_split(
        X, Y_int, file_ids, train_ratio, val_ratio, seed
    )

    def _to_dataset(data: tuple[np.ndarray, np.ndarray]) -> TensorDataset:
        x, y = data
        x_t = torch.from_numpy(np.ascontiguousarray(x, dtype=np.float32))
        y_t = torch.from_numpy(y.astype(np.int64))
        return TensorDataset(x_t, y_t)

    train_loader = DataLoader(
        _to_dataset(train_d), batch_size=batch_size, shuffle=True, num_workers=num_workers
    )
    val_loader = DataLoader(
        _to_dataset(val_d), batch_size=batch_size, shuffle=False, num_workers=num_workers
    )
    test_loader = DataLoader(
        _to_dataset(test_d), batch_size=batch_size, shuffle=False, num_workers=num_workers
    )

    # 打印切分统计
    print("=" * 65)
    print(f"总样本: {len(X)}   train={len(train_d[0])}  val={len(val_d[0])}  test={len(test_d[0])}")
    for name, d in (("train", train_d), ("val", val_d), ("test", test_d)):
        unique, counts = np.unique(d[1], return_counts=True)
        dist = ", ".join(f"{LABEL_NAMES[u]}:{c}" for u, c in zip(unique, counts))
        print(f"  {name:<5}: {dist}")
    print("=" * 65)

    return train_loader, val_loader, test_loader


if __name__ == "__main__":
    tr, va, te = make_dataloaders()
    print(f"DataLoader OK: train={len(tr)} val={len(va)} test={len(te)} batches")