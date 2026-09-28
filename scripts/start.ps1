$ErrorActionPreference = 'Stop'
try {
$studioRoot = Split-Path $PSScriptRoot -Parent
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
if (-not $nodeCommand) {
  $nodePath = Join-Path $env:ProgramFiles 'nodejs\node.exe'
  if (-not (Test-Path -LiteralPath $nodePath)) { throw 'Run Setup.cmd first to install Node.js.' }
} else { $nodePath = $nodeCommand.Source }
& $nodePath (Join-Path $studioRoot 'scripts\launch.mjs')
if ($LASTEXITCODE -ne 0) { throw 'Studio could not start. See the message above.' }
} catch {
  Add-Type -AssemblyName PresentationFramework
  $null = [Windows.MessageBox]::Show($_.Exception.Message, 'Local AI Studio could not start')
  exit 1
}
