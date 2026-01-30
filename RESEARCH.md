# XScribe: Cross-Platform Local Transcription App - Research Document

## Project Vision

Build an open-source, local-first transcription application similar to Otter.ai, with:
- Cross-platform support (macOS, Windows, Linux) via Electron + Vite
- Speaker diarization (who said what)
- Bundled dependencies for frictionless end-user experience
- Privacy-first: all processing happens locally

---

## Architecture Recommendation

### Recommended Stack

```
┌─────────────────────────────────────────────────────────────┐
│                    Electron + Vite Frontend                  │
│                     (React/Vue/Svelte)                       │
├─────────────────────────────────────────────────────────────┤
│                      Node.js Backend                         │
├──────────────────────┬──────────────────────────────────────┤
│   whisper.cpp        │        sherpa-onnx                   │
│   (Transcription)    │    (Speaker Diarization)             │
│                      │                                       │
│  @kutalia/whisper-   │     sherpa-onnx npm                  │
│   node-addon         │     (Node.js addon)                  │
└──────────────────────┴──────────────────────────────────────┘
```

---

## Model Options Comparison

### 1. Transcription (Speech-to-Text)

#### Option A: whisper.cpp via Node.js addon (RECOMMENDED)

**Package**: [`@kutalia/whisper-node-addon`](https://github.com/Kutalia/whisper-node-addon)

| Aspect | Details |
|--------|---------|
| **Platforms** | Windows x64, Linux x64/arm64, macOS x64/arm64 |
| **GPU Support** | Vulkan (Win/Linux), Metal (macOS), OpenBLAS |
| **Model Sizes** | tiny (75MB) → large (2.9GB) |
| **Memory** | 273MB (tiny) → 3.9GB (large) |
| **Speed** | 70x realtime with large-v2 |
| **License** | MIT |
| **Electron** | Zero-config, prebuilt binaries |
| **Bundling** | Pre-built .node binaries included |

**Why**: Pre-built binaries eliminate compilation headaches. Supports real-time PCM streaming, VAD, and GPU acceleration. MIT license is maximally permissive.

#### Option B: WhisperX (Python-based)

- Requires bundling Python runtime (~100MB+)
- More complex deployment
- Uses faster-whisper backend
- Better word-level alignment
- **Not recommended** for Electron bundling due to Python dependency complexity

### 2. Speaker Diarization (Who is Speaking)

#### Option A: sherpa-onnx (RECOMMENDED)

**Package**: [`sherpa-onnx`](https://github.com/k2-fsa/sherpa-onnx) (npm)

| Aspect | Details |
|--------|---------|
| **Platforms** | Windows, macOS, Linux, Android, iOS, WASM |
| **Models** | pyannote segmentation-3.0, wespeaker embeddings |
| **GPU** | CUDA, DirectML, CoreML |
| **License** | Apache-2.0 |
| **Node.js** | Native addon + WASM options |
| **Offline** | Yes, fully offline capable |

**Why**: Comprehensive platform support, native Node.js bindings, uses proven pyannote models, Apache-2.0 license, actively maintained with excellent documentation.

#### Option B: pyannote-onnx-extended (Python/ONNX)

- Pure ONNX Runtime implementation
- Removes PyTorch dependency
- Still requires Python or custom integration
- **Consider** for future if sherpa-onnx proves insufficient

#### Option C: pyannote-rs (Rust)

- Fast Rust implementation with ONNX
- No Node.js bindings currently
- **Consider** for native module if performance is critical

### 3. Combined Pipeline Options

#### Option A: sherpa-onnx (All-in-One) - RECOMMENDED

sherpa-onnx provides BOTH transcription AND diarization:
- Speech recognition (Whisper, Zipformer, Paraformer models)
- Speaker diarization (pyannote segmentation + wespeaker)
- VAD (Voice Activity Detection)
- Single dependency, consistent API

#### Option B: whisper-node-addon + sherpa-onnx (diarization only)

Use whisper.cpp for transcription + sherpa-onnx for speaker identification.
- More flexibility in model choices
- Two dependencies to manage
- May require custom alignment between transcripts and speaker segments

---

## Bundling Strategy

### Pre-built Native Addons

Both recommended packages provide pre-built binaries:

```
node_modules/
├── @kutalia/whisper-node-addon/
│   └── prebuilds/
│       ├── win32-x64/
│       ├── linux-x64/
│       ├── linux-arm64/
│       ├── darwin-x64/
│       └── darwin-arm64/
└── sherpa-onnx/
    └── (similar structure)
```

### Model Bundling Options

1. **Bundle with app** (larger download, instant use)
   - Include tiny/base model (~75-142MB)
   - User downloads larger models optionally

2. **Download on first run** (smaller initial download)
   - App downloads models on first launch
   - Show progress indicator
   - Cache in app data directory

3. **Hybrid** (RECOMMENDED)
   - Bundle tiny model for instant demo
   - Prompt to download better models

### Electron Builder Configuration

```javascript
// electron-builder.config.js
{
  "files": [
    "dist/**/*",
    "node_modules/**/*",
    "!node_modules/**/prebuilds/!(${platform}-${arch})"
  ],
  "asarUnpack": [
    "node_modules/@kutalia/whisper-node-addon/**",
    "node_modules/sherpa-onnx/**"
  ]
}
```

---

## Model Licensing Summary

| Model/Package | License | Commercial Use |
|--------------|---------|----------------|
| whisper.cpp | MIT | Yes |
| @kutalia/whisper-node-addon | MIT | Yes |
| sherpa-onnx | Apache-2.0 | Yes |
| pyannote segmentation-3.0 | MIT | Yes |
| pyannote speaker-diarization-3.1 | MIT | Yes |
| pyannote community-1 | CC-BY-4.0 | Yes (with attribution) |
| wespeaker embeddings | Apache-2.0 | Yes |
| Whisper models (OpenAI) | MIT | Yes |

All recommended components are fully open-source with permissive licenses suitable for commercial use.

---

## Technical Considerations

### GPU Acceleration

| Platform | whisper.cpp | sherpa-onnx |
|----------|-------------|-------------|
| macOS | Metal (Apple Silicon) | CoreML |
| Windows | Vulkan, CUDA | DirectML, CUDA |
| Linux | Vulkan, CUDA | CUDA |

### Memory Requirements

| Model | Transcription | Diarization | Total |
|-------|--------------|-------------|-------|
| Tiny | ~273MB | ~200MB | ~500MB |
| Base | ~388MB | ~200MB | ~600MB |
| Small | ~852MB | ~200MB | ~1GB |
| Medium | ~2.1GB | ~200MB | ~2.3GB |
| Large | ~3.9GB | ~200MB | ~4.1GB |

### Recommended Minimum Specs

- **RAM**: 4GB (tiny), 8GB (base/small), 16GB (medium/large)
- **Storage**: 500MB (tiny) to 5GB (large + app)
- **CPU**: Any modern x64/ARM64
- **GPU**: Optional but recommended for real-time

---

## Alternative Approaches Considered

### 1. Python Bundling (NOT RECOMMENDED)

Using PyInstaller or python-build-standalone to bundle WhisperX:
- Adds 100MB+ to app size
- Complex dependency management
- Platform-specific issues
- Slow startup times

### 2. WASM-only (PARTIAL)

Using whisper.cpp WASM build:
- No native dependency issues
- Limited performance (no GPU)
- Good fallback option
- sherpa-onnx has WASM support too

### 3. Subprocess/Sidecar (CONSIDERED)

Bundling whisper.cpp binary as sidecar:
- Simpler than Python bundling
- IPC overhead
- Multiple binaries to manage

---

## Recommended Implementation Path

### Phase 1: Core Transcription
1. Set up Electron + Vite project
2. Integrate `@kutalia/whisper-node-addon`
3. Implement basic audio recording and transcription
4. Bundle tiny Whisper model

### Phase 2: Speaker Diarization
1. Integrate `sherpa-onnx` for diarization
2. Align speaker segments with transcription
3. UI for speaker labels

### Phase 3: Polish
1. Model download manager
2. GPU acceleration toggle
3. Export formats (SRT, VTT, TXT, JSON)
4. Settings/preferences

### Phase 4: Advanced Features
1. Real-time transcription
2. Speaker identification (name known speakers)
3. Vocabulary/terminology customization
4. Multi-language support

---

## Resources

### Documentation
- [whisper.cpp](https://github.com/ggml-org/whisper.cpp)
- [@kutalia/whisper-node-addon](https://github.com/Kutalia/whisper-node-addon)
- [sherpa-onnx](https://github.com/k2-fsa/sherpa-onnx)
- [sherpa-onnx Node.js examples](https://github.com/k2-fsa/sherpa-onnx/tree/master/nodejs-addon-examples)
- [pyannote speaker-diarization-3.1](https://huggingface.co/pyannote/speaker-diarization-3.1)

### Similar Projects for Reference
- [WhisperScript](https://github.com/openai/whisper/discussions/1028) - Electron desktop app with diarization
- [Scribe](https://drew.tech/posts/whisper-on-device) - Electron + Nextron + whisper.cpp

### Model Downloads
- [Whisper ggml models](https://huggingface.co/ggerganov/whisper.cpp)
- [sherpa-onnx models](https://github.com/k2-fsa/sherpa-onnx/releases)

---

## Next Steps

1. Initialize Electron + Vite project structure
2. Install and test `@kutalia/whisper-node-addon`
3. Install and test `sherpa-onnx`
4. Create proof-of-concept transcription flow
5. Implement diarization pipeline
6. Design UI/UX for transcript display
