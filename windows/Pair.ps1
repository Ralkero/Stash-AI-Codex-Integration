$ErrorActionPreference = 'Stop'
& (Join-Path $PSScriptRoot 'Stop.ps1')
$appRoot = Split-Path $PSScriptRoot -Parent
& node.exe (Join-Path $appRoot 'scripts\pairing.mjs')
& (Join-Path $PSScriptRoot 'Start.ps1')
Write-Output 'Paste the code into Stash AI within 15 minutes. Keep this code private.'
