"""设备端边缘推理模拟器。

在设备侧对传感器数据窗口做轻量统计评分，输出：
- edge_anomaly_score: 0-1 可疑度
- dominant_direction: 异常主导方向（振动主导 / 温度主导 / 效率主导）

算法与后端 edge_inference 模块保持一致（统计特征 + 阈值判断），
边缘端可独立运行，无需依赖后端与 FastAPI。可选将 edge_anomaly_score
随传感器数据一并上报到 MQTT（供后端 mqtt_pipeline 采集）。
"""
from __future__ import annotations

import argparse
import json
import time
from collections import defaultdict, deque
from dataclasses import dataclass
from typing import Any, Optional

# 复用虚拟设备模拟器生成观测数据
from virtual_device import DeviceFleet, DeviceParams, VirtualDevice

try:
    import paho.mqtt.client as mqtt

    _HAS_MQTT = True
except ImportError:  # pragma: no cover
    mqtt = None
    _HAS_MQTT = False


# 触发后端完整诊断的可疑度阈值（与后端保持一致）
TRIGGER_THRESHOLD = 0.5
# 主导方向判定的最小子分数
DOMINANT_MIN_SCORE = 0.2

DIRECTION_LABELS = {
    "vibration": "振动主导",
    "temperature": "温度主导",
    "efficiency": "效率主导",
    "none": "无",
}


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    """裁剪到 [low, high]。"""
    return max(low, min(high, value))


@dataclass
class EdgeProfile:
    """边缘推理基准与阈值。"""

    base_vibration: float = 0.1
    base_temperature: float = 45.0
    base_current: float = 5.0
    base_pressure: float = 6.0
    base_speed: float = 1480.0
    threshold_vibration: float = 0.5
    threshold_temp: float = 75.0
    efficiency_loss_scale: float = 0.3

    @classmethod
    def from_device_params(cls, p: DeviceParams) -> "EdgeProfile":
        """从虚拟设备参数推导边缘基准与阈值。

        阈值取值依据说明（诚实标注）：
        - 振动阈值 = 基准 ×5：借鉴 ISO 10816-1/3（旋转机械振动烈度分级）中
          「可接受区/告警区」以振动速度分级的思想，但倍率 5 为工程经验取值，
          未按真实设备振动烈度实测标定。
        - 温度阈值 = 基准 +30°C：参考电机/泵类设备典型温升限值（参考 ISO 2372
          与设备铭牌温升），30°C 为工程经验值，生产应取厂商铭牌或实测标定。
        - 效率损失刻度 efficiency_loss_scale=0.3：效率下降 30% 视为显著异常，
          为演示用经验值。
        """
        return cls(
            base_vibration=p.base_vibration,
            base_temperature=p.base_temperature,
            base_current=p.base_current,
            base_pressure=p.base_pressure,
            base_speed=p.base_rpm,
            threshold_vibration=p.base_vibration * 5.0,
            threshold_temp=p.base_temperature + 30.0,
        )


class EdgeDetector:
    """边缘轻量异常检测器：滑动窗口 + 统计特征 + 阈值评分。"""

    def __init__(self, window_size: int = 64) -> None:
        self.window_size = window_size
        self.windows: dict[str, deque] = defaultdict(
            lambda: deque(maxlen=window_size)
        )
        self._profiles: dict[str, EdgeProfile] = {}

    def update(self, device_id: str, observations: dict) -> dict[str, Any]:
        """注入一条观测数据并返回当前边缘评分结果。"""
        self.windows[device_id].append(observations)
        return self.score(device_id)

    def score(self, device_id: str) -> dict[str, Any]:
        """对设备滑动窗口进行评分。"""
        window = list(self.windows.get(device_id, []))
        profile = self.profile_for(device_id)

        if not window:
            return self._empty(device_id)

        vib = self._series(window, "vibration")
        temp = self._series(window, "temperature")
        cur = self._series(window, "current")
        pres = self._series(window, "pressure")
        spd = self._series(window, "rpm", alias="speed")

        v_mean = self._mean(vib)
        t_mean = self._mean(temp)
        c_mean = self._mean(cur)
        p_mean = self._mean(pres)
        s_mean = self._mean(spd)

        v_range = max(profile.threshold_vibration - profile.base_vibration, 1e-6)
        vibration_score = _clamp((v_mean - profile.base_vibration) / v_range)

        t_range = max(profile.threshold_temp - profile.base_temperature, 1e-6)
        temperature_score = _clamp((t_mean - profile.base_temperature) / t_range)

        eff_current = (c_mean - profile.base_current) / max(
            profile.base_current * profile.efficiency_loss_scale, 1e-6
        )
        eff_pressure = (profile.base_pressure - p_mean) / max(
            profile.base_pressure * profile.efficiency_loss_scale, 1e-6
        )
        eff_speed = (profile.base_speed - s_mean) / max(
            profile.base_speed * profile.efficiency_loss_scale, 1e-6
        )
        efficiency_score = _clamp((eff_current + eff_pressure + eff_speed) / 3.0)

        scores = {
            "vibration": vibration_score,
            "temperature": temperature_score,
            "efficiency": efficiency_score,
        }
        suspicion = 1.0
        for s in scores.values():
            suspicion *= 1.0 - _clamp(s)
        suspicion = 1.0 - suspicion

        dominant = max(scores, key=scores.get)
        if scores[dominant] < DOMINANT_MIN_SCORE:
            dominant, label = "none", DIRECTION_LABELS["none"]
        else:
            label = DIRECTION_LABELS[dominant]

        return {
            "device_id": device_id,
            "edge_anomaly_score": round(suspicion, 4),
            "dominant_direction": dominant,
            "dominant_label": label,
            "direction_scores": {k: round(v, 4) for k, v in scores.items()},
            "trigger_full_diagnosis": suspicion > TRIGGER_THRESHOLD,
            "window_size": len(window),
        }

    # ---- 基准（子类可覆盖以接入各设备独立基准） ----
    def profile_for(self, device_id: str) -> EdgeProfile:
        """返回设备边缘基准。默认用通用基准，实际运行时按设备参数注册。"""
        return self._profiles.get(device_id, EdgeProfile())

    def register_profile(self, device_id: str, profile: EdgeProfile) -> None:
        self._profiles[device_id] = profile

    # ---- 工具方法 ----
    @staticmethod
    def _get(record: Any, key: str) -> Optional[float]:
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
        return sum(vals) / len(vals) if vals else 0.0

    @staticmethod
    def _empty(device_id: str) -> dict[str, Any]:
        return {
            "device_id": device_id,
            "edge_anomaly_score": 0.0,
            "dominant_direction": "none",
            "dominant_label": DIRECTION_LABELS["none"],
            "direction_scores": {"vibration": 0.0, "temperature": 0.0, "efficiency": 0.0},
            "trigger_full_diagnosis": False,
            "window_size": 0,
        }


class EdgeInferenceSimulator:
    """设备端边缘推理模拟器：编排设备数据生成与边缘评分。"""

    def __init__(self, fleet: DeviceFleet, window_size: int = 64) -> None:
        self.fleet = fleet
        self.detectors: dict[str, EdgeDetector] = {}
        for dev in fleet.devices:
            detector = EdgeDetector(window_size)
            detector.register_profile(
                dev.params.device_id, EdgeProfile.from_device_params(dev.params)
            )
            self.detectors[dev.params.device_id] = detector

    def step(self) -> dict[str, dict[str, Any]]:
        """推进一个时间步，返回各设备的边缘评分结果。"""
        self.fleet.step(1.0)
        results: dict[str, dict[str, Any]] = {}
        for dev in self.fleet.devices:
            payload = dev.generate_telemetry()
            obs = payload["observations"]
            edge = self.detectors[dev.params.device_id].update(dev.params.device_id, obs)
            # 将边缘评分合并进 payload，便于随传感器数据上报
            payload["edge_anomaly_score"] = edge["edge_anomaly_score"]
            payload["dominant_direction"] = edge["dominant_direction"]
            payload["dominant_label"] = edge["dominant_label"]
            payload["trigger_full_diagnosis"] = edge["trigger_full_diagnosis"]
            results[dev.params.device_id] = payload
        return results

    def run(
        self,
        interval: float = 1.0,
        use_mqtt: bool = False,
        host: str = "localhost",
        port: int = 1883,
        topic_prefix: str = "device",
        max_steps: Optional[int] = None,
    ) -> None:
        """持续运行边缘推理模拟器。"""
        mqtt_client = None
        if use_mqtt:
            if not _HAS_MQTT:
                raise RuntimeError("paho-mqtt 未安装，请先 pip install paho-mqtt")
            mqtt_client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2)
            mqtt_client.connect(host, port)
            mqtt_client.loop_start()

        step_count = 0
        try:
            while True:
                results = self.step()
                for device_id, payload in results.items():
                    edge = payload.get("edge_anomaly_score", 0.0)
                    direction = payload.get("dominant_label", "无")
                    if use_mqtt:
                        topic = f"{topic_prefix}/{device_id}/sensor_data"
                        mqtt_client.publish(topic, json.dumps(payload, ensure_ascii=False))
                    else:
                        print(
                            f"[{device_id}] edge_anomaly_score={edge:.4f} "
                            f"{direction} trigger={payload['trigger_full_diagnosis']}"
                        )
                step_count += 1
                if max_steps is not None and step_count >= max_steps:
                    break
                time.sleep(interval)
        except KeyboardInterrupt:
            pass
        finally:
            if mqtt_client is not None:
                mqtt_client.loop_stop()
                mqtt_client.disconnect()


def main() -> None:
    """命令行入口。"""
    parser = argparse.ArgumentParser(description="设备端边缘推理模拟器")
    parser.add_argument("--interval", type=float, default=1.0, help="步进间隔（秒）")
    parser.add_argument("--host", type=str, default="localhost", help="MQTT Broker 地址")
    parser.add_argument("--port", type=int, default=1883, help="MQTT Broker 端口")
    parser.add_argument("--use-mqtt", action="store_true", help="启用 MQTT 上报")
    parser.add_argument("--max-steps", type=int, default=None, help="最大步数（调试用）")
    args = parser.parse_args()

    fleet = DeviceFleet.default()
    simulator = EdgeInferenceSimulator(fleet)
    simulator.run(
        interval=args.interval,
        use_mqtt=args.use_mqtt,
        host=args.host,
        port=args.port,
        max_steps=args.max_steps,
    )


if __name__ == "__main__":
    main()