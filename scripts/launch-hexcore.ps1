param(
  [int]$PreferredPort = 4176,
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$Root = (Resolve-Path (Join-Path $PSScriptRoot '..')).ProviderPath

function Test-PortFree {
  param([int]$Port)
  try {
    $listener = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Parse('127.0.0.1'), $Port)
    $listener.Start()
    $listener.Stop()
    return $true
  } catch {
    return $false
  }
}

function Get-ContentType {
  param([string]$Path)
  switch ([System.IO.Path]::GetExtension($Path).ToLowerInvariant()) {
    '.html' { 'text/html; charset=utf-8' }
    '.js' { 'application/javascript; charset=utf-8' }
    '.css' { 'text/css; charset=utf-8' }
    '.json' { 'application/json; charset=utf-8' }
    '.csv' { 'text/csv; charset=utf-8' }
    '.svg' { 'image/svg+xml' }
    '.png' { 'image/png' }
    '.jpg' { 'image/jpeg' }
    '.jpeg' { 'image/jpeg' }
    '.ico' { 'image/x-icon' }
    default { 'application/octet-stream' }
  }
}

function Resolve-StaticFile {
  param([string]$RequestPath)

  if ([string]::IsNullOrWhiteSpace($RequestPath)) {
    $RequestPath = 'index.html'
  }
  $NormalizedRequestPath = $RequestPath.Replace('\', '/')
  if ($NormalizedRequestPath.StartsWith('assets/')) {
    $FullPath = [System.IO.Path]::GetFullPath((Join-Path (Join-Path $Root 'public') $NormalizedRequestPath))
    $AssetRoot = [System.IO.Path]::GetFullPath((Join-Path $Root 'public\assets')).TrimEnd('\') + '\'
    if (-not $FullPath.StartsWith($AssetRoot, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $null
    }
  } else {
    $FullPath = [System.IO.Path]::GetFullPath((Join-Path $Root $NormalizedRequestPath))
    $RootPath = [System.IO.Path]::GetFullPath($Root).TrimEnd('\') + '\'
    if (-not $FullPath.StartsWith($RootPath, [System.StringComparison]::OrdinalIgnoreCase)) {
      return $null
    }
    $RelativePath = $FullPath.Substring($RootPath.Length).Replace('\', '/')
    if ($RelativePath -ne 'index.html' -and -not $RelativePath.StartsWith('src/')) {
      return $null
    }
  }

  if (-not (Test-Path -LiteralPath $FullPath -PathType Leaf)) {
    return $null
  }
  return $FullPath
}

$Port = $PreferredPort
while ($Port -lt ($PreferredPort + 40) -and -not (Test-PortFree -Port $Port)) {
  $Port += 1
}
if ($Port -ge ($PreferredPort + 40)) {
  throw "No free local port found from $PreferredPort to $($PreferredPort + 39)."
}

$Prefix = "http://127.0.0.1:$Port/"
$Listener = [System.Net.HttpListener]::new()
$Listener.Prefixes.Add($Prefix)
$Listener.Start()

Write-Host "HEXCORE 2.0 is running at $Prefix"
Write-Host "Root: $Root"
Write-Host "Close this window to stop the local server."

if (-not $NoBrowser) {
  try {
    Start-Process 'msedge.exe' $Prefix
  } catch {
    Start-Process $Prefix
  }
}

try {
  while ($Listener.IsListening) {
    $Context = $Listener.GetContext()
    $RequestPath = [System.Uri]::UnescapeDataString($Context.Request.Url.AbsolutePath.TrimStart('/'))
    $FullPath = Resolve-StaticFile -RequestPath $RequestPath
    if (-not $FullPath) {
      $Context.Response.StatusCode = 404
      $Body = [System.Text.Encoding]::UTF8.GetBytes('Not Found')
      $Context.Response.OutputStream.Write($Body, 0, $Body.Length)
      $Context.Response.Close()
      continue
    }

    $Bytes = [System.IO.File]::ReadAllBytes($FullPath)
    $Context.Response.StatusCode = 200
    $Context.Response.ContentType = Get-ContentType -Path $FullPath
    $Context.Response.Headers['Cache-Control'] = 'no-store'
    $Context.Response.Headers['X-Content-Type-Options'] = 'nosniff'
    $Context.Response.OutputStream.Write($Bytes, 0, $Bytes.Length)
    $Context.Response.Close()
  }
} finally {
  if ($Listener.IsListening) {
    $Listener.Stop()
  }
  $Listener.Close()
}
