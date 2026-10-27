#Requires -Version 5.1
<#
.SYNOPSIS
  工业设备智能诊断系统 - Windows 启动脚本（前端 + 后端）。

.DESCRIPTION
  - 校验 .venv 与 CNN 权重
  - 检查端口占用（不重复启动、不终止他人实例）
  - 用正确工作目录与虚拟环境 Python 启动后端 uvicorn
  - 启动前端 vite dev
  - 输出访问地址

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/start_windows.ps1
#>
$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Backend = Join-Path $ProjectRoot "backend"
$Frontend = Join-Path $ProjectRoot "frontend"
$VenvPython = Join-Path $ProjectRoot ".venv\Scripts\python.exe"

if (-not (Test-Path $VenvPython)) {
    Write-Host "[失败] 未找到 .venv，请先运行 scripts\setup_windows.ps1" -ForegroundColor Red
    exit 1
}
if (-not (Test-Path (Join-Path $ProjectRoot "models\cnn_bearing.pt"))) {
    Write-Host "[失败] 缺少 models\cnn_bearing.pt，无法推理" -ForegroundColor Red
    exit 1
}

function Test-PortInUse([int]$Port) {
    try {
        $c = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
        return ($null -ne $c)
    } catch { return $false }
}

# 后端
if (Test-PortInUse 8000) {
    Write-Host "[跳过] 端口 8000 已被占用，后端可能已在运行" -ForegroundColor Yellow
} else {
    Write-Host "[启动] 后端 http://localhost:8000 ..." -ForegroundColor Cyan
    Start-Process -FilePath $VenvPython `
        -ArgumentList "-m","uvicorn","app.main:app","--port","8000" `
        -WorkingDirectory $Backend
}

# 前端
if (Test-PortInUse 5173) {
    Write-Host "[跳过] 端口 5173 已被占用，前端可能已在运行" -ForegroundColor Yellow
} else {
    Write-Host "[启动] 前端 http://localhost:5173 ..." -ForegroundColor Cyan
    $npmCmd = "npm"
    if (Get-Command npm -ErrorAction SilentlyContinue) {
        Start-Process -FilePath $npmCmd -ArgumentList "run","dev" -WorkingDirectory $Frontend
    } elseif (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
        Start-Process -FilePath "npm.cmd" -ArgumentList "run","dev" -WorkingDirectory $Frontend
    } else {
        Write-Host "    [提示] 请在 frontend 目录手动执行 `npm run dev`" -ForegroundColor Yellow
    }
}

Start-Sleep -Seconds 3
Write-Host "`n======================================================" -ForegroundColor Green
Write-Host "  前端页面   : http://localhost:5173" -ForegroundColor Green
Write-Host "  后端 API   : http://localhost:8000/api/v1" -ForegroundColor Green
Write-Host "  健康检查   : http://localhost:8000/  (返回 {status:running})" -ForegroundColor Green
Write-Host "  接口文档   : http://localhost:8000/docs" -ForegroundColor Green
Write-Host "======================================================" -ForegroundColor Green
Write-Host "登录：默认管理员账号见 backend/.env 的 BOOTSTRAP_ADMIN_USERNAME / PASSWORD" -ForegroundColor Yellow