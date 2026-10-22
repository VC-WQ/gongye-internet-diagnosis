"""PINN 物理残差生成器（CWRU 单通道版）。

基于物理信息神经网络(Physics-Informed Neural Network, PINN)拟合健康工况的
振动基线，并据此计算物理残差：

    残差 = |实际振动信号 - 网络重建的物理预期信号|

残差升高意味着信号偏离正常物理规律，是异常信号。

物理约束：
    - 振动-转速关系：旋转机械振动幅度与转速平方成正比（离心力 ∝ ω²）。
      在 CWRU 单通道（仅 DE 振动）场景下，转速为恒定外部参数，该约束
      在训练损失中落地为「振动能量守恒」正则项：
          L_phys = MSE( RMS(x̂), RMS(x) )
      即正常信号的重建应保持振动能量不变。

损失函数 = 数据损失(MSE 重建误差) + λ × 物理约束损失。

当 PyTorch 不可用时，退化为解析物理模型，保证后端无 torch 也能启动。
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

# 单通道：仅 DE 振动（与 CWRU 数据对齐）。保留常量以兼容 health_scorer 等下游。
SENSOR_CHANNELS = ["vibration"]

# 信号参数
from .constants import SEQ_LEN

# 训练权重路径（由 train_pinn.py 训练后生成）
PROJECT_ROOT = Path(__file__).resolve().parents[4]
PINN_WEIGHT_PATH = PROJECT_ROOT / "models" / "pinn_baseline.pt"


# ---------------------------------------------------------------------------
# 物理约束函数（解析形式）
# ---------------------------------------------------------------------------
def physics_vibration_speed(speed: np.ndarray, base_vibration: float, base_speed: float) -> np.ndarray:
    """振动-转速物理关系：振动加速度与转速平方成正比。"""
    return base_vibration * (np.maximum(speed, 1e-6) / max(base_speed, 1e-6)) ** 2


class PINNConfig:
    """PINN 模型与物理约束配置。"""

    base_vibration: float = 0.1
    base_speed: float = 1797.0  # CWRU 0HP 基准转速（rpm）
    physics_weight: float = 0.1  # 物理约束损失权重 λ


# ---------------------------------------------------------------------------
# PyTorch PINN 模型（1D 卷积自编码器）
# ---------------------------------------------------------------------------
class PhysicsInformedNN(nn.Module if _HAS_TORCH else object):
    """物理信息神经网络：1D 卷积自编码器，重建正常振动信号基线。

    输入 (batch, 1, 2048) -> 输出 (batch, 1, 2048)（物理预期信号）。
    """

    def __init__(self, seq_len: int = SEQ_LEN, hidden: int = 32) -> None:
        if not _HAS_TORCH:  # pragma: no cover
            raise RuntimeError("PyTorch 未安装，无法实例化 PhysicsInformedNN")
        super().__init__()
        self.seq_len = seq_len

        # 编码器：两次降采样 2048 -> 1024 -> 512
        self.encoder = nn.Sequential(
            nn.Conv1d(1, hidden, kernel_size=15, padding=7),
            nn.BatchNorm1d(hidden),
            nn.ReLU(),
            nn.MaxPool1d(2),  # -> 1024
            nn.Conv1d(hidden, hidden * 2, kernel_size=9, padding=4),
            nn.BatchNorm1d(hidden * 2),
            nn.ReLU(),
            nn.MaxPool1d(2),  # -> 512
        )
        # 解码器：上采样还原 512 -> 1024 -> 2048
        self.decoder = nn.Sequential(
            nn.Conv1d(hidden * 2, hidden, kernel_size=9, padding=4),
            nn.ReLU(),
            nn.Upsample(scale_factor=2),  # -> 1024
            nn.Conv1d(hidden, 1, kernel_size=15, padding=7),
            nn.Upsample(scale_factor=2),  # -> 2048
        )

    def forward(self, x):
        """前向传播：返回重建的物理预期信号。"""
        return self.decoder(self.encoder(x))


# ---------------------------------------------------------------------------
# PINN 残差生成器（对外接口）
# ---------------------------------------------------------------------------
class PinnResidualGenerator:
    """PINN 物理残差生成器。

    训练用法（见 __main__）：用正常工况振动窗口训练自编码器。
    推理用法：gen.predict_np(x_np) 返回重建与残差。
    """

    def __init__(self, config: Optional[PINNConfig] = None) -> None:
        self.config = config or PINNConfig()
        self.model: Optional["PhysicsInformedNN"] = None
        self._weights_ready = False  # 训练权重是否已成功加载缓存
        if _HAS_TORCH:
            self.model = PhysicsInformedNN()

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
            raise RuntimeError("PyTorch 未安装，无法加载 PINN 权重")
        state = torch.load(path, map_location="cpu")
        if isinstance(state, dict) and "state_dict" in state:
            state = state["state_dict"]
        self.model.load_state_dict(state)
        self.model.eval()
        logger.info("已加载 PINN 权重：%s", path)

    def save(self, path: str) -> None:
        """保存模型权重。"""
        if not self.use_torch:  # pragma: no cover
            raise RuntimeError("PyTorch 未安装，无法保存 PINN 权重")
        Path(path).parent.mkdir(parents=True, exist_ok=True)
        torch.save(self.model.state_dict(), path)
        logger.info("已保存 PINN 权重：%s", path)

    # ------------------------------------------------------------------
    # 推理（numpy 接口）
    # ------------------------------------------------------------------
    def predict_np(self, x: np.ndarray) -> dict:
        """对振动窗口推理，返回物理残差统计。

        Args:
            x: 形状 (1, 2048) 或 (2048,) 的振动数组

        Returns:
            reconstruction / residual / residual_rms
        """
        x = np.asarray(x, dtype=np.float32)
        if x.ndim == 1:
            x = x.reshape(1, 1, -1)
        elif x.ndim == 2 and x.shape[0] == 1:
            x = x.reshape(1, 1, -1)

        if self.use_torch:
            with torch.no_grad():
                x_t = torch.from_numpy(x)
                recon = self.model(x_t).squeeze(0).numpy()
        else:
            # 降级：解析基线（高频分量视为残差，低频视为物理预期）
            recon = self._analytic_baseline(x)

        recon = recon.reshape(x.shape)
        residual = np.abs(x - recon)
        # 单样本窗口：RMS 为标量（对全窗口取均方根，与标定脚本口径一致）
        residual_rms = float(np.sqrt(np.mean(residual ** 2) + 1e-8))
        input_rms = float(np.sqrt(np.mean(x ** 2) + 1e-8))
        return {
            "reconstruction": recon,
            "residual": residual,
            "residual_rms": residual_rms,
            "input_rms": input_rms,
        }

    def residual_stats(self, x_batch: np.ndarray) -> dict:
        """对一批正常/故障窗口计算平均残差 RMS（用于残差对比）。"""
        rms_list = [self.predict_np(xb)["residual_rms"] for xb in x_batch]
        return {"mean": float(np.mean(rms_list)), "std": float(np.std(rms_list))}

    # ------------------------------------------------------------------
    # 统一残差入口（供 service 调用）
    # ------------------------------------------------------------------
    def ensure_weights(self, path: Optional[str] = None) -> bool:
        """懒加载训练权重（仅一次）。返回是否可走训练模型推理。"""
        if self._weights_ready:
            return True
        p = Path(path) if path else PINN_WEIGHT_PATH
        if not self.use_torch or not p.exists():
            return False
        try:
            self.load(str(p))
            self._weights_ready = True
            return True
        except Exception as exc:  # pragma: no cover
            logger.warning("PINN 权重加载失败，退回解析路径：%s", exc)
            return False

    @staticmethod
    def _vibration_value(rec) -> Optional[float]:
        """从一条记录提取振动数值，兼容 vibration / DE / observations 嵌套。"""
        if not isinstance(rec, dict):
            return None
        for key in ("vibration", "DE"):
            if isinstance(rec.get(key), (int, float)):
                return float(rec[key])
        obs = rec.get("observations")
        if isinstance(obs, dict):
            for key in ("vibration", "DE"):
                if isinstance(obs.get(key), (int, float)):
                    return float(obs[key])
        return None

    @staticmethod
    def _pad_to_window(arr: np.ndarray, seq_len: int = SEQ_LEN) -> np.ndarray:
        """截断/补零到固定长度，reshape 成 (1, 1, seq_len)。"""
        if arr.shape[0] >= seq_len:
            arr = arr[-seq_len:]
        else:
            arr = np.pad(arr, (0, seq_len - arr.shape[0]))
        return arr.reshape(1, 1, seq_len)

    def compute_residual(self, window: list[dict]) -> dict:
        """统一残差入口：优先训练模型推理，失败走解析降级。

        Args:
            window: list[dict] 传感器窗口

        Returns:
            {residual: float, pinn_source: "trained_model" | "heuristic"}
        """
        values = [v for rec in window if (v := self._vibration_value(rec)) is not None]
        if not values:
            return {"residual": 0.0, "pinn_source": "heuristic"}
        arr = np.asarray(values, dtype=np.float32)
        if self.ensure_weights():
            x = self._pad_to_window(arr)
            out = self.predict_np(x)
            return {"residual": float(out["residual_rms"]), "pinn_source": "trained_model"}
        residual = float(np.mean(np.abs(arr - self.config.base_vibration)))
        return {"residual": residual, "pinn_source": "heuristic"}

    def _analytic_baseline(self, x: np.ndarray) -> np.ndarray:
        """降级路径：用信号低频成分（滑动平均）作为物理预期。"""
        k = 64
        kernel = np.ones(k, dtype=np.float32) / k
        # 对最后一维做滑动平均
        base = np.empty_like(x)
        for i in range(x.shape[0]):
            for c in range(x.shape[1]):
                sig = x[i, c]
                pad = np.pad(sig, (k // 2, k // 2), mode="edge")
                base[i, c] = np.convolve(pad, kernel, mode="same")[k // 2:-k // 2 + 1][: len(sig)]
        return base

    # ------------------------------------------------------------------
    # 训练接口（需 torch + 正常工况振动窗口）
    # ------------------------------------------------------------------
    def _eval_loss(self, X: np.ndarray, physics_weight: float) -> float:
        """计算一组窗口的总损失（数据 + 物理），不更新梯度。"""
        X = np.asarray(X, dtype=np.float32)
        if X.ndim == 2:
            X = X[:, None, :]
        X_t = torch.from_numpy(X)
        mse = nn.MSELoss()
        self.model.eval()
        n = X_t.size(0)
        total = 0.0
        with torch.no_grad():
            for i in range(0, n, 256):
                xb = X_t[i : i + 256]
                recon = self.model(xb)
                data_loss = mse(recon, xb)
                phys_loss = mse(
                    torch.sqrt(torch.mean(recon ** 2, dim=(1, 2)) + 1e-8),
                    torch.sqrt(torch.mean(xb ** 2, dim=(1, 2)) + 1e-8),
                )
                total += (data_loss + physics_weight * phys_loss).item() * xb.size(0)
        return total / n

    def train(
        self,
        normal_windows: np.ndarray,
        epochs: int = 50,
        lr: float = 1e-3,
        batch_size: int = 64,
        physics_weight: Optional[float] = None,
        val_windows: Optional[np.ndarray] = None,
        patience: Optional[int] = None,
    ) -> dict:
        """用正常工况振动窗口训练 PINN（支持早停），返回损失历史。

        Args:
            normal_windows: 形状 (N, 1, 2048) 的正常振动窗口
            val_windows: 验证窗口（早停监控 val loss）
            physics_weight: 物理约束权重，默认取 config.physics_weight

        损失 = MSE(recon, x) + λ * MSE(RMS(recon), RMS(x))
        """
        if not self.use_torch:  # pragma: no cover
            logger.warning("PyTorch 未安装，跳过 PINN 训练")
            return {"train": [], "val": []}

        w = self.config.physics_weight if physics_weight is None else physics_weight
        X = np.asarray(normal_windows, dtype=np.float32)
        if X.ndim == 2:
            X = X[:, None, :]
        X_t = torch.from_numpy(X)
        n = X_t.size(0)

        optimizer = torch.optim.Adam(self.model.parameters(), lr=lr)
        mse = nn.MSELoss()

        history = {"train": [], "val": []}
        best_loss = float("inf")
        best_state = None
        no_improve = 0

        for epoch in range(1, epochs + 1):
            self.model.train()
            perm = torch.randperm(n)
            total_loss = 0.0
            for i in range(0, n, batch_size):
                idx = perm[i : i + batch_size]
                xb = X_t[idx]
                optimizer.zero_grad()
                recon = self.model(xb)
                data_loss = mse(recon, xb)
                phys_loss = mse(
                    torch.sqrt(torch.mean(recon ** 2, dim=(1, 2)) + 1e-8),
                    torch.sqrt(torch.mean(xb ** 2, dim=(1, 2)) + 1e-8),
                )
                loss = data_loss + w * phys_loss
                loss.backward()
                optimizer.step()
                total_loss += loss.item() * xb.size(0)
            train_loss = total_loss / n
            history["train"].append(train_loss)

            val_loss: Optional[float] = None
            if val_windows is not None:
                val_loss = self._eval_loss(val_windows, w)
                history["val"].append(val_loss)
            monitor = val_loss if val_loss is not None else train_loss

            if monitor < best_loss:
                best_loss = monitor
                best_state = {k: v.clone() for k, v in self.model.state_dict().items()}
                no_improve = 0
            else:
                no_improve += 1
                if patience is not None and no_improve >= patience:
                    logger.info(
                        "PINN early stopping @ epoch=%d (best=%.6f)", epoch, best_loss
                    )
                    break

            if epoch % 10 == 0:
                logger.info(
                    "epoch=%d train=%.6f%s",
                    epoch,
                    train_loss,
                    "" if val_loss is None else f" val={val_loss:.6f}",
                )

        if best_state is not None:
            self.model.load_state_dict(best_state)
        self.model.eval()
        logger.info("PINN 训练完成，best_loss=%.6f", best_loss)
        return history

    # ------------------------------------------------------------------
    # 兼容旧接口（dict 样本，供 service/health_scorer 调用）
    # ------------------------------------------------------------------
    @staticmethod
    def extract_features(sample: dict) -> np.ndarray:
        """从 dict 样本提取单通道振动特征（缺失返回 0）。"""
        v = sample.get("vibration")
        if v is None and isinstance(sample.get("observations"), dict):
            v = sample["observations"].get("vibration")
        return np.asarray([float(v) if v is not None else 0.0])

    def predict(self, sample: dict) -> dict:
        """兼容旧接口：对单条 dict 样本计算物理预期与残差。"""
        v = float(self.extract_features(sample)[0])
        expected = self.config.base_vibration
        residual = abs(v - expected)
        return {
            "expected": {"vibration": expected},
            "residual": {"vibration": residual},
        }

    def predict_window(self, window: list[dict]) -> dict:
        """兼容旧接口：对窗口 dict 列表计算平均残差。"""
        residues = [self.predict(s)["residual"]["vibration"] for s in window]
        mean_residual = {"vibration": float(np.mean(residues)) if residues else 0.0}
        return {"mean_residual": mean_residual, "per_sample": residues}


pinn_residual_generator = PinnResidualGenerator()