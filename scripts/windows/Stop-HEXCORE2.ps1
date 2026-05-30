param(
  [switch]$RemoveVolumes
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\.."))

function Write-Step {
  param([string]$Message)
  Write-Host "[HEXCORE2] $Message"
}

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  throw "未检测到 docker 命令，无法停止容器。若 Docker Desktop 已卸载，可忽略此提示。"
}

Set-Location $ProjectRoot

if ($RemoveVolumes) {
  $confirm = Read-Host "将删除 PostgreSQL 数据卷，赛事数据会丢失。输入 DELETE 确认"
  if ($confirm -ne "DELETE") {
    Write-Step "已取消删除数据卷，仅停止容器。"
    & docker compose down
    exit $LASTEXITCODE
  }
  & docker compose down -v
  exit $LASTEXITCODE
}

Write-Step "停止 HEXCORE2 容器，保留 PostgreSQL 数据卷。"
& docker compose down
exit $LASTEXITCODE
