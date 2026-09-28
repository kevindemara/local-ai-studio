$ErrorActionPreference = 'Stop'
$studioRoot = Split-Path $PSScriptRoot -Parent
Add-Type -AssemblyName PresentationFramework
[xml]$layout = @'
<Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" Title="Set up Local AI Studio" Height="470" Width="570" ResizeMode="NoResize" WindowStartupLocation="CenterScreen" Background="#24262D" Foreground="#F0F2F5">
 <StackPanel Margin="30"><TextBlock Text="Local AI Studio" FontSize="28" FontWeight="SemiBold"/><TextBlock Margin="0,15,0,20" TextWrapping="Wrap" FontSize="14" Text="This setup installs Node.js if needed, prepares Studio, and creates a desktop shortcut. The next wizard checks your hardware and helps you choose free models."/>
 <TextBlock Text="Model weights and GitHub login are not included in the download." TextWrapping="Wrap" Margin="0,0,0,18"/>
 <CheckBox Name="shortcut" IsChecked="True" Foreground="#E2E7EB" Content="Create a desktop shortcut" Margin="0,0,0,15"/>
 <TextBlock TextWrapping="Wrap" Text="Required tools come from the official Windows package registry. You may see a Windows administrator prompt when installing Node.js." Margin="0,0,0,20" Foreground="#B9C1CE"/>
 <Button Name="install" Content="Install and open setup wizard" Height="43" Background="#B5EAD9" Foreground="#20292A"/>
 <TextBlock Name="status" Margin="0,20,0,0" TextWrapping="Wrap" Text="Ready to install."/>
 </StackPanel>
</Window>
'@
$reader = New-Object System.Xml.XmlNodeReader $layout
$window = [Windows.Markup.XamlReader]::Load($reader)
$install = $window.FindName('install'); $status = $window.FindName('status'); $shortcut = $window.FindName('shortcut')
$script:studioInstallAccepted = $false
$install.Add_Click({ $script:studioInstallAccepted = $true; $window.Close() })
$null = $window.ShowDialog()
if (-not $script:studioInstallAccepted) { exit 0 }
$nodeCommand = Get-Command node -ErrorAction SilentlyContinue
$nodePath = if ($nodeCommand) { $nodeCommand.Source } else { Join-Path $env:ProgramFiles 'nodejs\node.exe' }
if (-not (Test-Path -LiteralPath $nodePath)) {
  if (-not (Get-Command winget -ErrorAction SilentlyContinue)) { throw 'Install Microsoft App Installer from the Microsoft Store, then run Setup.cmd again.' }
  Write-Host 'Installing Node.js from the official Windows package registry...'
  & winget install --id OpenJS.NodeJS.LTS --exact --source winget --silent --accept-package-agreements --accept-source-agreements --disable-interactivity
  if ($LASTEXITCODE -ne 0) { throw 'Node.js installation did not complete. Install it from https://nodejs.org/en/download and retry.' }
  $nodePath = Join-Path $env:ProgramFiles 'nodejs\node.exe'
}
$nodeMajor = [int]((& $nodePath --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 22) { throw 'Node.js 22 or newer is required. Update Node.js from nodejs.org and retry.' }
$npmPath = Join-Path (Split-Path $nodePath -Parent) 'node_modules\npm\bin\npm-cli.js'
if (-not (Test-Path -LiteralPath $npmPath)) { throw 'Install Node.js with npm and retry.' }
Push-Location $studioRoot
try { & $nodePath $npmPath ci --ignore-scripts --no-fund; if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check your internet connection and retry.' } } finally { Pop-Location }
if ($shortcut.IsChecked) {
  $shell = New-Object -ComObject WScript.Shell
  $link = $shell.CreateShortcut((Join-Path ([Environment]::GetFolderPath('Desktop')) 'Local AI Studio Public.lnk'))
  $link.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $link.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy RemoteSigned -File "' + (Join-Path $studioRoot 'scripts\start.ps1') + '"'
  $link.WorkingDirectory = $studioRoot; $link.Description = 'Open your local AI workspace'; $link.Save()
}
& $nodePath (Join-Path $studioRoot 'scripts\launch.mjs')
