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

function Resolve-DockerCommand {
  $command = Get-Command docker -ErrorAction SilentlyContinue
  if ($command) {
    return $command.Source
  }

  $candidates = @()
  foreach ($base in @(${env:ProgramFiles}, ${env:ProgramW6432}, ${env:ProgramFiles(x86)})) {
    if ($base) {
      $candidates += Join-Path $base "Docker\Docker\resources\bin\docker.exe"
    }
  }
  foreach ($candidate in $candidates) {
    if ($candidate -and (Test-Path $candidate)) {
      return $candidate
    }
  }

  return $null
}

$docker = Resolve-DockerCommand
if (-not $docker) {
  throw "Docker command was not found. Cannot stop containers. If Docker Desktop was uninstalled, ignore this message."
}

Set-Location $ProjectRoot

if ($RemoveVolumes) {
  $confirm = Read-Host "This will delete the PostgreSQL data volume. Type DELETE to confirm"
  if ($confirm -ne "DELETE") {
    Write-Step "Data volume deletion cancelled. Containers will be stopped only."
    & $docker compose down
    exit $LASTEXITCODE
  }
  & $docker compose down -v
  exit $LASTEXITCODE
}

Write-Step "Stopping HEXCORE2 containers and keeping the PostgreSQL data volume."
& $docker compose down
exit $LASTEXITCODE
