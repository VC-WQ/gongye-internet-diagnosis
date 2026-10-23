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
        self.client = MQTTClient(
            handler=self.handle_message,
            ack_handler=self.handle_ack,
        )
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
        from .store import save_point

        save_point(data_point)

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
            # Preserve declared provenance; an absent label is never promoted to real data.
            "source": payload.get("source") if isinstance(payload.get("source"), str) else "unknown",
            "acoustic": self._first(payload, ("acoustic", "sound_level"), default=None),
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

        优先读数据库。没有落库记录时才看内存窗口。
        """
        from .store import load_window

        stored = load_window(device_id)
        if stored:
            return stored
        with self._lock:
            return list(self._windows.get(device_id, []))

    # ------------------------------------------------------------------
    # 指令回执
    # ------------------------------------------------------------------
    def handle_ack(
        self, device_id: Optional[str], payload: dict, topic: str
    ) -> None:
        """处理设备指令回执：写回 CommandRecord 状态（运行在 paho 线程）。"""
        command_id = payload.get("command_id")
        event_id = payload.get("event_id")
        status = str(payload.get("status", "done"))

        # 延迟导入，避免模块级循环依赖
        from app.models import SessionLocal
        from app.modules.command_loop.models import CommandRecord

        db = SessionLocal()
        try:
            record = None
            if event_id is not None:
                record = (
                    db.query(CommandRecord)
                    .filter(CommandRecord.event_id == event_id)
                    .order_by(CommandRecord.id.desc())
                    .first()
                )
            if record is None and device_id is not None:
                record = (
                    db.query(CommandRecord)
                    .filter(CommandRecord.device_id == device_id)
                    .order_by(CommandRecord.id.desc())
                    .first()
                )
            if record is None:
                logger.warning("收到无法匹配的指令回执：topic=%s payload=%s", topic, payload)
                return

            params = dict(record.params or {})
            params["ack"] = payload
            record.params = params
            record.status = status
            db.commit()
            logger.info("指令回执已入库：%s status=%s", command_id, status)
        except Exception as exc:  # pragma: no cover - 线程内兜底
            logger.warning("指令回执入库失败：%s", exc)
        finally:
            db.close()

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