"""CWRU 数据集切分工具（按物理文件分层，杜绝数据泄漏）。

背景
----
`app.modules.anomaly_detect.data_loader` 的 `stratified_file_split` 委托本模块实现。
本模块此前缺失，导致所有训练脚本（train_cnn.py / train_pinn.py / 本项目的分析脚本）
在 import 阶段即 ModuleNotFoundError，无法运行。

为什么必须"按文件"切分
----------------------
CWRU 的 11754 个窗口样本由若干**物理 .mat 文件**切片而来：
同一文件内的相邻窗口高度相关。若按样本随机切分，同一文件的窗口会同时出现在
训练集和测试集，模型只需"记住文件"即可拿高分 —— 这是典型的**数据泄漏**，
会使测试准确率虚高、无法反映真实泛化能力。

因此切分的基本单位是**文件**，并在每个故障类别内按比例分层抽样文件，
保证 train/val/test 的类别分布一致且互不重叠。
"""
from __future__ import annotations

import numpy as np


def _file_dominant_label(file_ids: np.ndarray, y: np.ndarray) -> dict:
    """每个文件的主导标签（该文件中出现最多的类别）。"""
    out: dict = {}
    for f in np.unique(file_ids):
        labels = y[file_ids == f]
        vals, counts = np.unique(labels, return_counts=True)
        out[f] = int(vals[int(np.argmax(counts))])
    return out


def stratified_file_split(
    X: np.ndarray,
    y: np.ndarray,
    file_ids: np.ndarray,
    train_ratio: float = 0.7,
    val_ratio: float = 0.15,
    random_seed: int = 42,
):
    """按物理文件分层切分 train/val/test。

    Parameters
    ----------
    X : (N, ...) 样本
    y : (N,)    标签
    file_ids : (N,) 每个样本来源文件的索引
    train_ratio / val_ratio : 训练/验证集比例（按**文件数**计）
    random_seed : 随机种子

    Returns
    -------
    ((train_d, val_d, test_d), (train_idx, val_idx, test_idx))
        其中 train_d = (X_train, y_train)，以此类推。
    """
    rng = np.random.default_rng(random_seed)
    file_ids = np.asarray(file_ids)
    y = np.asarray(y)

    file_label = _file_dominant_label(file_ids, y)

    # 按主导标签把文件分组，保证各集合类别分布一致
    by_class: dict[int, list] = {}
    for f, lab in file_label.items():
        by_class.setdefault(lab, []).append(f)

    train_files: list = []
    val_files: list = []
    test_files: list = []

    for _lab, files in sorted(by_class.items()):
        files = np.asarray(files)
        rng.shuffle(files)
        n = len(files)
        n_train = int(round(n * train_ratio))
        n_val = int(round(n * val_ratio))
        # 至少保证验证/测试各留 1 个文件（当文件数足够时）
        if n >= 3:
            n_train = min(max(n_train, 1), n - 2)
            n_val = min(max(n_val, 1), n - n_train - 1)
        else:
            n_train = max(n_train, 1)
            n_val = 0
        train_files.extend(files[:n_train].tolist())
        val_files.extend(files[n_train : n_train + n_val].tolist())
        test_files.extend(files[n_train + n_val :].tolist())

    def _idx(files: list) -> np.ndarray:
        if not files:
            return np.array([], dtype=int)
        return np.where(np.isin(file_ids, np.asarray(files)))[0]

    train_idx = _idx(train_files)
    val_idx = _idx(val_files)
    test_idx = _idx(test_files)

    train_d = (X[train_idx], y[train_idx])
    val_d = (X[val_idx], y[val_idx])
    test_d = (X[test_idx], y[test_idx])

    return (train_d, val_d, test_d), (train_idx, val_idx, test_idx)


__all__ = ["stratified_file_split"]
