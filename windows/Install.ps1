param([switch]$EnableStartup)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$destinationRoot = Join-Path $env:LOCALAPPDATA 'StashAICommandCenter\app'
$pluginRoot = Join-Path $env:USERPROFILE '.stash\plugins\stash-ai-command-center'
foreach ($target in @($destinationRoot, $pluginRoot)) {
  if (Test-Path -LiteralPath $target) { throw "Existing target requires an explicit backed-up update: $target" }
}
& node.exe (Join-Path $sourceRoot 'scripts\check.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Validation failed.' }
New-Item -ItemType Directory -Path $destinationRoot, $pluginRoot -Force | Out-Null
foreach ($name in @('service','scripts','windows','package.json','package-lock.json','node_modules')) { Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination $destinationRoot -Recurse }
Get-ChildItem -LiteralPath (Join-Path $sourceRoot 'plugin') -File | ForEach-Object {
  Copy-Item -LiteralPath $_.FullName -Destination $pluginRoot
  if ((Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $pluginRoot $_.Name)).Hash) { throw 'Plugin hash mismatch.' }
}
  Copy-Item -LiteralPath (Join-Path $sourceRoot 'plugin\assets') -Destination $pluginRoot -Recurse
  if ((Get-FileHash -LiteralPath (Join-Path $sourceRoot 'plugin\assets\codex.png')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $pluginRoot 'assets\codex.png')).Hash) { throw 'Toolbar asset hash mismatch.' }
& (Join-Path $destinationRoot 'windows\Start.ps1')
if ($EnableStartup) { & (Join-Path $destinationRoot 'windows\Startup.ps1') }
$result = Invoke-RestMethod 'http://localhost:9999/graphql' -Method Post -ContentType 'application/json' -Body '{"query":"mutation{reloadPlugins}"}'
if ($result.errors) { throw 'Plugin files installed, but Stash reload needs manual attention.' }
Write-Output 'Installed Stash AI. Reload Stash, then open /plugins/stash-ai.'
