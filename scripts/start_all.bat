@echo off
REM 一键启动脚本（Windows）：依次启动后端与前端。
REM 虚拟设备需 MQTT broker（Eclipse Mosquitto）才能实时上报，未安装 broker 时
REM 后端诊断链路仍可通过前端「AI 诊断」页手动发起会诊，或运行 scripts/demo_e2e.py。

echo [1/3] 启动后端 http://localhost:8000 ...
start "诊断系统后端" cmd /k "cd /d %~dp0..\backend && ..\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000"

timeout /t 5 /nobreak >nul

echo [2/3] 启动前端 http://localhost:5173 ...
start "诊断系统前端" cmd /k "cd /d %~dp0..\frontend && npm run dev"

timeout /t 3 /nobreak >nul

echo [3/3] 打开浏览器 ...
start http://localhost:5173

echo.
echo 启动完成：前端 http://localhost:5173  后端文档 http://localhost:8000/docs
echo 注意：两个终端窗口请勿关闭。