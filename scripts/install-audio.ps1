[CmdletBinding()]
param([string]$AudioRoot = (Join-Path $env:LOCALAPPDATA 'LocalAIStudioAudio'))
$ErrorActionPreference = 'Stop'
$AudioRoot = [IO.Path]::GetFullPath($AudioRoot)

function Require-Tool([string]$name) {
  $tool = Get-Command $name -ErrorAction SilentlyContinue
  if (!$tool) { throw "$name is required. Install it, open a new PowerShell window, and run this script again." }
  return $tool.Source
}

$null = Require-Tool 'uv'
$null = Require-Tool 'git'
$null = Require-Tool 'py'
$python = (& py -3.12 -c 'import sys; print(sys.executable)' 2>$null | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or !$python) { throw 'Official Python 3.12 is required. Install Python.Python.3.12 with winget, then reopen PowerShell.' }
& $python -c 'import ssl; print(ssl.OPENSSL_VERSION)'
if ($LASTEXITCODE -ne 0) { throw 'Python 3.12 cannot load SSL. Use the signed python.org installer before downloading models.' }

New-Item -ItemType Directory -Force -Path $AudioRoot | Out-Null
$musicRepo = Join-Path $AudioRoot 'ace-step'
$mossRepo = Join-Path $AudioRoot 'moss-tts'
if (!(Test-Path -LiteralPath $musicRepo)) { & git clone --depth 1 https://github.com/ace-step/ACE-Step-1.5.git $musicRepo; if ($LASTEXITCODE -ne 0) { throw 'Could not clone ACE-Step.' } }
if (!(Test-Path -LiteralPath $mossRepo)) { & git clone --depth 1 https://github.com/OpenMOSS/MOSS-TTS.git $mossRepo; if ($LASTEXITCODE -ne 0) { throw 'Could not clone MOSS-TTS.' } }

Push-Location $musicRepo
try { & uv sync --python $python; if ($LASTEXITCODE -ne 0) { throw 'Could not install ACE-Step.' } }
finally { Pop-Location }
$mossPython = Join-Path $AudioRoot 'moss-venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $mossPython)) { & uv venv (Join-Path $AudioRoot 'moss-venv') --python $python; if ($LASTEXITCODE -ne 0) { throw 'Could not create MOSS environment.' } }
Push-Location (Join-Path $mossRepo 'moss_soundeffect_v2')
try { & uv pip install --index-strategy unsafe-best-match --python $mossPython --extra-index-url https://download.pytorch.org/whl/cu128 -e '.[torch-cu128]'; if ($LASTEXITCODE -ne 0) { throw 'Could not install MOSS SoundEffect.' } }
finally { Pop-Location }

$voicePython = Join-Path $AudioRoot 'voice-venv\Scripts\python.exe'
if (!(Test-Path -LiteralPath $voicePython)) { & uv venv (Join-Path $AudioRoot 'voice-venv') --python $python; if ($LASTEXITCODE -ne 0) { throw 'Could not create voice environment.' } }
& uv pip install --python $voicePython --index https://download.pytorch.org/whl/cu128 torch==2.9.0+cu128 torchaudio==2.9.0+cu128 torchvision==0.24.0+cu128
if ($LASTEXITCODE -ne 0) { throw 'Could not install CUDA PyTorch for voice.' }
& uv pip install --python $voicePython qwen-tts soundfile
if ($LASTEXITCODE -ne 0) { throw 'Could not install Qwen3-TTS.' }

$models = Join-Path $AudioRoot 'models'
New-Item -ItemType Directory -Force -Path $models | Out-Null
$musicPython = Join-Path $musicRepo '.venv\Scripts\python.exe'
& $musicPython -m acestep.model_downloader --dir (Join-Path $models 'music')
if ($LASTEXITCODE -ne 0) { throw 'Could not download ACE-Step music models.' }
$download = 'from huggingface_hub import snapshot_download; import sys; print(snapshot_download(sys.argv[1], local_dir=sys.argv[2]))'
& $mossPython -c $download 'OpenMOSS-Team/MOSS-SoundEffect-v2.0' (Join-Path $models 'sfx')
if ($LASTEXITCODE -ne 0) { throw 'Could not download MOSS SoundEffect.' }
& $voicePython -c $download 'Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign' (Join-Path $models 'voice')
if ($LASTEXITCODE -ne 0) { throw 'Could not download Qwen3-TTS.' }

Write-Output "Audio models are ready in $AudioRoot. Restart Local AI Studio and open Sound."
