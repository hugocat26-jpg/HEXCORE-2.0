param(
  [string]$OutputPath = ""
)

$ErrorActionPreference = "Stop"

if (-not $env:HEXCORE_POSTGRES_URL) {
  throw "缺少 HEXCORE_POSTGRES_URL。请使用环境变量提供连接串，不要把连接串写入命令行、日志或前端状态。"
}

if (-not $OutputPath) {
  $stamp = Get-Date -Format "yyyyMMdd-HHmmss"
  $OutputPath = Join-Path (Get-Location) "hexcore-postgres-backup-$stamp.dump"
}

$target = [System.IO.Path]::GetFullPath($OutputPath)
$parent = Split-Path -Parent $target
if ($parent -and -not (Test-Path $parent)) {
  New-Item -ItemType Directory -Path $parent | Out-Null
}

$env:PGDATABASE = $env:HEXCORE_POSTGRES_URL

pg_dump `
  --format=custom `
  --no-owner `
  --no-acl `
  --file="$target"

Write-Host "PostgreSQL 备份已写入：$target"
Write-Host "请把该文件按裁判/管理员备份处理；其中包含服务端权威状态和凭据摘要。"
