param([switch]$Force)
$ErrorActionPreference = 'Stop'
$mainFile = Join-Path (Split-Path $PSScriptRoot -Parent) 'service\main.mjs'
$running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($mainFile) }
if (-not $running) { Write-Output 'Stash AI is not running.'; exit 0 }
if (-not $Force) {
  $stateRoot = Join-Path $env:LOCALAPPDATA 'StashAICommandCenter'
  $control = Get-Content -LiteralPath (Join-Path $stateRoot 'control.json') -Raw | ConvertFrom-Json
  $config = Get-Content -LiteralPath (Join-Path $stateRoot 'config.json') -Raw | ConvertFrom-Json
  Invoke-RestMethod -Uri ('http://127.0.0.1:' + $config.port + '/control/stop') -Method Post -Headers @{Authorization=('Bearer ' + $control.token)} | Out-Null
  foreach ($process in $running) { Wait-Process -Id $process.ProcessId -Timeout 20 -ErrorAction SilentlyContinue }
} else {
  foreach ($process in $running) {
    # Explicit emergency option, scoped to this installed entrypoint only.
    & taskkill.exe /PID $process.ProcessId /T /F | Out-Null
  }
}
Write-Output 'Shutdown requested. Conversations remain saved; in-flight writes finish or remain marked uncertain.'
