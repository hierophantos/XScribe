#!/bin/bash
# Build a portable Python venv with all XScribe dependencies
# Usage: ./scripts/build-python-venv.sh <platform>
# Platforms: darwin-arm64, darwin-x64, linux-x64

set -e

PLATFORM="${1:-}"
PYTHON_VERSION="3.11.9"
PYTHON_BUILD_DATE="20240415"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"

if [ -z "$PLATFORM" ]; then
    echo "Usage: $0 <platform>"
    echo "Platforms: darwin-arm64, darwin-x64, linux-x64"
    exit 1
fi

echo "=== Building Python venv for $PLATFORM ==="

# Platform-specific Python download URL from python-build-standalone
case "$PLATFORM" in
  darwin-arm64)
    PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-aarch64-apple-darwin-install_only.tar.gz"
    ;;
  darwin-x64)
    PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-apple-darwin-install_only.tar.gz"
    ;;
  linux-x64)
    PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-x86_64-unknown-linux-gnu-install_only.tar.gz"
    ;;
  linux-arm64)
    PYTHON_URL="https://github.com/indygreg/python-build-standalone/releases/download/${PYTHON_BUILD_DATE}/cpython-${PYTHON_VERSION}+${PYTHON_BUILD_DATE}-aarch64-unknown-linux-gnu-install_only.tar.gz"
    ;;
  *)
    echo "Error: Unknown platform: $PLATFORM"
    echo "Supported platforms: darwin-arm64, darwin-x64, linux-x64, linux-arm64"
    exit 1
    ;;
esac

# Save transcriber scripts before cleanup (since we'll delete the python/ dir)
TRANSCRIBER_SCRIPT="${PROJECT_ROOT}/python/transcriber.py"
DIARIZER_SCRIPT="${PROJECT_ROOT}/python/sherpa_diarizer.py"

if [ ! -f "$TRANSCRIBER_SCRIPT" ]; then
    echo "Error: transcriber.py not found at $TRANSCRIBER_SCRIPT"
    exit 1
fi

# Copy scripts to temp location
cp "$TRANSCRIBER_SCRIPT" /tmp/transcriber.py
cp "$DIARIZER_SCRIPT" /tmp/sherpa_diarizer.py

# Clean up any previous build
rm -rf python python.tar.gz "python-venv-${PLATFORM}.tar.gz"

# 1. Download portable Python
echo "=== Downloading Python ${PYTHON_VERSION} for ${PLATFORM} ==="
curl -L "$PYTHON_URL" -o python.tar.gz

# 2. Extract Python
echo "=== Extracting Python ==="
tar -xzf python.tar.gz
rm python.tar.gz

# Set Python binary path
PYTHON_BIN="./python/bin/python3"
PIP_BIN="./python/bin/pip3"

# Verify Python works
echo "=== Verifying Python installation ==="
$PYTHON_BIN --version

# 3. Upgrade pip
echo "=== Upgrading pip ==="
$PYTHON_BIN -m pip install --upgrade pip

# 4. Install WhisperX from GitHub (not on PyPI)
# WhisperX will install its own PyTorch requirement
echo "=== Installing WhisperX ==="
$PYTHON_BIN -m pip install --no-cache-dir \
  'git+https://github.com/m-bain/whisperX.git'

# 5. Install pyannote.audio for diarization (must be <4.0)
echo "=== Installing pyannote.audio ==="
$PYTHON_BIN -m pip install --no-cache-dir \
  'pyannote.audio>=3.1,<4.0'

# 6. Install sherpa-onnx and audio dependencies
echo "=== Installing sherpa-onnx and audio deps ==="
$PYTHON_BIN -m pip install --no-cache-dir \
  'sherpa-onnx>=1.10.0' \
  soundfile \
  av

# 7. Copy transcriber scripts into the Python directory (from temp location)
echo "=== Copying transcriber scripts ==="
cp /tmp/transcriber.py ./python/
cp /tmp/sherpa_diarizer.py ./python/

# 8. Slim the venv (remove tests, docs, caches)
echo "=== Slimming venv ==="
"${SCRIPT_DIR}/slim-venv.sh" ./python

# 9. Verify key imports work
echo "=== Verifying installation ==="
$PYTHON_BIN -c "
import torch
print(f'PyTorch version: {torch.__version__}')
import whisperx
print('WhisperX imported successfully')
import sherpa_onnx
print('sherpa-onnx imported successfully')
print('All imports OK!')
"

# 10. Show final size
echo "=== Venv size before compression ==="
du -sh ./python

# 11. Package for upload
echo "=== Creating archive ==="
tar -czf "python-venv-${PLATFORM}.tar.gz" python

echo "=== Final archive size ==="
ls -lh "python-venv-${PLATFORM}.tar.gz"

echo "=== Build complete: python-venv-${PLATFORM}.tar.gz ==="
