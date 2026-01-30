# CLAUDE.md - Development Guidelines for XScribe

## Project Overview

XScribe is a cross-platform desktop transcription application built with:
- **Electron** - Desktop app framework
- **Vue 3** - Frontend framework with Composition API
- **TypeScript** - Type-safe JavaScript
- **Pinia** - State management
- **sherpa-onnx** - Local speech recognition (Whisper models)
- **better-sqlite3** - Local database for transcriptions
- **ffmpeg-static** - Bundled audio conversion

## Development Commands

```bash
npm run dev          # Start development server with hot reload
npm run build        # Build for production
npm run typecheck    # Run TypeScript type checking
npm run lint         # Run ESLint
npm run format       # Format code with Prettier
```

## Git Workflow - IMPORTANT

### Make Fine-Grained Commits

After completing each logical unit of work and verifying the build succeeds:

1. **Build first**: Always run `npm run build` before committing
2. **Commit early and often**: Don't bundle unrelated changes
3. **Write descriptive messages**: Explain the "why", not just the "what"
4. **One feature per commit**: Makes reverts and cherry-picks easier

### Commit Message Format

```
<type>: <short description>

<optional longer description>

Co-Authored-By: Claude <noreply@anthropic.com>
```

Types:
- `feat`: New feature
- `fix`: Bug fix
- `refactor`: Code restructuring without behavior change
- `style`: Formatting, missing semicolons, etc.
- `docs`: Documentation only
- `chore`: Build process, dependencies, etc.
- `test`: Adding or updating tests

### Before Each Commit

```bash
npm run build           # Verify clean build
git status              # Review changes
git diff                # Review specific changes
git add <specific-files> # Stage only related changes
git commit -m "..."     # Commit with descriptive message
```

## Architecture Notes

### Process Model

- **Main Process** (`src/main/`) - Electron main process, handles IPC, database, native modules
- **Renderer Process** (`src/renderer/`) - Vue app, UI components, stores
- **Preload** (`src/preload/`) - Bridge between main and renderer, exposes safe APIs
- **Worker Process** (`transcription-worker.js`) - Spawned child process for sherpa-onnx

### Key Files

| File | Purpose |
|------|---------|
| `src/main/index.ts` | Main process entry, IPC handlers |
| `src/main/services/transcriber.ts` | Transcription service, spawns worker |
| `src/main/services/transcription-worker.js` | Child process with sherpa-onnx |
| `src/main/services/ffmpeg-installer.ts` | FFmpeg detection and installation |
| `src/main/database/` | SQLite database with better-sqlite3 |
| `src/renderer/App.vue` | Main Vue component |
| `src/renderer/stores/` | Pinia stores for state management |
| `src/preload/index.ts` | IPC API exposed to renderer |

### Native Module Handling

sherpa-onnx requires special handling:
- Uses child process (`spawn`) instead of direct import
- `DYLD_LIBRARY_PATH` must be set BEFORE process starts on macOS
- Worker runs as separate Node.js process to avoid Electron bundling issues

### FFmpeg

FFmpeg is bundled via `ffmpeg-static`:
- Binary included in app bundle via `electron-builder.yml`
- Worker checks for bundled ffmpeg first, falls back to system
- Converts non-WAV audio to 16kHz mono WAV for transcription

## Common Issues

### "Could not find sherpa-onnx-node"
- Check that `DYLD_LIBRARY_PATH` is set in transcriber.ts spawn options
- Verify sherpa-onnx native addon is in the correct location

### "Expected chunk_id RIFF"
- File is not WAV format, needs ffmpeg conversion
- Check ffmpeg-static is properly bundled

### TypeScript errors about missing types
- Run `npm run typecheck` to see full error list
- Check that preload types match IPC handlers

## Testing Transcription

1. Start dev server: `npm run dev`
2. Drop an audio file (WAV, MP3, M4A, etc.)
3. Select a model (download if needed)
4. Click "Start Transcription"
5. Check console for errors if it fails
