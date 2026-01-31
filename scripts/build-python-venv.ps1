# Build a portable Python venv with all XScribe dependencies (Windows)
# Usage: .\scripts\build-python-venv.ps1 -Platform win-x64

param(
    [Parameter(Mandatory=$true)]
    [ValidateSet("win-x64")]
    [string]$Platform
)

$ErrorActionPreference = "Stop"

$PYTHON_VERSION = "3.11.9"
$PYTHON_BUILD_DATE = "20240415"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = Split-Path -Parent $ScriptDir

Write-Host "=== Building Python venv for $Platform ===" -ForegroundColor Cyan

# Windows Python download URL
$PYTHON_URL = "https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-pc-windows-msvc-install_only.tar.gz"

# Clean up any previous build
if (Test-Path "python") { Remove-Item -Recurse -Force "python" }
if (Test-Path "python.tar.gz") { Remove-Item -Force "python.tar.gz" }
if (Test-Path "python-venv-${Platform}.tar.gz") { Remove-Item -Force "python-venv-${Platform}.tar.gz" }

# 1. Download portable Python
Write-Host "=== Downloading Python ${PYTHON_VERSION} for ${Platform} ===" -ForegroundColor Green
Invoke-WebRequest -Uri $PYTHON_URL -OutFile "python.tar.gz"

# 2. Extract Python
Write-Host "=== Extracting Python ===" -ForegroundColor Green
tar -xzf python.tar.gz
Remove-Item "python.tar.gz"

# Set Python binary paths
$PYTHON_BIN = ".\python\python.exe"
$PIP_BIN = ".\python\Scripts\pip.exe"

# Verify Python works
Write-Host "=== Verifying Python installation ===" -ForegroundColor Green
& $PYTHON_BIN --version

# 3. Upgrade pip
Write-Host "=== Upgrading pip ===" -ForegroundColor Green
& $PYTHON_BIN -m pip install --upgrade pip

# 4. Install CPU-only PyTorch
Write-Host "=== Installing PyTorch (CPU-only) ===" -ForegroundColor Green
& $PYTHON_BIN -m pip install --no-cache-dir `
  --extra-index-url https://download.pytorch.org/whl/cpu `
  'torch>=2.0.0,<2.6.0' `
  'torchaudio>=2.0.0,<2.6.0'

# 5. Install WhisperX from GitHub
Write-Host "=== Installing WhisperX ===" -ForegroundColor Green
& $PYTHON_BIN -m pip install --no-cache-dir `
  'git+https://github.com/m-bain/whisperX.git'

# 6. Install pyannote.audio
Write-Host "=== Installing pyannote.audio ===" -ForegroundColor Green
& $PYTHON_BIN -m pip install --no-cache-dir `
  'pyannote.audio>=3.1,<4.0'

# 7. Install sherpa-onnx and audio deps
Write-Host "=== Installing sherpa-onnx and audio deps ===" -ForegroundColor Green
& $PYTHON_BIN -m pip install --no-cache-dir `
  'sherpa-onnx>=1.10.0' `
  soundfile `
  av

# 8. Copy transcriber scripts
Write-Host "=== Copying transcriber scripts ===" -ForegroundColor Green
Copy-Item "$ProjectRoot\python\transcriber.py" -Destination ".\python\"
Copy-Item "$ProjectRoot\python\sherpa_diarizer.py" -Destination ".\python\"

# 9. Slim the venv (Windows version)
Write-Host "=== Slimming venv ===" -ForegroundColor Green

# Remove test directories
Get-ChildItem -Path ".\python" -Directory -Recurse -Filter "tests" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path ".\python" -Directory -Recurse -Filter "test" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path ".\python" -Directory -Recurse -Filter "__pycache__" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Remove documentation
Get-ChildItem -Path ".\python" -Directory -Recurse -Filter "docs" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path ".\python" -Directory -Recurse -Filter "doc" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path ".\python" -Directory -Recurse -Filter "examples" | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# Remove .pyc and .pyi files
Get-ChildItem -Path ".\python" -File -Recurse -Filter "*.pyc" | Remove-Item -Force -ErrorAction SilentlyContinue
Get-ChildItem -Path ".\python" -File -Recurse -Filter "*.pyi" | Remove-Item -Force -ErrorAction SilentlyContinue

# Remove CUDA-related files (we're CPU-only)
Get-ChildItem -Path ".\python" -File -Recurse | Where-Object { $_.Name -match "cuda" } | Remove-Item -Force -ErrorAction SilentlyContinue

# 10. Verify key imports work
Write-Host "=== Verifying installation ===" -ForegroundColor Green
& $PYTHON_BIN -c @"
import torch
print(f'PyTorch version: {torch.__version__}')
import whisperx
print('WhisperX imported successfully')
import sherpa_onnx
print('sherpa-onnx imported successfully')
print('All imports OK!')
"@

# 11. Show final size
Write-Host "=== Venv size before compression ===" -ForegroundColor Green
$size = (Get-ChildItem -Path ".\python" -Recurse | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "Size: $([math]::Round($size, 2)) MB"

# 12. Package for upload
Write-Host "=== Creating archive ===" -ForegroundColor Green
tar -czf "python-venv-${Platform}.tar.gz" python

Write-Host "=== Final archive size ===" -ForegroundColor Green
Get-Item "python-venv-${Platform}.tar.gz" | Select-Object Name, @{Name="Size(MB)";Expression={[math]::Round($_.Length/1MB,2)}}

Write-Host "=== Build complete: python-venv-${Platform}.tar.gz ===" -ForegroundColor Cyan
