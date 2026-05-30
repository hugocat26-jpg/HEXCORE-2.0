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
  throw "Docker command was not found. Cannot stop containers. If Docker Desktop was uninstalled, ignore this message."
}

Set-Location $ProjectRoot

if ($RemoveVolumes) {
  $confirm = Read-Host "This will delete the PostgreSQL data volume. Type DELETE to confirm"
  if ($confirm -ne "DELETE") {
    Write-Step "Data volume deletion cancelled. Containers will be stopped only."
    & docker compose down
    exit $LASTEXITCODE
  }
  & docker compose down -v
  exit $LASTEXITCODE
}

Write-Step "Stopping HEXCORE2 containers and keeping the PostgreSQL data volume."
& docker compose down
exit $LASTEXITCODE
