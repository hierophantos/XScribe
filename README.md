# XScribe

A cross-platform, local-first transcription application with speaker diarization. Think Otter.ai, but open-source and running entirely on your device.

## Features

- **Local-First**: All processing happens on your device - no data leaves your computer
- **Speaker Diarization**: Automatically identifies and labels different speakers
- **Cross-Platform**: Works on macOS, Windows, and Linux
- **Multiple Languages**: Supports 99+ languages via Whisper
- **Privacy Focused**: No accounts, no telemetry, no cloud processing

## Quick Start

### 1. Install Dependencies

```bash
npm install
```

### 2. Download Models

```bash
# Download tiny.en Whisper model + diarization models (~100MB total)
npm run download:models

# Or choose a larger model for better accuracy:
npm run download:models:base    # ~150MB - good balance
npm run download:models:small   # ~450MB - better accuracy
```

### 3. Run the App

```bash
npm run dev
```

### 4. Build for Distribution

```bash
# Build for current platform
npm run dist

# Build for specific platform
npm run dist:mac
npm run dist:win
npm run dist:linux
```

## Technology Stack

- **Framework**: Electron + Vite + Vue 3 + TypeScript
- **Speech Recognition**: [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) with Whisper models (WASM-based, cross-platform)
- **Speaker Diarization**: pyannote segmentation + wespeaker embeddings via sherpa-onnx
- **Build**: electron-builder for cross-platform distribution

## Model Information

### Whisper Models (Transcription)

All models use sherpa-onnx's ONNX-converted Whisper format:

| Model | Size | Languages | Quality |
|-------|------|-----------|---------|
| tiny.en | ~60MB | English only | Basic |
| base.en | ~120MB | English only | Good |
| small.en | ~400MB | English only | Better |

### Diarization Models (Speaker Identification)

- `sherpa-onnx-pyannote-segmentation-3-0.onnx` - Speaker segmentation
- `wespeaker_en_voxceleb_resnet34.onnx` - Speaker embeddings

Both are downloaded automatically by the `download:models` script.

## System Requirements

- **OS**: macOS 10.15+, Windows 10+, Ubuntu 20.04+
- **RAM**: 4GB minimum (8GB+ recommended)
- **Storage**: 200MB - 1GB depending on model choice

## Project Structure

```
xscribe/
├── src/
│   ├── main/           # Electron main process
│   │   ├── index.ts    # App entry point, IPC handlers
│   │   └── services/   # Transcription & diarization services
│   ├── preload/        # Secure IPC bridge
│   └── renderer/       # Vue frontend
│       ├── App.vue
│       └── components/
├── models/             # ML models (gitignored)
├── scripts/            # Helper scripts
└── build/              # Build resources
```

## Development

```bash
# Install dependencies
npm install

# Download models
npm run download:models

# Start development server with hot reload
npm run dev

# Type check
npm run typecheck

# Build production
npm run build
```

## Privacy

XScribe is designed with privacy as a core principle:

- **No cloud processing**: All transcription and speaker identification runs locally
- **No telemetry**: We don't collect any usage data
- **No accounts**: No sign-up or login required
- **Your data stays yours**: Audio files are never uploaded anywhere

## License

MIT License - See [LICENSE](LICENSE) for details.

## Acknowledgments

- [OpenAI Whisper](https://github.com/openai/whisper) - Speech recognition model
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx) - ONNX inference runtime
- [pyannote-audio](https://github.com/pyannote/pyannote-audio) - Speaker diarization models
