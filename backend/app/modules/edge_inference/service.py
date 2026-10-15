"""边缘轻量推理模块：统计特征 + 阈值判断的实时可疑度评分。

设计目标：
1. 接收传感器数据窗口，输出 0-1 之间的可疑度评分
2. 输出异常主导方向：振动主导 / 温度主导 / 效率主导
3. 轻量实现：纯 Python 统计特征 + 阈值判断，无重依赖（不依赖 torch）
4. 单次推理 < 10ms（仅对窗口做统计运算）
5. 可疑度 > 0.5 时标记触发完整诊断（由上层调度多智能体会诊）
"""
import logging
import time
from dataclasses import asdict, dataclass
from typing import Any, Optional

logger = logging.getLogger(__name__)

# 触发完整诊断的可疑度阈值
TRIGGER_THRESHOLD = 0.5
# 主导方向判定的最小子分数（最大子分数低于此值视为"无主导异常"）
DOMINANT_MIN_SCORE = 0.2

# 主导方向英文枚举 -> 中文标签
DIRECTION_LABELS = {
    "vibration": "振动主导",
    "temperature": "温度主导",
    "efficiency": "效率主导",
    "none": "无",
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    """将数值裁剪到 [low, high]。"""
    return max(low, min(high, value))


@dataclass
class EdgeProfile:
    """单台设备的边缘推理基准与阈值配置。

    阈值语义与 Device 模型的 threshold_vibration / threshold_temp 对齐。
    """

    base_vibration: float = 0.1
    base_temperature: float = 45.0
    base_current: float = 5.0
    base_pressure: float = 6.0
    base_speed: float = 1480.0
    # 振动/温度的绝对告警阈值（越界 -> 评分趋近 1）
    threshold_vibration: float = 0.5
    threshold_temp: float = 75.0
    # 效率方向归一化尺度：综合偏差达到该比例视为满分异常（默认 30%）
    efficiency_loss_scale: float = 0.3


class EdgeInferenceService:
    """边缘轻量推理服务。"""

    def __init__(self, default_profile: Optional[EdgeProfile] = None) -> None:
        self.default_profile = default_profile or EdgeProfile()
        self.profiles: dict[str, EdgeProfile] = {}

    # ------------------------------------------------------------------
    # 设备基准注册
    # ------------------------------------------------------------------
    def register_device(self, device_id: str, profile: EdgeProfile) -> None:
        """按设备注册边缘推理基准（实现设备异构性）。"""
        self.profiles[device_id] = profile

    def get_profile(self, device_id: str) -> EdgeProfile:
        """获取设备对应基准，未注册则用默认基准。"""
        return self.profiles.get(device_id, self.default_profile)

    # ------------------------------------------------------------------
    # 主推理入口
    # ------------------------------------------------------------------
    def infer(self, device_id: str, window: list[dict]) -> dict[str, Any]:
        """对传感器数据窗口进行轻量推理。

        Args:
            device_id: 设备 ID
            window: 传感器数据窗口（list[dict]），每条含 vibration/temperature/
                    current/pressure/speed（或 rpm）等字段

        Returns:
            含 suspicious_score / dominant_direction / trigger_full_diagnosis 等字段的结果
        """
        t0 = time.perf_counter()
        profile = self.get_profile(device_id)

        if not window:
            return self._empty_result(device_id)

        direction_scores = self._compute_direction_scores(window, profile)
        suspicion = self._combine_scores(direction_scores)
        dominant, dominant_label = self._dominant_direction(direction_scores)
        trigger = suspicion > TRIGGER_THRESHOLD

        latency_ms = (time.perf_counter() - t0) * 1000.0

        result = {
            "device_id": device_id,
            "suspicion_score": round(suspicion, 4),
            "dominant_direction": dominant,
            "dominant_label": dominant_label,
            "direction_scores": {k: round(v, 4) for k, v in direction_scores.items()},
            "trigger_full_diagnosis": trigger,
            "latency_ms": round(latency_ms, 4),
            "window_size": len(window),
            "features": self._extract_features(window),
        }

        if trigger:
            logger.info(
                "设备 %s 可疑度 %.3f 超过阈值 %.2f，触发完整诊断",
                device_id,
                suspicion,
                TRIGGER_THRESHOLD,
            )
        return result

    def batch_infer(self, samples: list[dict]) -> list[dict]:
        """批量推理：样本形如 {'device_id': str, 'window': list[dict]}。"""
        results = []
        for s in samples:
            results.append(self.infer(s.get("device_id", "unknown"), s.get("window", [])))
        return results

    # ------------------------------------------------------------------
    # 核心评分逻辑
    # ------------------------------------------------------------------
    def _compute_direction_scores(
        self, window: list[dict], profile: EdgeProfile
    ) -> dict[str, float]:
        """计算振动/温度/效率三个方向的子评分（各 0~1）。"""
        vib = self._series(window, "vibration")
        temp = self._series(window, "temperature")
        cur = self._series(window, "current")
        pres = self._series(window, "pressure")
        spd = self._series(window, "speed", alias="rpm")

        v_mean = self._mean(vib)
        t_mean = self._mean(temp)
        c_mean = self._mean(cur)
        p_mean = self._mean(pres)
        s_mean = self._mean(spd)

        # 振动：均值相对 base -> threshold 的越界程度
        v_range = max(profile.threshold_vibration - profile.base_vibration, 1e-6)
        vibration_score = _clamp((v_mean - profile.base_vibration) / v_range)

        # 温度：均值相对 base -> threshold 的越界程度
        t_range = max(profile.threshold_temp - profile.base_temperature, 1e-6)
        temperature_score = _clamp((t_mean - profile.base_temperature) / t_range)

        # 效率：电流上升 + 压力下降 + 转速下降，三者综合
        eff_loss_current = (c_mean - profile.base_current) / max(
            profile.base_current * profile.efficiency_loss_scale, 1e-6
        )
        eff_loss_pressure = (profile.base_pressure - p_mean) / max(
            profile.base_pressure * profile.efficiency_loss_scale, 1e-6
        )
        eff_loss_speed = (profile.base_speed - s_mean) / max(
            profile.base_speed * profile.efficiency_loss_scale, 1e-6
        )
        efficiency_score = _clamp(
            (eff_loss_current + eff_loss_pressure + eff_loss_speed) / 3.0
        )

        return {
            "vibration": vibration_score,
            "temperature": temperature_score,
            "efficiency": efficiency_score,
        }

    @staticmethod
    def _combine_scores(scores: dict[str, float]) -> float:
        """串联风险公式：任一方向异常都会推高总可疑度，上限为 1。"""
        suspicion = 1.0
        for s in scores.values():
            suspicion *= 1.0 - _clamp(s)
        return 1.0 - suspicion

    @staticmethod
    def _dominant_direction(scores: dict[str, float]) -> tuple[str, str]:
        """返回主导方向（英文字段 + 中文标签）。"""
        dominant = max(scores, key=scores.get)
        if scores[dominant] < DOMINANT_MIN_SCORE:
            return "none", DIRECTION_LABELS["none"]
        return dominant, DIRECTION_LABELS[dominant]

    @staticmethod
    def _extract_features(window: list[dict]) -> dict[str, dict[str, float]]:
        """提取窗口统计特征（供完整诊断/记录使用）。"""
        features: dict[str, dict[str, float]] = {}
        for key in ("vibration", "temperature", "current", "pressure", "speed"):
            series = EdgeInferenceService._series(window, key, alias="rpm")
            if not series:
                continue
            features[key] = {
                "mean": round(EdgeInferenceService._mean(series), 4),
                "max": round(max(series), 4),
                "min": round(min(series), 4),
                "latest": round(series[-1], 4),
            }
        return features

    # ------------------------------------------------------------------
    # 工具方法
    # ------------------------------------------------------------------
    @staticmethod
    def _get(record: Any, key: str) -> Optional[float]:
        """从一条记录中提取指定指标的数值，兼容嵌套 observations 结构。"""
        if not isinstance(record, dict):
            return None
        if key in record and isinstance(record[key], (int, float)):
            return float(record[key])
        obs = record.get("observations")
        if isinstance(obs, dict) and key in obs and isinstance(obs[key], (int, float)):
            return float(obs[key])
        return None

    @classmethod
    def _series(cls, window: list[dict], key: str, alias: Optional[str] = None) -> list[float]:
        """提取窗口内某指标的数值序列（支持别名，如 speed<->rpm）。"""
        keys = (key, alias) if alias else (key,)
        vals: list[float] = []
        for rec in window:
            for k in keys:
                v = cls._get(rec, k)
                if v is not None:
                    vals.append(v)
                    break
        return vals

    @staticmethod
    def _mean(vals: list[float]) -> float:
        """安全均值。"""
        return sum(vals) / len(vals) if vals else 0.0

    @staticmethod
    def _empty_result(device_id: str) -> dict[str, Any]:
        """空窗口的缺省结果。"""
        return {
            "device_id": device_id,
            "suspicion_score": 0.0,
            "dominant_direction": "none",
            "dominant_label": DIRECTION_LABELS["none"],
            "direction_scores": {"vibration": 0.0, "temperature": 0.0, "efficiency": 0.0},
            "trigger_full_diagnosis": False,
            "latency_ms": 0.0,
            "window_size": 0,
            "features": {},
        }


edge_inference_service = EdgeInferenceService()