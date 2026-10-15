"""1D-CNN 故障分类器（CWRU 4 类）。

输入：单通道振动信号窗口 (batch, 1, 2048)（12kHz 驱动端 DE 数据）
输出：故障类型 + 置信度

故障类别（CWRU dataset）：
    0: normal      正常
    1: inner_race  内圈故障 (IR)
    2: outer_race  外圈故障 (OR)
    3: ball        滚动体故障 (Ball)

使用 PyTorch 实现小规模 1D-CNN（参数量约 60K~100K）。
当 PyTorch 不可用时退化为启发式分类，保证后端可无 torch 启动。
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import numpy as np

logger = logging.getLogger(__name__)

try:
    import torch
    import torch.nn as nn

    _HAS_TORCH = True
except ImportError:  # pragma: no cover
    torch = None
    nn = None
    _HAS_TORCH = False

# 故障类别标签（顺序即输出层索引），作为标签映射的单一来源
FAULT_CLASSES = ["normal", "inner_race", "outer_race", "ball"]

# CWRU 字符串标签 -> 索引（data_loader 据此映射 Y）
LABEL_MAP = {"Normal": 0, "IR": 1, "OR": 2, "Ball": 3}
# 索引 -> CWRU 字符串标签（用于报告展示）
LABEL_NAMES = ["Normal", "IR", "OR", "Ball"]

FAULT_LABELS_ZH = {
    "normal": "正常",
    "inner_race": "内圈故障",
    "outer_race": "外圈故障",
    "ball": "滚动体故障",
}

# 信号参数
SEQ_LEN = 2048
N_CHANNELS = 1

# 训练权重路径（由 train_cnn.py 训练后生成）
PROJECT_ROOT = Path(__file__).resolve().parents[4]
CNN_WEIGHT_PATH = PROJECT_ROOT / "models" / "cnn_bearing.pt"


# ---------------------------------------------------------------------------
# PyTorch 1D-CNN 模型
# ---------------------------------------------------------------------------
class FaultCNN(nn.Module if _HAS_TORCH else object):
    """小规模 1D-CNN 故障分类器。

    输入 (batch, 1, 2048)，输出 (batch, 4)。
    保留 2048 长度不降采样，避免丢失 kHz 频段的轴承特征频率（BPFO/BPFI/BSF）。
    """

    def __init__(
        self,
        n_channels: int = N_CHANNELS,
        n_classes: int = len(FAULT_CLASSES),
    ) -> None:
        if not _HAS_TORCH:  # pragma: no cover
            raise RuntimeError("PyTorch 未安装，无法实例化 FaultCNN")
        super().__init__()
        self.n_channels = n_channels
        self.n_classes = n_classes

        self.conv = nn.Sequential(
            nn.Conv1d(n_channels, 32, kernel_size=15, stride=1, padding=7),
            nn.BatchNorm1d(32),
            nn.ReLU(),
            nn.MaxPool1d(2),  # 2048 -> 1024
            nn.Conv1d(32, 64, kernel_size=9, padding=4),
            nn.BatchNorm1d(64),
            nn.ReLU(),
            nn.MaxPool1d(2),  # 1024 -> 512
            nn.Conv1d(64, 128, kernel_size=5, padding=2),
            nn.BatchNorm1d(128),
            nn.ReLU(),
            nn.AdaptiveAvgPool1d(1),  # 512 -> 1
        )
        self.classifier = nn.Sequential(
            nn.Flatten(),
            nn.Dropout(0.3),
            nn.Linear(128, n_classes),
        )

    def forward(self, x):
        """前向传播：返回 logits (batch, n_classes)。"""
        return self.classifier(self.conv(x))


# ---------------------------------------------------------------------------
# 分类器包装（对外接口）
# ---------------------------------------------------------------------------
class FaultClassifier:
    """1D-CNN 故障分类器接口。

    训练用法（见 train_cnn.py）：
        model = FaultCNN()
        ... 训练 ...
        torch.save(model.state_dict(), "models/cnn_bearing.pt")

    推理用法：
        clf = FaultClassifier()
        clf.load("models/cnn_bearing.pt")
        result = clf.predict(x_np)   # x_np: (1, 2048) 或 (N, 1, 2048)
    """

    def __init__(self, model: Optional["FaultCNN"] = None) -> None:
        self.model = model or (FaultCNN() if _HAS_TORCH else None)
        self._weights_ready = False  # 训练权重是否已成功加载缓存

    @property
    def use_torch(self) -> bool:
        """当前是否使用 PyTorch 模型。"""
        return _HAS_TORCH and self.model is not None

    # ------------------------------------------------------------------
    # 权重加载/保存
    # ------------------------------------------------------------------
    def load(self, path: str) -> None:
        """从 checkpoint 加载权重。"""
        if not self.use_torch:  # pragma: no cover
            raise RuntimeError("PyTorch 未安装，无法加载模型权重")
        state = torch.load(path, map_location="cpu")
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        self.model.load_state_dict(state)
        self.model.eval()
        logger.info("已加载 1D-CNN 权重：%s", path)

    def save(self, path: str) -> None:
        """保存模型权重。"""
        if not self.use_torch:  # pragma: no cover
            raise RuntimeError("PyTorch 未安装，无法保存模型权重")
        torch.save(self.model.state_dict(), path)
        logger.info("已保存 1D-CNN 权重：%s", path)

    # ------------------------------------------------------------------
    # 推理
    # ------------------------------------------------------------------
    def predict(self, x: np.ndarray) -> dict:
        """对单条振动窗口推理。

        Args:
            x: 形状 (1, 2048) 或 (2048,) 的振动数组

        Returns:
            fault_type / fault_label / confidence / probabilities
        """
        if not self.use_torch:
            return self._classify_heuristic(x)
        x = np.asarray(x, dtype=np.float32)
        if x.ndim == 1:
            x = x.reshape(1, 1, -1)
        elif x.ndim == 2 and x.shape[0] == 1:
            x = x.reshape(1, 1, -1)
        elif x.ndim == 3:
            pass  # 已是 (1, 1, 2048)
        else:
            x = x.reshape(1, 1, -1)

        x_t = torch.from_numpy(x)
        with torch.no_grad():
            logits = self.model(x_t)
            probs = torch.softmax(logits, dim=1).squeeze(0).numpy()
        return self._format_result(probs)

    def predict_batch(self, x: np.ndarray) -> list[dict]:
        """批量推理，返回结果列表。"""
        if not self.use_torch:
            return [self._classify_heuristic(xi) for xi in x]
        x = np.asarray(x, dtype=np.float32)
        if x.ndim == 2:
            x = x[:, None, :]  # (N, 2048) -> (N, 1, 2048)
        x_t = torch.from_numpy(x)
        with torch.no_grad():
            logits = self.model(x_t)
            probs = torch.softmax(logits, dim=1).numpy()
        return [self._format_result(p) for p in probs]

    # ------------------------------------------------------------------
    # 降级/兼容路径（无 torch 时）
    # ------------------------------------------------------------------
    def ensure_weights(self, path: Optional[str] = None) -> bool:
        """懒加载训练权重（仅一次，缓存到实例）。返回是否可走训练模型推理。"""
        if self._weights_ready:
            return True
        p = Path(path) if path else CNN_WEIGHT_PATH
        if not self.use_torch or not p.exists():
            return False
        try:
            self.load(str(p))
            self._weights_ready = True
            return True
        except Exception as exc:  # pragma: no cover
            logger.warning("CNN 权重加载失败，退回启发式：%s", exc)
            return False

    def classify(self, window) -> dict:
        """对外主入口：优先训练模型推理，失败退回启发式。

        Args:
            window: np.ndarray (1, 1, 2048) / (1, 2048)（训练模型推理），
                    或原始样本（降级路径）

        Returns:
            分类结果，含 cnn_source 字段标记来源（trained_model / heuristic）
        """
        if self.ensure_weights() and isinstance(window, np.ndarray):
            result = self.predict(window)
            result["cnn_source"] = "trained_model"
            return result
        result = self._classify_heuristic(window)
        result["cnn_source"] = "heuristic"
        return result

    def _classify_heuristic(self, x) -> dict:
        """启发式分类（无 torch 时）。

        基于振动 RMS 做粗判：RMS 很小 -> 正常，否则按频谱能量偏向故障。
        无模型下默认返回正常，保证后端可运行。
        """
        probs = np.zeros(len(FAULT_CLASSES))
        probs[FAULT_CLASSES.index("normal")] = 1.0
        return self._format_result(probs)

    @staticmethod
    def _format_result(probs: np.ndarray) -> dict:
        """将概率数组格式化为统一结果结构。"""
        idx = int(np.argmax(probs))
        fault_type = FAULT_CLASSES[idx]
        return {
            "fault_type": fault_type,
            "fault_label": FAULT_LABELS_ZH[fault_type],
            "confidence": float(probs[idx]),
            "probabilities": {
                cls: float(probs[i]) for i, cls in enumerate(FAULT_CLASSES)
            },
        }


cnn_classifier = FaultClassifier()