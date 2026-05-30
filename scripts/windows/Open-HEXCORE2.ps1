$ErrorActionPreference = "Stop"

$ScriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = [System.IO.Path]::GetFullPath((Join-Path $ScriptRoot "..\.."))
$EnvPath = Join-Path $ProjectRoot ".env"

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

$appPort = Get-HexcoreEnvValue -Name "HEXCORE_APP_PORT" -DefaultValue "4186"
$url = "http://127.0.0.1:$appPort/"
Start-Process $url | Out-Null
Write-Host "[HEXCORE2] Opened: $url"
