@echo off
title Industrial Diagnosis System - Local Launcher

REM ============================================================
REM  Industrial Diagnosis System - one-click local startup
REM  MySQL (D:\MySQL) -> Backend (port 8000) -> Frontend (port 5173)
REM  Browser: http://localhost:5173   Login: admin / admin123
REM  NOTE: keep this file ASCII-only, or cmd may garble it (GBK).
REM ============================================================

set "ROOT=%~dp0"
set "PY=%ROOT%.venv\Scripts\python.exe"
set "NPM=D:\run nodejs yinqing\npm.cmd"
set "MYSQLD=D:\MySQL\bin\mysqld.exe"
set "MYINI=D:\MySQL\my.ini"

echo [1/4] Checking MySQL (port 3306)...
netstat -an | findstr ":3306 " | findstr "LISTENING" >nul 2>&1
if errorlevel 1 (
    echo       Starting MySQL, waiting 15 seconds...
    start "MySQL" /min "%MYSQLD%" --defaults-file="%MYINI%" --console
    timeout /t 15 /nobreak >nul
) else (
    echo       MySQL already running, skip.
)

echo [2/4] Starting backend on port 8000 ...
start "Backend-8000" cmd /k "cd /d %ROOT%backend && %PY% -m uvicorn app.main:app --port 8000"

echo [3/4] Starting frontend on port 5173 ...
start "Frontend-5173" /d "%ROOT%frontend" "%NPM%" run dev

echo [4/4] Waiting 15 seconds, then opening browser...
timeout /t 15 /nobreak >nul
start http://localhost:5173

echo.
echo ============================================================
echo  Startup finished.
echo    Frontend : http://localhost:5173
echo    API docs : http://localhost:8000/docs
echo    Login    : admin / admin123
echo  Do NOT close the MySQL / Backend / Frontend windows.
echo  To stop the system, just close those three windows.
echo ============================================================
pause
