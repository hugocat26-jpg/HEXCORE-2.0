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
    $content = Get-Content -LiteralPath $EnvPath -Raw
    $changed = $false
    if (-not ($content -match "(?m)^HEXCORE_ROOM_CODE_SECRET=")) {
      $content = $content.TrimEnd() + "`r`nHEXCORE_ROOM_CODE_SECRET=$(New-HexcoreSecret)`r`n"
      $changed = $true
    } elseif ($content -match "(?m)^HEXCORE_ROOM_CODE_SECRET=change-this-local-room-code-secret\s*$") {
      $content = $content -replace "(?m)^HEXCORE_ROOM_CODE_SECRET=.*$", "HEXCORE_ROOM_CODE_SECRET=$(New-HexcoreSecret)"
      $changed = $true
    }
    if ($changed) {
      Write-Utf8NoBom -Path $EnvPath -Value $content
      Write-Step ".env found. Added missing local room-code secret."
    } else {
      Write-Step ".env found. Using existing local config."
    }
    return
  }
  if (-not (Test-Path $EnvExamplePath)) {
    throw ".env.example is missing. Please reinstall HEXCORE2."
  }

  $content = Get-Content -LiteralPath $EnvExamplePath -Raw
  $password = New-HexcoreSecret
  $roomCodeSecret = New-HexcoreSecret
  if ($content -match "(?m)^HEXCORE_POSTGRES_PASSWORD=") {
    $content = $content -replace "(?m)^HEXCORE_POSTGRES_PASSWORD=.*$", "HEXCORE_POSTGRES_PASSWORD=$password"
  } else {
    $content = $content.TrimEnd() + "`r`nHEXCORE_POSTGRES_PASSWORD=$password`r`n"
  }
  if ($content -match "(?m)^HEXCORE_ROOM_CODE_SECRET=") {
    $content = $content -replace "(?m)^HEXCORE_ROOM_CODE_SECRET=.*$", "HEXCORE_ROOM_CODE_SECRET=$roomCodeSecret"
  } else {
    $content = $content.TrimEnd() + "`r`nHEXCORE_ROOM_CODE_SECRET=$roomCodeSecret`r`n"
  }

  Write-Utf8NoBom -Path $EnvPath -Value $content
  Write-Step ".env generated. Local secrets are stored only in the local file."
}

function Assert-DockerCommand {
  $script:DockerCommand = Resolve-DockerCommand
  if (-not $script:DockerCommand) {
    throw @"
Docker command was not found.
Please install and start Docker Desktop, then run this shortcut again.
Optional install command: winget install Docker.DockerDesktop
If Docker was just installed, restart Windows or reopen this terminal.
"@
  }
}

function Assert-DockerDaemon {
  & $script:DockerCommand info *> $null
  if ($LASTEXITCODE -eq 0) {
    return
  }

  $dockerDesktop = Join-Path ${env:ProgramFiles} "Docker\Docker\Docker Desktop.exe"
  if (Test-Path $dockerDesktop) {
    Write-Step "Docker Desktop is installed but not ready. Starting it now."
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null
    for ($index = 0; $index -lt 60; $index += 1) {
      Start-Sleep -Seconds 2
      & $script:DockerCommand info *> $null
      if ($LASTEXITCODE -eq 0) {
        return
      }
    }
  }

  throw "Docker Desktop is not ready. Open Docker Desktop, wait until it is running, then run this shortcut again."
}

function Invoke-DockerCompose {
  param([string[]]$Arguments)
  & $script:DockerCommand @Arguments
  if ($LASTEXITCODE -ne 0) {
    $argumentText = $Arguments -join " "
    throw "docker $argumentText failed. Exit code: $LASTEXITCODE"
  }
}

function Test-DockerImage {
  param([string]$Image)
  & $script:DockerCommand image inspect $Image *> $null
  return ($LASTEXITCODE -eq 0)
}

function Ensure-DockerImage {
  param(
    [string]$Image,
    [string]$FallbackImage
  )
  if (Test-DockerImage -Image $Image) {
    return
  }

  Write-Step "Preparing Docker image: $Image"
  & $script:DockerCommand pull $Image
  if ($LASTEXITCODE -eq 0) {
    return
  }

  if (-not $FallbackImage) {
    throw "Docker image pull failed: $Image"
  }

  Write-Step "Primary image pull failed. Trying fallback image source."
  & $script:DockerCommand pull $FallbackImage
  if ($LASTEXITCODE -ne 0) {
    throw "Docker image fallback pull failed: $FallbackImage"
  }
  & $script:DockerCommand tag $FallbackImage $Image
  if ($LASTEXITCODE -ne 0) {
    throw "Docker image fallback tag failed: $FallbackImage -> $Image"
  }
}

function Test-HexcoreComposeRunning {
  $services = @(& $script:DockerCommand compose ps --services --status running 2>$null)
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
Ensure-DockerImage -Image "postgres:16-alpine" -FallbackImage "public.ecr.aws/docker/library/postgres:16-alpine"
Ensure-DockerImage -Image "node:24-slim" -FallbackImage "public.ecr.aws/docker/library/node:24-slim"

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
