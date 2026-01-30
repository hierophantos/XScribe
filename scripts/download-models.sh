#!/bin/bash
# XScribe Model Download Script
# Downloads required models for transcription and speaker diarization
# Uses sherpa-onnx compatible ONNX models

set -e

MODELS_DIR="${1:-./models}"
mkdir -p "$MODELS_DIR"

echo "=== XScribe Model Downloader ==="
echo "Download directory: $MODELS_DIR"
echo ""

# Whisper model options (sherpa-onnx ONNX format)
echo "Available Whisper models:"
echo "  tiny.en  - ~60MB  (fastest, English only)"
echo "  base.en  - ~120MB (good balance, English only)"
echo "  small.en - ~400MB (better accuracy, English only)"
echo ""

# Default to tiny.en model for quick testing
WHISPER_MODEL="${WHISPER_MODEL:-tiny.en}"
echo "Downloading Whisper model: $WHISPER_MODEL"

# Base URL for sherpa-onnx whisper models
WHISPER_BASE_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models"

# Download whisper model archive
WHISPER_ARCHIVE="sherpa-onnx-whisper-${WHISPER_MODEL}.tar.bz2"
WHISPER_URL="${WHISPER_BASE_URL}/${WHISPER_ARCHIVE}"

if [ -f "$MODELS_DIR/whisper-${WHISPER_MODEL}-encoder.onnx" ]; then
    echo "  Whisper model already exists, skipping..."
else
    echo "  Downloading from: $WHISPER_URL"
    TEMP_FILE="$MODELS_DIR/whisper-temp.tar.bz2"

    if curl -L -o "$TEMP_FILE" "$WHISPER_URL" 2>/dev/null; then
        echo "  Extracting..."
        tar -xjf "$TEMP_FILE" -C "$MODELS_DIR"

        # Move files from extracted directory to models root
        EXTRACTED_DIR="$MODELS_DIR/sherpa-onnx-whisper-${WHISPER_MODEL}"
        if [ -d "$EXTRACTED_DIR" ]; then
            mv "$EXTRACTED_DIR"/*.onnx "$MODELS_DIR/" 2>/dev/null || true
            mv "$EXTRACTED_DIR"/*.txt "$MODELS_DIR/" 2>/dev/null || true
            mv "$EXTRACTED_DIR"/*.bin "$MODELS_DIR/" 2>/dev/null || true
            rm -rf "$EXTRACTED_DIR"
        fi
        rm -f "$TEMP_FILE"
        echo "  Downloaded Whisper model: $WHISPER_MODEL"
    else
        echo "  Warning: Could not download Whisper model"
        echo "  You can manually download from: $WHISPER_URL"
    fi
fi

echo ""

# Speaker diarization models
echo "Downloading speaker diarization models..."

# Segmentation model (pyannote)
SEGMENTATION_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2"
SEGMENTATION_FILE="$MODELS_DIR/sherpa-onnx-pyannote-segmentation-3-0.onnx"

if [ -f "$SEGMENTATION_FILE" ]; then
    echo "  Segmentation model already exists, skipping..."
else
    echo "  Downloading segmentation model..."
    TEMP_TAR="$MODELS_DIR/segmentation.tar.bz2"

    if curl -L -o "$TEMP_TAR" "$SEGMENTATION_URL" 2>/dev/null; then
        tar -xjf "$TEMP_TAR" -C "$MODELS_DIR"
        # Move the onnx file to the models directory
        EXTRACTED_DIR="$MODELS_DIR/sherpa-onnx-pyannote-segmentation-3-0"
        if [ -d "$EXTRACTED_DIR" ]; then
            mv "$EXTRACTED_DIR/model.onnx" "$SEGMENTATION_FILE" 2>/dev/null || true
            rm -rf "$EXTRACTED_DIR"
        fi
        rm -f "$TEMP_TAR"
        echo "  Downloaded segmentation model"
    else
        echo "  Warning: Could not download segmentation model"
    fi
fi

# Speaker embedding model (wespeaker)
EMBEDDING_URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx"
EMBEDDING_FILE="$MODELS_DIR/wespeaker_en_voxceleb_resnet34.onnx"

if [ -f "$EMBEDDING_FILE" ]; then
    echo "  Embedding model already exists, skipping..."
else
    echo "  Downloading embedding model..."
    if curl -L -o "$EMBEDDING_FILE" "$EMBEDDING_URL" 2>/dev/null; then
        echo "  Downloaded embedding model"
    else
        echo "  Warning: Could not download embedding model"
    fi
fi

echo ""
echo "=== Download Complete ==="
echo ""
echo "Models downloaded to: $MODELS_DIR"
ls -lh "$MODELS_DIR" 2>/dev/null || echo "(directory listing failed)"
echo ""
echo "You can now run XScribe with: npm run dev"
