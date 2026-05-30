param(
  [switch]$NoOpen,
  [switch]$SkipBuild
)

$ErrorActionPreference = "Stop"

try {
  [Console]::OutputEncoding = [System.Text.UTF8Encoding]::new()
} catch {
  # Older Windows PowerShell can keep the default console encoding.
}

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\.."))
$EnvPath = Join-Path $ProjectRoot ".env"
$EnvExamplePath = Join-Path $ProjectRoot ".env.example"

function Write-Step {
  param([string]$Message)
  Write-Host "[HEXCORE2] $Message"
}

function New-HexcoreSecret {
  $bytes = New-Object byte[] 32
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  try {
    $rng.GetBytes($bytes)
  } finally {
    $rng.Dispose()
  }
  return [Convert]::ToBase64String($bytes).TrimEnd("=").Replace("+", "-").Replace("/", "_")
}

function Write-Utf8NoBom {
  param(
    [string]$Path,
    [string]$Value
  )
  $encoding = New-Object System.Text.UTF8Encoding $false
  [System.IO.File]::WriteAllText($Path, $Value, $encoding)
}

function Get-HexcoreEnvValue {
  param(
    [string]$Name,
    [string]$DefaultValue
  )
  if (-not (Test-Path $EnvPath)) {
    return $DefaultValue
  }
  foreach ($line in Get-Content -LiteralPath $EnvPath) {
    if ($line -match "^\s*$([regex]::Escape($Name))=(.*)$") {
      return $Matches[1].Trim().Trim('"').Trim("'")
    }
  }
  return $DefaultValue
}

function Ensure-HexcoreEnvFile {
  if (Test-Path $EnvPath) {
    Write-Step ".env found. Using existing local config."
    return
  }
  if (-not (Test-Path $EnvExamplePath)) {
    throw ".env.example is missing. Please reinstall HEXCORE2."
  }

  $content = Get-Content -LiteralPath $EnvExamplePath -Raw
  $password = New-HexcoreSecret
  if ($content -match "(?m)^HEXCORE_POSTGRES_PASSWORD=") {
    $content = $content -replace "(?m)^HEXCORE_POSTGRES_PASSWORD=.*$", "HEXCORE_POSTGRES_PASSWORD=$password"
  } else {
    $content = $content.TrimEnd() + "`r`nHEXCORE_POSTGRES_PASSWORD=$password`r`n"
  }

  Write-Utf8NoBom -Path $EnvPath -Value $content
  Write-Step ".env generated. The database password is stored only in the local file."
}

function Assert-DockerCommand {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw @"
Docker command was not found.
Please install and start Docker Desktop, then run this shortcut again.
Optional install command: winget install Docker.DockerDesktop
If Docker was just installed, restart Windows or reopen this terminal.
"@
  }
}

function Assert-DockerDaemon {
  & docker info *> $null
  if ($LASTEXITCODE -eq 0) {
    return
  }

  $dockerDesktop = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dockerDesktop) {
    Write-Step "Docker Desktop is installed but not ready. Starting it now."
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null
    for ($index = 0; $index -lt 60; $index += 1) {
      Start-Sleep -Seconds 2
      & docker info *> $null
      if ($LASTEXITCODE -eq 0) {
        return
      }
    }
  }

  throw "Docker Desktop is not ready. Open Docker Desktop, wait until it is running, then run this shortcut again."
}

function Invoke-DockerCompose {
  param([string[]]$Arguments)
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    $argumentText = $Arguments -join " "
    throw "docker $argumentText failed. Exit code: $LASTEXITCODE"
  }
}

function Test-HexcoreComposeRunning {
  $services = @(& docker compose ps --services --status running 2>$null)
  return ($services -contains "hexcore")
}

function Assert-HexcorePortsAvailable {
  $appPort = Get-HexcoreEnvValue -Name "HEXCORE_APP_PORT" -DefaultValue "4186"
  $apiPort = Get-HexcoreEnvValue -Name "HEXCORE_API_PORT" -DefaultValue "4196"
  $busyPorts = @()
  foreach ($port in @($appPort, $apiPort)) {
    $connections = Get-NetTCPConnection -LocalPort ([int]$port) -State Listen -ErrorAction SilentlyContinue
    if ($connections) {
      $busyPorts += $port
    }
  }
  if ($busyPorts.Count -eq 0) {
    return
  }
  if (Test-HexcoreComposeRunning) {
    return
  }
  $portText = ($busyPorts | Select-Object -Unique) -join ", "
  throw @"
HEXCORE2 ports are already in use: $portText
Close the old HEXCORE2 window or run Stop HEXCORE2 first.
If a development copy is running, stop it with: docker compose down
"@
}

function Wait-HexcoreHealth {
  $apiPort = Get-HexcoreEnvValue -Name "HEXCORE_API_PORT" -DefaultValue "4196"
  $healthUrl = "http://127.0.0.1:$apiPort/health"
  for ($index = 0; $index -lt 60; $index += 1) {
    try {
      $health = Invoke-RestMethod -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
      if ($health.ok -and $health.runtime.storage -eq "postgres") {
        Write-Step "Service is ready. Storage: postgres."
        return $healthUrl
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  throw "PostgreSQL health check did not become ready in time: $healthUrl"
}

Set-Location $ProjectRoot
Write-Step "Project root: $ProjectRoot"
Ensure-HexcoreEnvFile
Assert-DockerCommand
Assert-DockerDaemon
Assert-HexcorePortsAvailable

$composeArgs = @("compose", "up", "-d")
if (-not $SkipBuild) {
  $composeArgs += "--build"
}

Write-Step "Starting Docker PostgreSQL stack."
Invoke-DockerCompose -Arguments $composeArgs
$healthUrl = Wait-HexcoreHealth

$appPort = Get-HexcoreEnvValue -Name "HEXCORE_APP_PORT" -DefaultValue "4186"
$appUrl = "http://127.0.0.1:$appPort/"
Write-Step "App URL: $appUrl"
Write-Step "Health URL: $healthUrl"

if (-not $NoOpen) {
  Start-Process $appUrl | Out-Null
}
