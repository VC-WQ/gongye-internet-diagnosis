"""WebSocket 连接管理器：维护前端连接并向其广播实时数据。"""
import asyncio
import logging
from typing import Any

from fastapi import WebSocket

logger = logging.getLogger(__name__)


class WebSocketManager:
    """管理活动 WebSocket 连接并广播消息。"""

    def __init__(self) -> None:
        self.active_connections: list[WebSocket] = []
        self._lock = asyncio.Lock()

    async def connect(self, websocket: WebSocket) -> None:
        """接受新连接并登记。"""
        await websocket.accept()
        async with self._lock:
            self.active_connections.append(websocket)
        logger.info("WebSocket 连接建立，当前连接数=%d", len(self.active_connections))

    def disconnect(self, websocket: WebSocket) -> None:
        """移除已断开连接。"""
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)
        logger.info("WebSocket 连接断开，当前连接数=%d", len(self.active_connections))

    async def broadcast(self, message: dict[str, Any]) -> None:
        """向所有前端连接广播消息，自动清理失效连接。"""
        dead: list[WebSocket] = []
        for ws in self.active_connections:
            try:
                await ws.send_json(message)
            except Exception as exc:  # noqa: BLE001
                logger.debug("向连接发送失败：%s", exc)
                dead.append(ws)
        for ws in dead:
            self.disconnect(ws)

    @property
    def connection_count(self) -> int:
        """当前活动连接数。"""
        return len(self.active_connections)


websocket_manager = WebSocketManager()