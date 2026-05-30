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
  [System.Security.Cryptography.RandomNumberGenerator]::Fill($bytes)
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
    Write-Step "已检测到 .env，沿用现有本机配置。"
    return
  }
  if (-not (Test-Path $EnvExamplePath)) {
    throw "缺少 .env.example，无法生成本机运行配置。请确认安装包完整。"
  }

  $content = Get-Content -LiteralPath $EnvExamplePath -Raw
  $password = New-HexcoreSecret
  if ($content -match "(?m)^HEXCORE_POSTGRES_PASSWORD=") {
    $content = $content -replace "(?m)^HEXCORE_POSTGRES_PASSWORD=.*$", "HEXCORE_POSTGRES_PASSWORD=$password"
  } else {
    $content = $content.TrimEnd() + "`r`nHEXCORE_POSTGRES_PASSWORD=$password`r`n"
  }

  Write-Utf8NoBom -Path $EnvPath -Value $content
  Write-Step "已生成本机 .env。密码只写入本机文件，不会显示在控制台。"
}

function Assert-DockerCommand {
  $docker = Get-Command docker -ErrorAction SilentlyContinue
  if (-not $docker) {
    throw @"
未检测到 docker 命令。
请先安装并启动 Docker Desktop，然后重新运行本脚本。
可选安装方式：winget install Docker.DockerDesktop
安装后如仍不可用，请重启电脑或重新打开终端。
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
    Write-Step "Docker Desktop 已安装但服务未就绪，正在尝试启动。"
    Start-Process -FilePath $dockerDesktop -WindowStyle Hidden | Out-Null
    for ($index = 0; $index -lt 60; $index += 1) {
      Start-Sleep -Seconds 2
      & docker info *> $null
      if ($LASTEXITCODE -eq 0) {
        return
      }
    }
  }

  throw "Docker Desktop 未启动或 WSL2 尚未就绪。请打开 Docker Desktop，等待状态正常后重新运行本脚本。"
}

function Invoke-DockerCompose {
  param([string[]]$Arguments)
  & docker @Arguments
  if ($LASTEXITCODE -ne 0) {
    throw "docker $($Arguments -join ' ') 执行失败，退出码：$LASTEXITCODE"
  }
}

function Wait-HexcoreHealth {
  $apiPort = Get-HexcoreEnvValue -Name "HEXCORE_API_PORT" -DefaultValue "4196"
  $healthUrl = "http://127.0.0.1:$apiPort/health"
  for ($index = 0; $index -lt 60; $index += 1) {
    try {
      $health = Invoke-RestMethod -UseBasicParsing -Uri $healthUrl -TimeoutSec 3
      if ($health.ok -and $health.runtime.storage -eq "postgres") {
        Write-Step "服务已就绪，当前存储：postgres。"
        return $healthUrl
      }
    } catch {
      Start-Sleep -Seconds 2
    }
  }
  throw "服务启动后未能在限定时间内确认 PostgreSQL 健康状态：$healthUrl"
}

Set-Location $ProjectRoot
Write-Step "工作目录：$ProjectRoot"
Ensure-HexcoreEnvFile
Assert-DockerCommand
Assert-DockerDaemon

$composeArgs = @("compose", "up", "-d")
if (-not $SkipBuild) {
  $composeArgs += "--build"
}

Write-Step "启动 Docker PostgreSQL 版本。"
Invoke-DockerCompose -Arguments $composeArgs
$healthUrl = Wait-HexcoreHealth

$appPort = Get-HexcoreEnvValue -Name "HEXCORE_APP_PORT" -DefaultValue "4186"
$appUrl = "http://127.0.0.1:$appPort/"
Write-Step "页面地址：$appUrl"
Write-Step "健康检查：$healthUrl"

if (-not $NoOpen) {
  Start-Process $appUrl | Out-Null
}
