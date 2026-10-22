param([switch]$Disable)
$ErrorActionPreference = 'Stop'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Startup')) 'Stash AI Command Center.lnk'
if ($Disable) {
  if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath }
  Write-Output 'Removed the Stash AI startup shortcut. Application and data retained.'
} else {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = (Get-Command powershell.exe).Source
  $shortcut.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'Start.ps1') + '"'
  $shortcut.WorkingDirectory = Split-Path $PSScriptRoot -Parent
  $shortcut.WindowStyle = 7
  $shortcut.Description = 'Local-only Stash AI companion; no administrator rights required.'
  $shortcut.Save()
  Write-Output 'Enabled per-user Stash AI startup.'
}
