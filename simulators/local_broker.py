# -*- coding: utf-8 -*-
"""本地 MQTT Broker 启动器（开发/演示用）。

用纯 Python 的 amqtt 在 1883 端口起一个「匿名可用」的 MQTT 中转站，
配合：
  - simulators/virtual_device.py 或 edge_inference.py 的 --use-mqtt 上报
  - 后端 mqtt_pipeline 的订阅（POST /api/v1/mqtt-pipeline/start）
即可跑通「模拟器 -> Broker -> 后端」的真实消息流（而非后端兜底正弦波）。

生产环境建议替换为 mosquitto（见 docs/系统落地与部署说明.md 第 6 节）。

用法：
    .venv\\Scripts\\python.exe simulators\\local_broker.py
"""
from __future__ import annotations

import asyncio

from amqtt.broker import Broker


async def main() -> None:
    config = {
        "listeners": {
            "default": {"type": "tcp", "bind": "0.0.0.0:1883"},
        },
        "sys_interval": 10,
        "auth": {"allow-anonymous": True},
    }
    broker = Broker(config)
    await broker.start()
    print("[MQTT Broker] 已启动，监听 0.0.0.0:1883（Ctrl+C 停止）")
    await asyncio.Event().wait()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[MQTT Broker] 已停止")