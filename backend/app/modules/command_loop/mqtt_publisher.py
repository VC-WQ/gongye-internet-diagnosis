"""模块6 MQTT 指令下发（mock 模式）。

约束：正式 MQTT 必须用 paho-mqtt；当前 mock=True 不真连 broker，
仅记录日志并返回 command_id，实际发送预留 paho 实现。
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


class MqttCommandPublisher:
    """指令下发器：mock 模式只记日志，真实模式预留 paho 发布。"""

    def __init__(
        self,
        mock: bool = True,
        topic_template: str = "device/{device_id}/command",
    ) -> None:
        self.mock = mock
        self.topic_template = topic_template
        self._seq = 0

    def publish_command(
        self, device_id: str, command: str, params: dict | None = None
    ) -> str:
        """下发指令并返回 command_id。

        mock 模式：不连 broker，仅记录日志（真实发送走 _real_publish）。
        """
        self._seq += 1
        command_id = f"cmd-{device_id}-{self._seq}"
        topic = self.topic_template.format(device_id=device_id)
        params = params or {}

        if self.mock:
            logger.info(
                "[MOCK] 下发指令 %s -> topic=%s command=%s params=%s",
                command_id, topic, command, params,
            )
        else:
            self._real_publish(topic, command, params)

        return command_id

    def _real_publish(self, topic: str, command: str, params: dict) -> None:
        """真实 paho-mqtt 发布（预留，mock 模式不触发）。"""
        import paho.mqtt.client as mqtt  # noqa: F401  # 满足 paho-mqtt 约束

        # TODO: 连接 broker -> publish(topic, payload) -> disconnect
        raise NotImplementedError("真实 MQTT 下发尚未启用（当前 mock=True）")


mqtt_command_publisher = MqttCommandPublisher(mock=True)