"""物理数字孪生虚拟设备模拟器。

基于耦合随机微分方程(SDE)对工业设备（泵/电机/空压机）的退化过程进行物理建模：

1. 每个设备维护 3 个隐状态变量：
   - Wear       磨损（机械退化，正反馈加速）
   - Heat       热积累（散热与发热平衡）
   - Efficiency 效率衰减（由磨损与热共同驱动，单调下降）

2. 隐状态按耦合随机微分方程演化（欧拉-丸山离散化）：
     dWear       = (alpha1 * Wear + beta1 * Heat) * dt + sigma1 * dW1
     dHeat       = (alpha2 * Heat + beta2 * Wear * Load) * dt + sigma2 * dW2
     dEfficiency = -(gamma1 * Wear + gamma2 * Heat) * dt + sigma3 * dW3
   其中 alpha2 < 0 表示散热/冷却，热积累趋于与 Wear*Load 成正比的稳态；
   正反馈体现在：磨损增 -> 热负荷增 -> 退化加速。

3. 故障由隐状态越过临界阈值后"涌现"，而非手动注入：
     Wear >= wear_threshold            -> 轴承磨损故障
     Heat >= heat_threshold            -> 过热故障
     Efficiency <= efficiency_threshold -> 性能衰退故障

4. 隐状态映射为观测值：振动(加速度)、温度、电流、压力、转速、声学。
   观测值受噪声污染，隐状态作为 ground_truth 一并输出（供孪生/诊断模型训练评估）。

5. 支持 6 台设备，每台参数不同（设备异构性）。

6. 参考 CWRU 与 IMS 数据集的轴承退化特征频率（BPFO/BPFI/BSF/FTF）。

核心仿真部分仅依赖 Python 标准库，MQTT 上报为可选接口（懒加载 paho-mqtt）。
"""
from __future__ import annotations

import argparse
import json
import math
import random
import time
from dataclasses import dataclass, field
from typing import Any, Optional

# paho-mqtt 为可选依赖：仅在需要上报时导入，纯仿真不受其缺失影响
try:
    import paho.mqtt.client as mqtt

    _HAS_MQTT = True
except ImportError:  # pragma: no cover
    mqtt = None
    _HAS_MQTT = False


# ---------------------------------------------------------------------------
# 设备参数配置（异构性）
# ---------------------------------------------------------------------------
@dataclass
class DeviceParams:
    """单台设备的物理参数与阈值配置。"""

    device_id: str
    name: str
    device_type: str  # pump 泵 / motor 电机 / compressor 空压机

    # ---- SDE 漂移系数 ----
    alpha1: float  # 磨损自激励（正，驱动加速退化）
    beta1: float   # 热 -> 磨损 耦合
    alpha2: float  # 热积累自项（负，表示散热/冷却）
    beta2: float   # 磨损*负载 -> 热 耦合
    gamma1: float  # 磨损 -> 效率衰减
    gamma2: float  # 热 -> 效率衰减

    # ---- 扩散系数 ----
    sigma1: float
    sigma2: float
    sigma3: float

    # ---- 负载 ----
    load: float

    # ---- 临界阈值（故障涌现） ----
    wear_threshold: float
    heat_threshold: float
    efficiency_threshold: float

    # ---- 初始隐状态 ----
    wear0: float = 0.05
    heat0: float = 0.0
    efficiency0: float = 1.0

    # ---- 观测基准值（健康状态） ----
    base_vibration: float = 0.1   # 振动加速度 g (RMS)
    base_temperature: float = 45.0  # 温度 °C
    base_current: float = 5.0     # 电流 A
    base_pressure: float = 6.0    # 压力 bar
    base_rpm: float = 1480.0      # 转速 rpm
    base_acoustic: float = 65.0   # 声压级 dB

    # ---- 观测到隐状态的耦合系数 ----
    c_vib_wear: float = 2.0   # 磨损对振动的放大
    c_vib_heat: float = 0.1   # 热对振动的放大
    c_temp_heat: float = 55.0  # 热积累 -> 温升
    c_temp_wear: float = 18.0  # 磨损摩擦 -> 温升
    c_curr_eff: float = 8.0   # 效率损失 -> 电流上升
    c_pres_eff: float = 1.0   # 效率损失 -> 压力下降
    c_rpm_eff: float = 120.0  # 效率损失 -> 转速下降
    c_acu_vib: float = 30.0   # 振动 -> 声压级增量


# ---------------------------------------------------------------------------
# CWRU 轴承故障特征频率（参考 6205-2RS JEM SKF 深沟球轴承几何参数）
# ---------------------------------------------------------------------------
@dataclass(frozen=True)
class BearingGeometry:
    """轴承几何参数，用于计算故障特征频率。"""

    pitch_diameter: float = 39.04  # 节圆直径 D (mm)
    ball_diameter: float = 7.94    # 滚动体直径 d (mm)
    n_balls: int = 9               # 滚动体数量
    contact_angle: float = 0.0     # 接触角 φ (度)


def bearing_fault_frequencies(
    rpm: float, geometry: BearingGeometry = BearingGeometry()
) -> dict[str, float]:
    """按 CWRU 公式计算轴承故障特征频率。

    返回 BPFO(外圈)/BPFI(内圈)/BSF(滚动体)/FTF(保持架) 四个特征频率(Hz)。
    """
    fr = rpm / 60.0  # 转频
    phi = math.radians(geometry.contact_angle)
    ratio = geometry.ball_diameter / geometry.pitch_diameter * math.cos(phi)

    bpfo = (geometry.n_balls / 2.0) * fr * (1.0 - ratio)
    bpfi = (geometry.n_balls / 2.0) * fr * (1.0 + ratio)
    bsf = (geometry.pitch_diameter / (2.0 * geometry.ball_diameter)) * fr * (1.0 - ratio ** 2)
    ftf = (fr / 2.0) * (1.0 - ratio)

    return {
        "bpfo": round(bpfo, 3),  # 外圈缺陷
        "bpfi": round(bpfi, 3),  # 内圈缺陷
        "bsf": round(bsf, 3),    # 滚动体缺陷
        "ftf": round(ftf, 3),    # 保持架缺陷
        "shaft_freq": round(fr, 3),
    }


# ---------------------------------------------------------------------------
# 虚拟设备
# ---------------------------------------------------------------------------
class VirtualDevice:
    """单台虚拟设备：隐状态演化 + 观测生成 + 故障涌现。"""

    MAX_WEAR = 3.0      # 磨损上限（裁剪防溢出）
    MAX_HEAT = 3.0      # 热积累上限
    MIN_EFFICIENCY = 0.0

    def __init__(self, params: DeviceParams, seed: Optional[int] = None) -> None:
        self.params = params
        self.rng = random.Random(seed)

        # 隐状态初始化
        self.wear = params.wear0
        self.heat = params.heat0
        self.efficiency = params.efficiency0

        # 运行时状态
        self.t = 0.0                       # 虚拟运行时长（秒）
        self.health_score = 100.0          # 健康评分 0~100
        self.status = "healthy"            # healthy / degraded / fault
        self.faults: list[dict[str, Any]] = []  # 当前活跃故障

    # ------------------------------------------------------------------
    # 隐状态演化（耦合 SDE，欧拉-丸山离散化）
    # ------------------------------------------------------------------
    def step(self, dt: float = 1.0) -> None:
        """推进一个时间步 dt（秒），演化隐状态并更新故障/健康。"""
        sqrt_dt = math.sqrt(dt)
        p = self.params

        # 三个独立的维纳增量 dW ~ N(0, dt)
        dw1 = self.rng.gauss(0.0, 1.0) * sqrt_dt
        dw2 = self.rng.gauss(0.0, 1.0) * sqrt_dt
        dw3 = self.rng.gauss(0.0, 1.0) * sqrt_dt

        # 漂移项（正反馈：磨损升高 -> 热负荷升高 -> 退化加速）
        drift_wear = p.alpha1 * self.wear + p.beta1 * self.heat
        drift_heat = p.alpha2 * self.heat + p.beta2 * self.wear * p.load
        drift_eff = -(p.gamma1 * self.wear + p.gamma2 * self.heat)

        wear_new = self.wear + drift_wear * dt + p.sigma1 * dw1
        heat_new = self.heat + drift_heat * dt + p.sigma2 * dw2
        eff_new = self.efficiency + drift_eff * dt + p.sigma3 * dw3

        # 物理约束裁剪
        self.wear = min(max(wear_new, 0.0), self.MAX_WEAR)
        self.heat = min(max(heat_new, 0.0), self.MAX_HEAT)
        self.efficiency = min(max(eff_new, self.MIN_EFFICIENCY), 1.0)

        self.t += dt
        self._update_faults()
        self._update_health()

    # ------------------------------------------------------------------
    # 故障涌现（隐状态越过阈值）
    # ------------------------------------------------------------------
    def _update_faults(self) -> None:
        """根据隐状态与阈值判定并更新活跃故障。"""
        p = self.params
        self.faults = []

        # 轴承磨损故障
        if self.wear >= p.wear_threshold:
            severity = min(
                (self.wear - p.wear_threshold) / (self.MAX_WEAR - p.wear_threshold), 1.0
            )
            self.faults.append(
                {
                    "type": "bearing_wear",
                    "label": "轴承磨损故障",
                    "severity": round(severity, 4),
                    "value": round(self.wear, 4),
                    "threshold": p.wear_threshold,
                }
            )

        # 过热故障
        if self.heat >= p.heat_threshold:
            severity = min(
                (self.heat - p.heat_threshold) / (self.MAX_HEAT - p.heat_threshold), 1.0
            )
            self.faults.append(
                {
                    "type": "overheat",
                    "label": "过热故障",
                    "severity": round(severity, 4),
                    "value": round(self.heat, 4),
                    "threshold": p.heat_threshold,
                }
            )

        # 性能衰退故障
        if self.efficiency <= p.efficiency_threshold:
            severity = min(
                (p.efficiency_threshold - self.efficiency) / p.efficiency_threshold, 1.0
            )
            self.faults.append(
                {
                    "type": "performance_degradation",
                    "label": "性能衰退故障",
                    "severity": round(severity, 4),
                    "value": round(self.efficiency, 4),
                    "threshold": p.efficiency_threshold,
                }
            )

    def _update_health(self) -> None:
        """由隐状态综合计算健康评分并推导运行状态。

        【使用依据说明】健康评分公式与状态分级为工程启发式设定（非教科书公式）：
        - 权重 0.25/0.15：磨损、热对健康的惩罚强度，为人工经验取值，无数据标定依据。
        - 状态分级 80 分：healthy/degraded 的划分线，为演示用经验阈值。
        生产落地时应对标 ISO 13381（故障预测与健康管理）或设备厂商健康管理规范，
        用历史运行数据回归标定权重与分级线，而非沿用本演示值。
        """
        p = self.params
        wear_level = min(self.wear / p.wear_threshold, 1.0) if p.wear_threshold else 0.0
        heat_level = min(self.heat / p.heat_threshold, 1.0) if p.heat_threshold else 0.0

        # 效率为主，磨损与热作为惩罚项（工程启发式加权，见 docstring 依据说明）
        score = (
            100.0
            * self.efficiency
            * (1.0 - 0.25 * wear_level - 0.15 * heat_level)
        )
        self.health_score = max(0.0, min(100.0, score))

        if self.faults:
            self.status = "fault"
        elif self.health_score < 80.0:
            self.status = "degraded"
        else:
            self.status = "healthy"

    # ------------------------------------------------------------------
    # 隐状态 -> 观测值映射
    # ------------------------------------------------------------------
    def observe(self) -> dict[str, float]:
        """将隐状态映射为带噪声的观测值。"""
        p = self.params
        # 维度化后的损伤程度（可超过 1，表示越过阈值后继续恶化）
        wear_excess = self.wear
        eff_loss = 1.0 - self.efficiency

        vibration = (
            p.base_vibration
            + p.c_vib_wear * (wear_excess ** 2)
            + p.c_vib_heat * max(self.heat, 0.0)
            + self.rng.gauss(0.0, 0.02)
        )
        temperature = (
            p.base_temperature
            + p.c_temp_heat * self.heat
            + p.c_temp_wear * wear_excess
            + self.rng.gauss(0.0, 0.5)
        )
        current = (
            p.base_current * (1.0 + 0.1 * (p.load - 1.0))
            + p.c_curr_eff * eff_loss
            + self.rng.gauss(0.0, 0.05)
        )
        pressure = (
            p.base_pressure * self.efficiency
            - p.c_pres_eff * wear_excess
            + self.rng.gauss(0.0, 0.03)
        )
        rpm = p.base_rpm - p.c_rpm_eff * eff_loss + self.rng.gauss(0.0, 2.0)
        acoustic = p.base_acoustic + p.c_acu_vib * vibration + self.rng.gauss(0.0, 0.5)

        return {
            "vibration": round(max(vibration, 0.0), 4),
            "temperature": round(max(temperature, 0.0), 4),
            "current": round(max(current, 0.0), 4),
            "pressure": round(max(pressure, 0.0), 4),
            "rpm": round(max(rpm, 0.0), 4),
            "acoustic": round(max(acoustic, 0.0), 4),
        }

    # ------------------------------------------------------------------
    # 遥测负载组装
    # ------------------------------------------------------------------
    def generate_telemetry(self) -> dict[str, Any]:
        """生成一帧完整的遥测数据（与后端 Event.sensor_data 结构对齐）。"""
        observations = self.observe()
        payload: dict[str, Any] = {
            "device_id": self.params.device_id,
            "name": self.params.name,
            "device_type": self.params.device_type,
            "source": "simulation",
            "timestamp": time.time(),
            "elapsed": round(self.t, 3),
            "status": self.status,
            "health_score": round(self.health_score, 4),
            "observations": observations,
            # 隐状态作为 ground_truth 输出（真实世界中不可直接观测，仅供训练/评估）
            "hidden_state": {
                "wear": round(self.wear, 6),
                "heat": round(self.heat, 6),
                "efficiency": round(self.efficiency, 6),
            },
            "faults": self.faults,
            "bearing_fault_freqs": bearing_fault_frequencies(observations["rpm"]),
        }
        return payload

    def to_json(self) -> str:
        """序列化为 JSON 字符串。"""
        return json.dumps(self.generate_telemetry(), ensure_ascii=False)


# ---------------------------------------------------------------------------
# 设备集群（6 台异构设备）
# ---------------------------------------------------------------------------
class DeviceFleet:
    """管理多台异构虚拟设备，支持批量步进与 MQTT 上报。"""

    def __init__(self, devices: list[VirtualDevice]) -> None:
        self.devices = devices
        self.mqtt_client: Any = None

    @staticmethod
    def default() -> "DeviceFleet":
        """构造默认的 6 台异构设备：泵/电机/空压机各 2 台，参数各不相同。"""
        presets = [
            # 泵 1：健康、退化缓慢
            DeviceParams(
                device_id="pump-001", name="离心泵 A", device_type="pump",
                alpha1=1e-4, beta1=1e-4, alpha2=-0.05, beta2=0.015,
                gamma1=3e-5, gamma2=1e-5, sigma1=0.003, sigma2=0.004, sigma3=0.0005,
                load=1.0, wear_threshold=1.0, heat_threshold=1.0, efficiency_threshold=0.7,
                base_rpm=2900.0, base_pressure=8.0, base_current=7.0,
            ),
            # 泵 2：已接近磨损阈值（用于演示故障涌现）
            DeviceParams(
                device_id="pump-002", name="离心泵 B", device_type="pump",
                alpha1=1e-3, beta1=2e-4, alpha2=-0.05, beta2=0.02,
                gamma1=6e-5, gamma2=2e-5, sigma1=0.004, sigma2=0.005, sigma3=0.0006,
                load=1.2, wear_threshold=1.0, heat_threshold=1.2, efficiency_threshold=0.7,
                wear0=0.55, base_rpm=2950.0, base_pressure=8.0, base_current=7.5,
            ),
            # 电机 1：健康
            DeviceParams(
                device_id="motor-001", name="驱动电机 A", device_type="motor",
                alpha1=1.2e-4, beta1=8e-5, alpha2=-0.06, beta2=0.012,
                gamma1=2.5e-5, gamma2=8e-6, sigma1=0.0025, sigma2=0.003, sigma3=0.0004,
                load=1.0, wear_threshold=1.0, heat_threshold=1.0, efficiency_threshold=0.7,
                base_vibration=0.12, base_current=5.0, base_rpm=1480.0,
            ),
            # 电机 2：热负荷偏高、中等磨损
            DeviceParams(
                device_id="motor-002", name="驱动电机 B", device_type="motor",
                alpha1=6e-4, beta1=1.5e-4, alpha2=-0.04, beta2=0.018,
                gamma1=5e-5, gamma2=1.5e-5, sigma1=0.003, sigma2=0.004, sigma3=0.0005,
                load=1.3, wear_threshold=1.0, heat_threshold=0.9, efficiency_threshold=0.7,
                wear0=0.30, heat0=0.2, base_vibration=0.13, base_current=6.0, base_rpm=1470.0,
            ),
            # 空压机 1：健康
            DeviceParams(
                device_id="compressor-001", name="空压机 A", device_type="compressor",
                alpha1=1.1e-4, beta1=9e-5, alpha2=-0.055, beta2=0.014,
                gamma1=3e-5, gamma2=1e-5, sigma1=0.003, sigma2=0.0035, sigma3=0.0005,
                load=1.1, wear_threshold=1.0, heat_threshold=1.1, efficiency_threshold=0.7,
                base_temperature=60.0, base_pressure=7.0, base_acoustic=72.0, base_rpm=1500.0,
            ),
            # 空压机 2：效率衰减偏快、近阈值
            DeviceParams(
                device_id="compressor-002", name="空压机 B", device_type="compressor",
                alpha1=8e-4, beta1=1.8e-4, alpha2=-0.045, beta2=0.02,
                gamma1=8e-5, gamma2=2e-5, sigma1=0.0035, sigma2=0.0045, sigma3=0.0006,
                load=1.25, wear_threshold=1.0, heat_threshold=1.0, efficiency_threshold=0.75,
                wear0=0.4, heat0=0.15, base_temperature=62.0, base_pressure=7.0,
                base_acoustic=73.0, base_rpm=1490.0,
            ),
        ]
        devices = [VirtualDevice(p) for p in presets]
        return DeviceFleet(devices)

    # ------------------------------------------------------------------
    # 批量步进 + 观测
    # ------------------------------------------------------------------
    def step(self, dt: float = 1.0) -> None:
        """推进全集群一个时间步。"""
        for dev in self.devices:
            dev.step(dt)

    def snapshot(self) -> list[dict[str, Any]]:
        """获取全集群当前遥测快照。"""
        return [dev.generate_telemetry() for dev in self.devices]

    def inject_fault(self, device_id: str, severity: float = 1.2) -> bool:
        """演示用故障注入：将指定设备的隐状态推过故障阈值。

        注意：这里改变的是仿真初始状态，后续观测值仍由 SDE 正常演化产生，
        不是伪造上报数据。用于在演示中稳定复现「异常 -> 告警」链路。
        """
        for dev in self.devices:
            if dev.params.device_id == device_id:
                dev.wear = dev.params.wear_threshold * severity
                dev.heat = dev.params.heat_threshold * severity
                dev.efficiency = max(0.0, dev.efficiency - 0.3)
                return True
        return False

    # ------------------------------------------------------------------
    # MQTT 上报接口
    # ------------------------------------------------------------------
    def connect_mqtt(
        self,
        host: str = "localhost",
        port: int = 1883,
        topic_prefix: str = "device",
    ) -> None:
        """建立 MQTT 连接（可选依赖 paho-mqtt）。

        上报主题格式：{topic_prefix}/{device_id}/sensor_data，
        默认与后端配置 mqtt_sensor_topic（device/+/sensor_data）保持一致。
        """
        if not _HAS_MQTT:
            raise RuntimeError(
                "paho-mqtt 未安装，无法启用 MQTT 上报。请先执行 pip install paho-mqtt"
            )
        self.topic_prefix = topic_prefix
        self.mqtt_client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"virtual-device-fleet-{int(time.time())}",
        )
        # 订阅云端下发的指令，执行后回执（真实闭环的下行半边）
        self.mqtt_client.on_message = self._on_command
        self.mqtt_client.connect(host, port)
        self.mqtt_client.subscribe(f"{topic_prefix}/+/command", qos=1)
        self.mqtt_client.loop_start()

    # ------------------------------------------------------------------
    # 指令执行与回执
    # ------------------------------------------------------------------
    def _on_command(self, client, userdata, msg) -> None:
        """收到云端指令：对虚拟设备执行维护动作并回执。"""
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError):
            return

        parts = msg.topic.split("/")
        device_id = parts[1] if len(parts) >= 3 else payload.get("device_id")
        device = next(
            (d for d in self.devices if d.params.device_id == device_id), None
        )
        if device is None:
            status, effect = "failed", {"reason": "device_not_found"}
        else:
            status, effect = self._apply_command(device, payload.get("command", ""))

        ack = {
            "command_id": payload.get("command_id"),
            "event_id": payload.get("event_id"),
            "device_id": device_id,
            "status": status,
            "effect": effect,
            "timestamp": time.time(),
        }
        client.publish(
            f"{self.topic_prefix}/{device_id}/command_ack",
            json.dumps(ack, ensure_ascii=False),
            qos=1,
        )

    @staticmethod
    def _apply_command(device: "VirtualDevice", command: str) -> tuple[str, dict]:
        """按指令关键字对虚拟设备施加维护效果（模拟真实检修动作）。"""
        text = command or ""
        before = {
            "wear": round(device.wear, 4),
            "heat": round(device.heat, 4),
            "efficiency": round(device.efficiency, 4),
        }

        if any(k in text for k in ("更换", "检修", "维修", "replace", "repair")):
            device.wear = max(0.0, device.wear * 0.3)
            device.heat = max(0.0, device.heat * 0.4)
            action = "replace_or_repair"
        elif any(k in text for k in ("润滑", "lubricat")):
            device.wear = max(0.0, device.wear * 0.6)
            device.heat = max(0.0, device.heat * 0.8)
            action = "lubricate"
        elif any(k in text for k in ("降载", "降速", "reduce")):
            device.heat = max(0.0, device.heat * 0.7)
            action = "reduce_load"
        else:
            # 通用处置：小幅缓解，避免「收到指令但什么都没发生」
            device.wear = max(0.0, device.wear * 0.9)
            device.heat = max(0.0, device.heat * 0.9)
            action = "generic_maintenance"

        after = {
            "wear": round(device.wear, 4),
            "heat": round(device.heat, 4),
            "efficiency": round(device.efficiency, 4),
        }
        return "done", {"action": action, "before": before, "after": after}

    def publish(self) -> None:
        """将全集群当前遥测发布到 MQTT。"""
        if self.mqtt_client is None:
            raise RuntimeError("尚未连接 MQTT，请先调用 connect_mqtt()")
        for dev in self.devices:
            topic = f"{self.topic_prefix}/{dev.params.device_id}/sensor_data"
            self.mqtt_client.publish(topic, dev.to_json())

    def disconnect_mqtt(self) -> None:
        """断开 MQTT 连接。"""
        if self.mqtt_client is not None:
            self.mqtt_client.loop_stop()
            self.mqtt_client.disconnect()
            self.mqtt_client = None

    # ------------------------------------------------------------------
    # 运行循环
    # ------------------------------------------------------------------
    def run(
        self,
        interval: float = 1.0,
        use_mqtt: bool = False,
        host: str = "localhost",
        port: int = 1883,
        max_steps: Optional[int] = None,
    ) -> None:
        """持续运行集群：步进 -> 观测 -> (可选)上报。"""
        if use_mqtt:
            self.connect_mqtt(host, port)

        step_count = 0
        try:
            while True:
                self.step(interval)
                payload = self.snapshot()
                # 默认打印到控制台；启用 MQTT 时同时上报
                if use_mqtt:
                    self.publish()
                else:
                    self._print_payload(payload[-1])  # 只打印最新一台的摘要
                step_count += 1
                if max_steps is not None and step_count >= max_steps:
                    break
                time.sleep(interval)
        except KeyboardInterrupt:
            pass
        finally:
            if use_mqtt:
                self.disconnect_mqtt()

    @staticmethod
    def _print_payload(payload: dict[str, Any]) -> None:
        """打印单个设备遥测摘要。"""
        obs = payload["observations"]
        print(
            f"[{payload['device_id']}] status={payload['status']:<9} "
            f"health={payload['health_score']:6.2f} "
            f"vib={obs['vibration']:.4f} temp={obs['temperature']:6.2f} "
            f"curr={obs['current']:5.2f} pres={obs['pressure']:5.2f} "
            f"rpm={obs['rpm']:7.1f} acu={obs['acoustic']:5.1f} "
            f"faults={[f['type'] for f in payload['faults']]}"
        )


# ---------------------------------------------------------------------------
# 入口
# ---------------------------------------------------------------------------
def main() -> None:
    """命令行入口。"""
    parser = argparse.ArgumentParser(description="物理数字孪生虚拟设备模拟器")
    parser.add_argument("--interval", type=float, default=1.0, help="上报/步进间隔（秒）")
    parser.add_argument("--host", type=str, default="localhost", help="MQTT Broker 地址")
    parser.add_argument("--port", type=int, default=1883, help="MQTT Broker 端口")
    parser.add_argument("--use-mqtt", action="store_true", help="启用 MQTT 上报")
    parser.add_argument("--max-steps", type=int, default=None, help="最大步数（调试用）")
    parser.add_argument(
        "--fault-device",
        type=str,
        default=None,
        help="启动时把指定设备置为故障状态（演示用，改变仿真初始状态）",
    )
    args = parser.parse_args()

    fleet = DeviceFleet.default()
    if args.fault_device:
        ok = fleet.inject_fault(args.fault_device)
        print(
            f"[fault-injection] {args.fault_device}: "
            f"{'已置为故障状态' if ok else '设备不存在'}"
        )
    fleet.run(
        interval=args.interval,
        use_mqtt=args.use_mqtt,
        host=args.host,
        port=args.port,
        max_steps=args.max_steps,
    )


if __name__ == "__main__":
    main()