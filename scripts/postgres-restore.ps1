param(
  [Parameter(Mandatory = $true)]
  [string]$BackupPath,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"

if (-not $env:HEXCORE_POSTGRES_URL) {
  throw "缺少 HEXCORE_POSTGRES_URL。请使用环境变量提供连接串，不要把连接串写入命令行、日志或前端状态。"
}

$source = [System.IO.Path]::GetFullPath($BackupPath)
if (-not (Test-Path $source)) {
  throw "备份文件不存在：$source"
}

$env:PGDATABASE = $env:HEXCORE_POSTGRES_URL

$args = @(
  "--no-owner",
  "--no-acl"
)

if ($Clean) {
  $args += "--clean"
  $args += "--if-exists"
}

$args += $source

pg_restore @args

Write-Host "PostgreSQL 备份已恢复：$source"
