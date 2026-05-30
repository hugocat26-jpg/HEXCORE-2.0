param(
  [ValidateSet("hexcore", "postgres", "all")]
  [string]$Service = "hexcore"
)

$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\.."))

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
  throw "Docker command was not found. Cannot show logs."
}

Set-Location $ProjectRoot

if ($Service -eq "all") {
  & $docker compose logs -f --tail=200
} else {
  & $docker compose logs -f --tail=200 $Service
}

exit $LASTEXITCODE
