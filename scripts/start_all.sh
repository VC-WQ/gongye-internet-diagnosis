#!/usr/bin/env bash
# 一键启动脚本（Linux/macOS）：依次启动后端与前端。
# 虚拟设备需 MQTT broker 才能实时上报；未安装 broker 时可运行 scripts/demo_e2e.py 演示闭环。
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "[1/3] 启动后端 http://localhost:8000 ..."
(cd "$ROOT/backend" && "$ROOT/.venv/bin/python" -m uvicorn app.main:app --port 8000) &
BACKEND_PID=$!

sleep 5

echo "[2/3] 启动前端 http://localhost:5173 ..."
(cd "$ROOT/frontend" && npm run dev) &
FRONTEND_PID=$!

echo "[3/3] 启动完成："
echo "  前端 http://localhost:5173"
echo "  后端文档 http://localhost:8000/docs"
echo "  停止：kill $BACKEND_PID $FRONTEND_PID"

wait