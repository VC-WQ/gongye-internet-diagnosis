"""MQTT 数据管道服务：订阅、滑动窗口缓存与 WebSocket 推送编排。"""
import asyncio
import logging
import time
from collections import defaultdict, deque
from threading import Lock
from typing import Any, Optional

from app.config import settings

from .mqtt_client import MQTTClient
from .websocket_manager import websocket_manager

logger = logging.getLogger(__name__)

# 每个设备滑动窗口容量（最近 N 条数据）
WINDOW_SIZE = 64


class MQTTPipelineService:
    """MQTT 数据管道服务单例。

    职责：
    1. 通过 MQTTClient 订阅 device/{device_id}/sensor_data 主题
    2. 将消息归一化为统一数据点并写入每台设备的滑动窗口（最近 64 条）
    3. 通过 WebSocketManager 实时推送到前端
    """

    def __init__(self) -> None:
        self.client: Optional[MQTTClient] = None
        self._windows: dict[str, deque] = defaultdict(lambda: deque(maxlen=WINDOW_SIZE))
        self._lock = Lock()
        self._started = False
        self._loop: Optional[asyncio.AbstractEventLoop] = None

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------
    def attach_event_loop(self, loop: asyncio.AbstractEventLoop) -> None:
        """注入主事件循环，供 MQTT 线程通过 run_coroutine_threadsafe 推送。

        MQTT 回调运行在 paho 网络线程中，而 WebSocket 广播是异步的；
        需要持有运行中的主循环才能安全地跨线程调度协程。
        """
        self._loop = loop

    def start(self) -> None:
        """连接 Broker 并开始订阅。"""
        if self._started:
            return
        self.client = MQTTClient(handler=self.handle_message)
        self.client.connect()
        self._started = True
        logger.info("MQTT 数据管道已启动")

    def stop(self) -> None:
        """停止数据管道并释放连接。"""
        if self.client is not None:
            self.client.disconnect()
            self.client = None
        self._started = False
        logger.info("MQTT 数据管道已停止")

    @property
    def is_running(self) -> bool:
        """数据管道是否运行中。"""
        return self._started

    # ------------------------------------------------------------------
    # 消息处理（运行在 paho 网络线程）
    # ------------------------------------------------------------------
    def handle_message(self, device_id: Optional[str], payload: dict, topic: str) -> None:
        """处理单条传感器消息：归一化 -> 写窗口 -> WebSocket 推送。"""
        if device_id is None:
            logger.warning("无法从主题提取设备 ID：%s", topic)
            return

        data_point = self._normalize(device_id, payload)

        # 写滑动窗口（线程安全）
        with self._lock:
            self._windows[device_id].append(data_point)

        # 异步调度 WebSocket 广播
        self._broadcast(data_point)

    def _broadcast(self, data_point: dict[str, Any]) -> None:
        """将数据点跨线程投递到主事件循环进行广播。"""
        if self._loop is None:
            logger.debug("主事件循环未注入，跳过 WebSocket 推送")
            return
        future = asyncio.run_coroutine_threadsafe(
            websocket_manager.broadcast(data_point), self._loop
        )
        future.add_done_callback(self._on_broadcast_done)

    @staticmethod
    def _on_broadcast_done(future: asyncio.Future) -> None:
        """记录广播任务异常。"""
        exc = future.exception()
        if exc is not None:
            logger.warning("WebSocket 广播失败：%s", exc)

    # ------------------------------------------------------------------
    # 字段归一化
    # ------------------------------------------------------------------
    @staticmethod
    def _first(d: dict, keys: tuple, default: Any = None) -> Any:
        """按优先级返回第一个存在的非空字段（用于兼容不同命名）。"""
        for k in keys:
            if k in d and d[k] is not None:
                return d[k]
        return default

    def _normalize(self, device_id: str, payload: dict) -> dict[str, Any]:
        """将上游消息归一化为统一数据点结构。

        兼容两种上游：
        - 扁平结构：直接含 edge_anomaly_score / vibration / speed 等字段
        - 嵌套结构（虚拟设备模拟器）：observations.* 与 hidden_state.*
        """
        # 兼容嵌套结构
        obs = payload.get("observations", {}) if isinstance(payload.get("observations"), dict) else {}
        hidden = payload.get("hidden_state", {}) if isinstance(payload.get("hidden_state"), dict) else {}

        def pick(*paths: str) -> Any:
            """按顺序在多层级间查找字段。"""
            for path in paths:
                if path in payload:
                    return payload[path]
            return None

        return {
            "device_id": device_id,
            "timestamp": self._first(
                payload, ("timestamp", "ts"), default=time.time()
            ),
            # 边缘异常分数
            "edge_anomaly_score": self._first(
                payload, ("edge_anomaly_score", "anomaly_score"), default=0.0
            ),
            # 隐状态（虚拟设备 hidden_state.{wear,heat,efficiency}）
            "latent_wear": self._first(
                payload, ("latent_wear",), default=self._first(hidden, ("wear",), 0.0)
            ),
            "latent_heat": self._first(
                payload, ("latent_heat",), default=self._first(hidden, ("heat",), 0.0)
            ),
            "latent_efficiency": self._first(
                payload, ("latent_efficiency",), default=self._first(hidden, ("efficiency",), 1.0)
            ),
            # 物理残差
            "physics_residual": self._first(
                payload, ("physics_residual", "pinn_residual"), default=None
            ),
            # 声学特征
            "acoustic_features": self._first(
                payload, ("acoustic_features",),
                default=self._first(obs, ("acoustic",), None),
            ),
            # 观测值（speed 对应模拟器的 rpm）
            "vibration": self._first(
                payload, ("vibration",), default=self._first(obs, ("vibration",), None)
            ),
            "temperature": self._first(
                payload, ("temperature",), default=self._first(obs, ("temperature",), None)
            ),
            "current": self._first(
                payload, ("current",), default=self._first(obs, ("current",), None)
            ),
            "pressure": self._first(
                payload, ("pressure",), default=self._first(obs, ("pressure",), None)
            ),
            "speed": self._first(
                payload, ("speed",), default=self._first(obs, ("rpm",), None)
            ),
        }

    # ------------------------------------------------------------------
    # 查询接口
    # ------------------------------------------------------------------
    def get_window(self, device_id: str) -> list[dict[str, Any]]:
        """返回指定设备滑动窗口内的最近数据（最多 64 条）。

        若 MQTT 管道尚未收到数据（例如未部署 Broker 或模拟器未运行），
        则回退为「确定性模拟波形」，保证实时传感器曲线始终有数据可演示。
        """
        with self._lock:
            window = list(self._windows.get(device_id, []))
        if window:
            return window
        return self._simulate_window(device_id)

    # ------------------------------------------------------------------
    # 兜底模拟（无 MQTT 数据时按设备生成平滑波形）
    # ------------------------------------------------------------------
    @staticmethod
    def _simulate_window(device_id: str, size: int = 48) -> list[dict[str, Any]]:
        """无 MQTT 数据时按设备生成一段平滑传感器波形。

        相位随时间缓慢流动，模拟「实时刷新」；设备名做稳定种子，
        使不同设备的波形可区分。仅含观测通道，供实时曲线直接绘制。
        """
        import numpy as np

        # 稳定种子（不用 hash()，避免进程随机化）
        seed = sum((i + 1) * ord(c) for i, c in enumerate(device_id)) % 1000
        t = np.arange(size, dtype=float) + int(time.time() // 3)
        rng = np.random.RandomState(seed)

        # 每台设备一个退化系数（磨损越重的设备振动/温度略高）
        degrade = 1.0 + (seed % 5) * 0.06
        chans = {
            "vibration": 0.12 * degrade + 0.05 * np.sin(t / 8 + seed) + rng.uniform(0, 0.02, size),
            "temperature": 46 + (seed % 5) + 6 * np.sin(t / 30 + seed / 3) + rng.uniform(-0.4, 0.4, size),
            "current": 6.0 * degrade + 0.6 * np.sin(t / 12 + seed / 2) + rng.uniform(-0.1, 0.1, size),
            "pressure": 6.5 + 0.4 * np.sin(t / 20 + seed / 5) + rng.uniform(-0.05, 0.05, size),
            "speed": 1480 + 25 * np.sin(t / 40 + seed / 7) + rng.uniform(-2, 2, size),
            "acoustic": 68 + (seed % 6) + 4 * np.sin(t / 9 + seed / 4) + rng.uniform(-0.3, 0.3, size),
        }
        return [
            {k: round(float(chans[k][i]), 4) for k in chans}
            for i in range(size)
        ]

    def get_devices(self) -> list[str]:
        """返回当前已缓存数据的设备 ID 列表。"""
        with self._lock:
            return list(self._windows.keys())

    # ------------------------------------------------------------------
    # 指令下发
    # ------------------------------------------------------------------
    def publish_command(self, device_id: str, command: dict) -> None:
        """向指定设备下发指令。"""
        if self.client is None:
            raise RuntimeError("MQTT 数据管道未启动，无法下发指令")
        topic = f"{settings.mqtt_topic_prefix}/{device_id}/command"
        self.client.publish(topic, command)


mqtt_pipeline_service = MQTTPipelineService()