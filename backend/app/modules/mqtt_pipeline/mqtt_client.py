"""MQTT 客户端：负责 Broker 连接、主题订阅与消息分发。"""
import json
import logging
from typing import Callable, Optional

import paho.mqtt.client as mqtt

from app.config import settings

logger = logging.getLogger(__name__)

# 消息处理回调类型：接收 (device_id, payload_dict, topic)
MessageHandler = Callable[[Optional[str], dict, str], None]


class MQTTClient:
    """封装 paho-mqtt，提供连接、订阅、发布与消息分发能力。"""

    def __init__(self, handler: Optional[MessageHandler] = None) -> None:
        self.handler = handler
        self.client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2, client_id=settings.mqtt_client_id
        )
        # 认证配置（启用用户名时生效）
        if settings.mqtt_username:
            self.client.username_pw_set(settings.mqtt_username, settings.mqtt_password)

        self.client.on_connect = self._on_connect
        self.client.on_message = self._on_message
        self.client.on_disconnect = self._on_disconnect
        self._connected = False

    # ------------------------------------------------------------------
    # 生命周期
    # ------------------------------------------------------------------
    def connect(self) -> None:
        """连接 Broker 并启动网络循环。"""
        self.client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=60)
        self.client.loop_start()

    def disconnect(self) -> None:
        """停止网络循环并断开连接。"""
        self.client.loop_stop()
        self.client.disconnect()

    @property
    def is_connected(self) -> bool:
        """当前是否处于连接状态。"""
        return self._connected

    # ------------------------------------------------------------------
    # 回调
    # ------------------------------------------------------------------
    def _on_connect(self, client, userdata, flags, reason_code, properties) -> None:
        """连接成功回调：订阅设备传感器数据主题。"""
        self._connected = reason_code == 0
        if self._connected:
            client.subscribe(settings.mqtt_sensor_topic, qos=1)
            logger.info("MQTT 已连接，订阅主题：%s", settings.mqtt_sensor_topic)
        else:
            logger.warning("MQTT 连接失败，reason_code=%s", reason_code)

    def _on_disconnect(self, client, userdata, flags, reason_code, properties) -> None:
        """断开回调：标记状态，等待 paho 自动重连。"""
        self._connected = False
        logger.warning("MQTT 连接断开，reason_code=%s", reason_code)

    def _on_message(self, client, userdata, msg) -> None:
        """收到消息回调：解析 JSON 并分发到 handler。"""
        try:
            payload = json.loads(msg.payload.decode("utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            logger.warning("消息解析失败，topic=%s，err=%s", msg.topic, exc)
            return

        device_id = self._extract_device_id(msg.topic)
        if self.handler is not None:
            self.handler(device_id, payload, msg.topic)

    @staticmethod
    def _extract_device_id(topic: str) -> Optional[str]:
        """从主题中提取设备 ID。

        约定主题：device/{device_id}/sensor_data
        """
        parts = topic.split("/")
        if len(parts) >= 2 and parts[0] == "device":
            return parts[1]
        # 兜底：任意主题取倒数第二段作为设备 ID
        return parts[-2] if len(parts) >= 2 else None

    # ------------------------------------------------------------------
    # 发布
    # ------------------------------------------------------------------
    def publish(self, topic: str, payload: dict) -> None:
        """向指定主题发布 JSON 消息。"""
        self.client.publish(topic, json.dumps(payload, ensure_ascii=False), qos=1)