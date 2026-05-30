param(
  [ValidateSet("hexcore", "postgres", "all")]
  [string]$Service = "hexcore"
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\.."))

$docker = Get-Command docker -ErrorAction SilentlyContinue
if (-not $docker) {
  throw "Docker command was not found. Cannot show logs."
}

Set-Location $ProjectRoot

if ($Service -eq "all") {
  & docker compose logs -f --tail=200
} else {
  & docker compose logs -f --tail=200 $Service
}

exit $LASTEXITCODE
