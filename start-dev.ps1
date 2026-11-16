# 本地开发启动脚本（Windows PowerShell）
# 用法：右键“使用 PowerShell 运行”，或在本目录执行  .\start-dev.ps1
# 默认地址 http://127.0.0.1:8848 ，代码改动自动热重载

$ErrorActionPreference = 'Stop'
$root = $PSScriptRoot
Set-Location $root

$venvPy = Join-Path $root '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    Write-Host '[init] 创建虚拟环境 .venv ...' -ForegroundColor Cyan
    python -m venv .venv
    & $venvPy -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
}

$env:DB_PATH = Join-Path $root 'data\tank.db'
if (-not $env:FT_SECRET) { $env:FT_SECRET = 'fish-tank-dev-secret' }
if (-not $env:TZ) { $env:TZ = 'Asia/Shanghai' }

Write-Host "[dev] DB_PATH = $env:DB_PATH" -ForegroundColor DarkGray
Write-Host '[dev] http://127.0.0.1:8848  (Ctrl+C 停止)' -ForegroundColor Green

Set-Location (Join-Path $root 'app')
& $venvPy -m uvicorn main:app --host 127.0.0.1 --port 8848 --reload
