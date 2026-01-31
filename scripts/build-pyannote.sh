#!/bin/bash
#
# Build Pyannote Diarizer as standalone executable
#
# This script:
# 1. Creates a Python virtual environment
# 2. Installs dependencies
# 3. Builds standalone executable with PyInstaller
# 4. Copies executable to resources folder for Electron bundling
#
# Prerequisites:
# - Python 3.9+ installed
# - pip available
#
# Usage:
#   ./scripts/build-pyannote.sh
#

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PYTHON_DIR="$PROJECT_DIR/python"
RESOURCES_DIR="$PROJECT_DIR/resources/pyannote"

echo "=== Building Pyannote Diarizer ==="
echo "Project: $PROJECT_DIR"
echo "Python:  $PYTHON_DIR"
echo ""

# Check Python version
PYTHON_CMD=""
if command -v python3 &> /dev/null; then
    PYTHON_CMD="python3"
elif command -v python &> /dev/null; then
    PYTHON_CMD="python"
else
    echo "Error: Python not found. Please install Python 3.9+"
    exit 1
fi

PYTHON_VERSION=$($PYTHON_CMD --version 2>&1 | awk '{print $2}')
echo "Using Python: $PYTHON_VERSION"

# Navigate to python directory
cd "$PYTHON_DIR"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo ""
    echo "=== Creating virtual environment ==="
    $PYTHON_CMD -m venv venv
fi

# Activate virtual environment
echo ""
echo "=== Activating virtual environment ==="
source venv/bin/activate

# Upgrade pip
echo ""
echo "=== Upgrading pip ==="
pip install --upgrade pip

# Install dependencies
echo ""
echo "=== Installing dependencies ==="
pip install -r requirements.txt

# Detect platform for PyInstaller options
PLATFORM=$(uname -s)
PYINSTALLER_OPTS="--onefile --name pyannote-diarizer"

# Add hidden imports that PyInstaller might miss
PYINSTALLER_OPTS="$PYINSTALLER_OPTS --hidden-import=pyannote.audio"
PYINSTALLER_OPTS="$PYINSTALLER_OPTS --hidden-import=pyannote.audio.pipelines"
PYINSTALLER_OPTS="$PYINSTALLER_OPTS --hidden-import=pyannote.audio.core"
PYINSTALLER_OPTS="$PYINSTALLER_OPTS --hidden-import=torch"
PYINSTALLER_OPTS="$PYINSTALLER_OPTS --hidden-import=torchaudio"
PYINSTALLER_OPTS="$PYINSTALLER_OPTS --hidden-import=pytorch_lightning"
PYINSTALLER_OPTS="$PYINSTALLER_OPTS --hidden-import=huggingface_hub"

# Platform-specific options
if [ "$PLATFORM" = "Darwin" ]; then
    echo "Platform: macOS"
    # macOS specific options
    PYINSTALLER_OPTS="$PYINSTALLER_OPTS --target-arch universal2"
elif [ "$PLATFORM" = "Linux" ]; then
    echo "Platform: Linux"
elif [ "$PLATFORM" = "MINGW64_NT"* ] || [ "$PLATFORM" = "MSYS_NT"* ]; then
    echo "Platform: Windows"
fi

# Clean previous build
echo ""
echo "=== Cleaning previous build ==="
rm -rf build dist *.spec

# Build with PyInstaller
echo ""
echo "=== Building with PyInstaller ==="
echo "Options: $PYINSTALLER_OPTS"
pyinstaller $PYINSTALLER_OPTS diarizer.py

# Create resources directory
echo ""
echo "=== Copying to resources ==="
mkdir -p "$RESOURCES_DIR"

# Copy executable
if [ "$PLATFORM" = "Darwin" ] || [ "$PLATFORM" = "Linux" ]; then
    cp dist/pyannote-diarizer "$RESOURCES_DIR/"
    chmod +x "$RESOURCES_DIR/pyannote-diarizer"
else
    cp dist/pyannote-diarizer.exe "$RESOURCES_DIR/"
fi

# Deactivate virtual environment
deactivate

echo ""
echo "=== Build complete ==="
echo "Executable: $RESOURCES_DIR/pyannote-diarizer"
echo ""
echo "Next steps:"
echo "1. Run 'npm run build' to bundle with Electron"
echo "2. The executable will be included in the app bundle"
