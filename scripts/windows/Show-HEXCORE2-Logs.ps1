param(
  [ValidateSet("hexcore", "postgres", "all")]
  [string]$Service = "hexcore"
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\.."))

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  throw "未检测到 docker 命令，无法查看日志。"
}

Set-Location $ProjectRoot

if ($Service -eq "all") {
  & docker compose logs -f --tail=200
} else {
  & docker compose logs -f --tail=200 $Service
}

exit $LASTEXITCODE
