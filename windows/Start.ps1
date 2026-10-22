$ErrorActionPreference = 'Stop'
$appRoot = Split-Path $PSScriptRoot -Parent
$mainFile = Join-Path $appRoot 'service\main.mjs'
$running = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($mainFile) }
if ($running) { Write-Output 'Stash AI is already running.'; exit 0 }
$stateRoot = Join-Path $env:LOCALAPPDATA 'StashAICommandCenter'
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$nodeExe = (Get-Command node.exe -ErrorAction Stop).Source
Start-Process -FilePath $nodeExe -ArgumentList @('"' + $mainFile + '"') -WorkingDirectory $appRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $stateRoot 'service.log') -RedirectStandardError (Join-Path $stateRoot 'service-error.log')
Write-Output 'Started Stash AI in the background.'
