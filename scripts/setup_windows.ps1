#Requires -Version 5.1
<#
.SYNOPSIS
  工业设备智能诊断系统 - Windows 一键安装脚本（可重复执行）。

.DESCRIPTION
  1) 检查 Python 与 Node.js 版本
  2) 创建独立 Python 虚拟环境 .venv
  3) 安装后端依赖（requirements.txt）
  4) 使用 npm ci 安装前端依赖（按 package-lock.json）
  5) 校验 CNN 权重存在
  6) RAG 索引缺失时自动重建
  7) 校验数据库目录
  8) backend/.env 不存在时按模板生成（不覆盖已有配置）
  9) 输出安装结果

.PARAMETER Mirror
  pip 镜像地址，默认使用阿里云镜像（可在国内加速，也可改为官方源）。

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File scripts/setup_windows.ps1
#>
[CmdletBinding()]
param(
    [string]$Mirror = "https://mirrors.aliyun.com/pypi/simple/"
)

$ErrorActionPreference = "Stop"
$ProjectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$Backend = Join-Path $ProjectRoot "backend"
$Frontend = Join-Path $ProjectRoot "frontend"
$Venv = Join-Path $ProjectRoot ".venv"
$VenvPython = Join-Path $Venv "Scripts\python.exe"

function Write-Step { param([string]$Msg) Write-Host "`n==> $Msg" -ForegroundColor Cyan }
function Write-Ok   { param([string]$Msg) Write-Host "    [OK] $Msg" -ForegroundColor Green }
function Write-Fail { param([string]$Msg) Write-Host "    [FAIL] $Msg" -ForegroundColor Red }

Write-Step "检测 Python"
$pythonCmd = $null
foreach ($cand in @("py -3.11", "py -3", "python3", "python")) {
    $exe = ($cand -split ' ')[0]
    $arg = ($cand -split ' ')
    if ($arg.Count -gt 1) { $arg = $arg[1] } else { $arg = $null }
    try {
        $probe = if ($arg) { & $exe $arg --version 2>&1 } else { & $exe --version 2>&1 }
    } catch { $probe = $null }
    if ($probe -match "Python 3\.(9|10|11|12)") {
        $pythonBase = if ($arg) { "$exe $arg" } else { $exe }
        Write-Ok "使用 $pythonBase ($($probe.Trim()))"
        break
    }
}
if (-not $pythonBase) {
    Write-Fail "未找到 Python 3.9~3.12。请安装 Python 3.11 并加入 PATH。"
    exit 1
}

Write-Step "检测 Node.js（要求 >= 20.19）"
$nodeVer = node --version 2>&1
if ($LASTEXITCODE -ne 0 -or -not $nodeVer) {
    Write-Fail "未找到 Node.js，请安装 Node.js 20.19+ 并加入 PATH。"
    exit 1
}
Write-Ok "Node.js $nodeVer"

Write-Step "创建 Python 虚拟环境"
if (-not (Test-Path $VenvPython)) {
    $pyExe = ($pythonBase -split ' ')[0]; $pyArg = ($pythonBase -split ' ')
    if ($pyArg.Count -gt 1) { & $pyExe $pyArg[1] -m venv $Venv } else { & $pyExe -m venv $Venv }
    if (-not (Test-Path $VenvPython)) { Write-Fail "venv 创建失败。"; exit 1 }
    Write-Ok "已创建 .venv"
} else {
    Write-Ok ".venv 已存在，跳过"
}

Write-Step "安装后端依赖（pip install -r backend/requirements.txt）"
& $VenvPython -m pip install --upgrade pip -i $Mirror 2>&1 | Out-Null
& $VenvPython -m pip install -r (Join-Path $Backend "requirements.txt") -i $Mirror
if ($LASTEXITCODE -ne 0) {
    Write-Fail "后端依赖安装失败（可改用官源：-Mirror https://pypi.org/simple/ 重试）。"
    exit 1
}
Write-Ok "后端依赖安装完成"

Write-Step "安装前端依赖（npm ci，按 package-lock.json）"
Push-Location $Frontend
$npmCmd = "npm"
try { & $npmCmd ci 2>&1 | Out-Null } catch { $npmOut = $null }
if ($LASTEXITCODE -ne 0) {
    # 兜底：本机 npm 可能被 PowerShell 执行策略拦截，提示使用 npm.cmd
    Pop-Location
    Write-Fail "npm ci 失败。如因执行策略，请在 PowerShell 用 `npm.cmd ci` 重试。"
    exit 1
}
Pop-Location
Write-Ok "前端依赖安装完成"

Write-Step "校验 CNN 权重"
$weight = Join-Path $ProjectRoot "models\cnn_bearing.pt"
if (-not (Test-Path $weight)) {
    Write-Fail "缺少 models/cnn_bearing.pt，无法推理。请从发布包/仓库恢复该权重后重试。"
    exit 1
}
Write-Ok "CNN 权重存在（$([math]::Round((Get-Item $weight).Length/1KB,1)) KB）"

Write-Step "校验 RAG 索引"
$chroma = Join-Path $ProjectRoot "data\chroma"
if (Test-Path (Join-Path $chroma "chroma.sqlite3")) {
    Write-Ok "RAG 索引已存在"
} else {
    Push-Location $Backend
    & $VenvPython -m scripts.build_rag_index
    if ($LASTEXITCODE -ne 0) {
        Pop-Location
        Write-Fail "RAG 索引重建失败，请检查网络与 chromadb 嵌入模型下载。"
        exit 1
    }
    Pop-Location
    Write-Ok "RAG 索引已重建"
}

Write-Step "校验数据库目录"
$dataDir = Join-Path $Backend "data"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir | Out-Null; Write-Ok "已创建 backend/data" }
else { Write-Ok "backend/data 已存在" }

Write-Step "生成环境配置（不覆盖已有 backend/.env）"
$envTarget = Join-Path $Backend ".env"
if (-not (Test-Path $envTarget)) {
    Copy-Item (Join-Path $Backend ".env.example") $envTarget
    Write-Ok "已从 backend/.env.example 生成 backend/.env，请填写 DEEPSEEK_API_KEY 等凭据"
} else {
    Write-Ok "backend/.env 已存在，保持不变（未覆盖）"
}

Write-Host "`n======================================================" -ForegroundColor Green
Write-Host "  安装完成。" -ForegroundColor Green
Write-Host "  下一步：编辑 backend/.env 填入你的 DeepSeek API Key，" -ForegroundColor Yellow
Write-Host "  然后运行 scripts/start_windows.ps1 启动系统。" -ForegroundColor Yellow
Write-Host "======================================================" -ForegroundColor Green