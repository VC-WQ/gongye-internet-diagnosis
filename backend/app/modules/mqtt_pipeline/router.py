"""MQTT 数据管道模块路由。"""
import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from .service import mqtt_pipeline_service
from .websocket_manager import websocket_manager

router = APIRouter(prefix="/mqtt-pipeline", tags=["MQTT数据管道"])


@router.post("/start")
async def start() -> dict:
    """启动数据管道。"""
    # 注入主事件循环，使 MQTT 线程能够跨线程推送 WebSocket
    mqtt_pipeline_service.attach_event_loop(asyncio.get_running_loop())
    mqtt_pipeline_service.start()
    return {"status": "started"}


@router.post("/stop")
async def stop() -> dict:
    """停止数据管道。"""
    mqtt_pipeline_service.stop()
    return {"status": "stopped"}


@router.get("/devices")
def list_devices() -> list[str]:
    """返回已缓存数据的设备 ID 列表。"""
    return mqtt_pipeline_service.get_devices()


@router.get("/window/{device_id}")
def get_window(device_id: str) -> list[dict]:
    """返回指定设备滑动窗口内的最近数据。"""
    return mqtt_pipeline_service.get_window(device_id)


@router.post("/{device_id}/command")
async def publish_command(device_id: str, command: dict) -> dict:
    """向设备下发指令。"""
    mqtt_pipeline_service.publish_command(device_id, command)
    return {"status": "sent"}


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket) -> None:
    """实时数据推送通道。"""
    await websocket_manager.connect(websocket)
    # 建立连接后注入主事件循环，保证后续 MQTT 消息可被推送
    mqtt_pipeline_service.attach_event_loop(asyncio.get_running_loop())
    try:
        while True:
            # 等待客户端消息（可用于心跳/订阅指令）；忽略内容，保持连接
            await websocket.receive_text()
    except WebSocketDisconnect:
        websocket_manager.disconnect(websocket)