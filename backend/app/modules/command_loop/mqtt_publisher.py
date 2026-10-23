"""模块6 MQTT 指令下发（真实发布 + 回执）。

约束：
- 指令发布走真实 paho-mqtt，不再使用 mock 日志。
- 若 Broker 不可用，抛出 CommandPublishError，由路由映射为 503，
  绝不静默假装「已下发」。
- 设备回执由 mqtt_pipeline 订阅 device/+/command_ack 后写回 CommandRecord。
"""
from __future__ import annotations

import json
import logging
import time
from typing import Optional

import paho.mqtt.client as mqtt

from app.config import settings

logger = logging.getLogger(__name__)


class CommandPublishError(RuntimeError):
    """指令发布失败（Broker 不可用或发布被拒绝）。"""


class MqttCommandPublisher:
    """指令下发器：真实连接 Broker 并发布 JSON 指令。"""

    def __init__(
        self,
        topic_template: str = "device/{device_id}/command",
    ) -> None:
        self.topic_template = topic_template
        self._seq = 0
        self._client: Optional[mqtt.Client] = None

    # ------------------------------------------------------------------
    # 连接管理
    # ------------------------------------------------------------------
    def _ensure_client(self) -> mqtt.Client:
        """懒创建并连接发布客户端。"""
        if self._client is not None and self._client.is_connected():
            return self._client
        client = mqtt.Client(
            mqtt.CallbackAPIVersion.VERSION2,
            client_id=f"diagnosis-command-{settings.mqtt_client_id}",
        )
        if settings.mqtt_username:
            client.username_pw_set(settings.mqtt_username, settings.mqtt_password)
        try:
            client.connect(settings.mqtt_host, settings.mqtt_port, keepalive=60)
        except OSError as exc:
            raise CommandPublishError(
                f"MQTT Broker 不可用（{settings.mqtt_host}:{settings.mqtt_port}）：{exc}"
            ) from exc
        client.loop_start()
        self._client = client
        return client

    def close(self) -> None:
        """关闭发布客户端。"""
        if self._client is not None:
            try:
                self._client.loop_stop()
                self._client.disconnect()
            finally:
                self._client = None

    # ------------------------------------------------------------------
    # 发布
    # ------------------------------------------------------------------
    def publish_command(
        self,
        device_id: str,
        command: str,
        params: Optional[dict] = None,
        event_id: Optional[int] = None,
    ) -> dict:
        """下发指令并返回发布结果。

        Returns:
            {command_id, topic, published, error}
        Raises:
            CommandPublishError: Broker 不可用或发布失败。
        """
        self._seq += 1
        command_id = f"cmd-{device_id}-{self._seq}"
        topic = self.topic_template.format(device_id=device_id)
        payload = {
            "command_id": command_id,
            "event_id": event_id,
            "device_id": device_id,
            "command": command,
            "params": params or {},
            "timestamp": time.time(),
        }

        client = self._ensure_client()
        info = client.publish(
            topic, json.dumps(payload, ensure_ascii=False), qos=1
        )
        # wait_for_publish 在 QoS>0 时阻塞直至 PUBACK，确保「已下发」不是空话
        try:
            info.wait_for_publish(timeout=5)
        except Exception as exc:  # pragma: no cover - 网络异常
            raise CommandPublishError(f"指令发布超时：{exc}") from exc

        if info.rc != mqtt.MQTT_ERR_SUCCESS or not info.is_published():
            raise CommandPublishError(f"指令发布失败，rc={info.rc}")

        logger.info("指令已下发 %s -> %s", command_id, topic)
        return {
            "command_id": command_id,
            "topic": topic,
            "published": True,
            "error": None,
        }


mqtt_command_publisher = MqttCommandPublisher()
