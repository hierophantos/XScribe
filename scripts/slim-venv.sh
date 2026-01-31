#!/bin/bash
# Slim down Python venv by removing unused files
# This can save 50-150MB by removing tests, docs, and cache files
set -e

VENV_PATH="${1:-python/venv}"

if [ ! -d "$VENV_PATH" ]; then
  echo "Error: venv not found at $VENV_PATH"
  exit 1
fi

echo "Slimming venv at: $VENV_PATH"
echo "Initial size: $(du -sh "$VENV_PATH" | cut -f1)"

# Remove test directories (can be 50-100MB)
echo "Removing test directories..."
find "$VENV_PATH" -type d -name "tests" -exec rm -rf {} + 2>/dev/null || true
find "$VENV_PATH" -type d -name "test" -exec rm -rf {} + 2>/dev/null || true

# Remove __pycache__ directories
echo "Removing __pycache__ directories..."
find "$VENV_PATH" -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true

# Remove documentation
echo "Removing documentation..."
find "$VENV_PATH" -type d -name "docs" -exec rm -rf {} + 2>/dev/null || true
find "$VENV_PATH" -type d -name "doc" -exec rm -rf {} + 2>/dev/null || true
find "$VENV_PATH" -type d -name "examples" -exec rm -rf {} + 2>/dev/null || true

# Remove .pyc files (regenerated at runtime)
echo "Removing .pyc files..."
find "$VENV_PATH" -name "*.pyc" -delete 2>/dev/null || true

# Remove type stubs (not needed at runtime)
echo "Removing type stubs..."
find "$VENV_PATH" -name "*.pyi" -delete 2>/dev/null || true

# Remove dist-info RECORD files (not needed at runtime)
echo "Removing dist-info RECORD files..."
find "$VENV_PATH" -name "RECORD" -path "*dist-info*" -delete 2>/dev/null || true

# Remove source maps if any
echo "Removing source maps..."
find "$VENV_PATH" -name "*.map" -delete 2>/dev/null || true

# Try to uninstall known unused packages (these may have been pulled in as indirect deps)
echo "Attempting to remove unused packages..."
VENV_PIP="$VENV_PATH/bin/pip"
if [ -f "$VENV_PIP" ]; then
  "$VENV_PIP" uninstall -y matplotlib fontTools sympy sqlalchemy pillow 2>/dev/null || true
fi

echo ""
echo "Final size: $(du -sh "$VENV_PATH" | cut -f1)"
echo "Done!"
