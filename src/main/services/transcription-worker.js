/**
 * Transcription Worker - Runs in a separate Node.js process
 *
 * This script is spawned as a child process to avoid Electron bundling issues
 * with the sherpa-onnx-node native addon.
 *
 * Communication is via JSON messages on stdin/stdout.
 *
 * NOTE: The parent process sets DYLD_LIBRARY_PATH/LD_LIBRARY_PATH before spawning.
 */

const path = require('path');
const fs = require('fs');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

// Load sherpa-onnx-node - environment is set by parent process
let sherpa;
try {
  sherpa = require('sherpa-onnx-node');
} catch (err) {
  console.error(JSON.stringify({ type: 'error', error: `Failed to load sherpa-onnx-node: ${err.message}` }));
  process.exit(1);
}

// Try to load bundled ffmpeg-static, fall back to system ffmpeg
let ffmpegPath = 'ffmpeg'; // Default to system ffmpeg
try {
  ffmpegPath = require('ffmpeg-static');
  // ffmpeg-static returns the path to the bundled binary
} catch {
  // ffmpeg-static not available, will use system ffmpeg
}

// Audio file extensions that need conversion to WAV
const NEEDS_CONVERSION = ['.mp3', '.m4a', '.flac', '.ogg', '.webm', '.mp4', '.mkv', '.avi', '.mov'];

/**
 * Check if ffmpeg is available (bundled or system)
 */
function getFFmpegPath() {
  // First try bundled ffmpeg-static
  if (ffmpegPath && ffmpegPath !== 'ffmpeg') {
    if (fs.existsSync(ffmpegPath)) {
      return ffmpegPath;
    }
  }

  // Fall back to system ffmpeg
  try {
    const checkCmd = process.platform === 'win32' ? 'where ffmpeg' : 'which ffmpeg';
    const result = execSync(checkCmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] });
    const systemPath = result.trim().split('\n')[0];
    if (systemPath && fs.existsSync(systemPath)) {
      return systemPath;
    }
  } catch {
    // System ffmpeg not found
  }

  return null;
}

/**
 * Convert audio/video file to WAV format using ffmpeg
 * Returns the path to the converted WAV file (in temp directory)
 */
function convertToWav(inputPath) {
  const ext = path.extname(inputPath).toLowerCase();

  // If already a WAV file, return as-is
  if (ext === '.wav') {
    return { wavPath: inputPath, needsCleanup: false };
  }

  // Get ffmpeg path (bundled or system)
  const ffmpeg = getFFmpegPath();
  if (!ffmpeg) {
    throw new Error('FFmpeg is required to process this file type but was not found. Please reinstall XScribe or install FFmpeg manually.');
  }

  // Create temp file for converted audio
  const tempDir = os.tmpdir();
  const baseName = path.basename(inputPath, ext);
  const tempWav = path.join(tempDir, `xscribe-${baseName}-${Date.now()}.wav`);

  // Convert to 16kHz mono WAV (optimal for speech recognition)
  try {
    const result = spawnSync(ffmpeg, [
      '-i', inputPath,
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      tempWav,
      '-y'
    ], { stdio: 'pipe' });

    if (result.status !== 0) {
      const stderr = result.stderr ? result.stderr.toString() : 'Unknown error';
      throw new Error(`FFmpeg exited with code ${result.status}: ${stderr}`);
    }
  } catch (err) {
    throw new Error(`Failed to convert audio file: ${err.message}`);
  }

  return { wavPath: tempWav, needsCleanup: true };
}

let recognizer = null;
let currentModel = null;

// Send a message to the parent process
function send(msg) {
  console.log(JSON.stringify(msg));
}

// Handle incoming messages
function handleMessage(msg) {
  switch (msg.type) {
    case 'loadModel':
      loadModel(msg);
      break;
    case 'transcribe':
      transcribe(msg);
      break;
    case 'getAvailableModels':
      getAvailableModels(msg);
      break;
    case 'ping':
      send({ type: 'pong', id: msg.id });
      break;
    default:
      send({ type: 'error', error: `Unknown message type: ${msg.type}`, id: msg.id });
  }
}

function loadModel(msg) {
  const { modelPath, modelName, config, id } = msg;

  try {
    const encoderPath = path.join(modelPath, config.encoder);
    const decoderPath = path.join(modelPath, config.decoder);
    const tokensPath = path.join(modelPath, config.tokens);

    // Check files exist
    if (!fs.existsSync(encoderPath)) {
      throw new Error(`Encoder not found: ${encoderPath}`);
    }
    if (!fs.existsSync(decoderPath)) {
      throw new Error(`Decoder not found: ${decoderPath}`);
    }
    if (!fs.existsSync(tokensPath)) {
      throw new Error(`Tokens not found: ${tokensPath}`);
    }

    send({ type: 'progress', stage: 'loading', message: 'Loading model...', id });

    recognizer = new sherpa.OfflineRecognizer({
      modelConfig: {
        whisper: {
          encoder: encoderPath,
          decoder: decoderPath,
          language: '',
          task: 'transcribe',
          tailPaddings: -1
        },
        tokens: tokensPath,
        numThreads: 2,
        provider: 'cpu',
        debug: 0
      }
    });

    currentModel = modelName;
    send({ type: 'modelLoaded', modelName, id });
  } catch (err) {
    send({ type: 'error', error: err.message, id });
  }
}

// Whisper models in sherpa-onnx only support 30 seconds at a time
const MAX_CHUNK_SECONDS = 30;
const OVERLAP_SECONDS = 1; // Slight overlap to avoid cutting words

/**
 * Transcribe audio in chunks to handle files longer than 30 seconds
 */
function transcribe(msg) {
  const { filePath, id } = msg;
  let wavInfo = null;

  try {
    if (!recognizer) {
      throw new Error('Model not loaded');
    }

    send({ type: 'progress', percent: 5, stage: 'preparing', id });

    // Convert to WAV if needed
    const ext = path.extname(filePath).toLowerCase();
    if (NEEDS_CONVERSION.includes(ext)) {
      send({ type: 'progress', percent: 10, stage: 'converting', id });
      wavInfo = convertToWav(filePath);
    } else {
      wavInfo = { wavPath: filePath, needsCleanup: false };
    }

    send({ type: 'progress', percent: 15, stage: 'reading', id });

    // Read the audio file
    const waveData = sherpa.readWave(wavInfo.wavPath);
    const sampleRate = waveData.sampleRate;
    const samples = waveData.samples;
    const totalSamples = samples.length;
    const totalDuration = totalSamples / sampleRate;

    send({ type: 'progress', percent: 20, stage: 'processing', id });

    // Calculate chunking
    const chunkSamples = MAX_CHUNK_SECONDS * sampleRate;
    const overlapSamples = OVERLAP_SECONDS * sampleRate;
    const stepSamples = chunkSamples - overlapSamples;

    // For short audio (< 30s), process directly
    if (totalDuration <= MAX_CHUNK_SECONDS) {
      const stream = recognizer.createStream();
      stream.acceptWaveform({ sampleRate, samples });

      send({ type: 'progress', percent: 50, stage: 'decoding', id });
      recognizer.decode(stream);

      send({ type: 'progress', percent: 90, stage: 'finalizing', id });
      const result = recognizer.getResult(stream);

      // Cleanup temp file if we created one
      if (wavInfo.needsCleanup && fs.existsSync(wavInfo.wavPath)) {
        try { fs.unlinkSync(wavInfo.wavPath); } catch { }
      }

      // Create a single segment for the entire transcription
      const segments = result.text.trim() ? [{
        start: 0,
        end: totalDuration,
        text: result.text.trim()
      }] : [];

      send({
        type: 'result',
        text: result.text,
        segments,
        duration: totalDuration,
        timestamps: result.timestamps || [],
        id
      });
      return;
    }

    // Process in chunks for longer audio
    const segments = [];
    let fullText = '';
    let chunkStart = 0;
    let chunkIndex = 0;
    const totalChunks = Math.ceil((totalSamples - overlapSamples) / stepSamples);

    while (chunkStart < totalSamples) {
      const chunkEnd = Math.min(chunkStart + chunkSamples, totalSamples);
      const chunkSamplesSlice = samples.slice(chunkStart, chunkEnd);

      // Calculate progress (20-90% for processing)
      const progressPercent = 20 + Math.floor((chunkIndex / totalChunks) * 70);
      send({
        type: 'progress',
        percent: progressPercent,
        stage: 'decoding',
        message: `Processing chunk ${chunkIndex + 1} of ${totalChunks}`,
        id
      });

      // Create stream and process chunk
      const stream = recognizer.createStream();
      stream.acceptWaveform({
        sampleRate,
        samples: chunkSamplesSlice
      });

      recognizer.decode(stream);
      const result = recognizer.getResult(stream);

      if (result.text && result.text.trim()) {
        const chunkStartTime = chunkStart / sampleRate;
        const chunkEndTime = chunkEnd / sampleRate;

        segments.push({
          start: chunkStartTime,
          end: chunkEndTime,
          text: result.text.trim()
        });

        fullText += (fullText ? ' ' : '') + result.text.trim();
      }

      // Move to next chunk
      chunkStart += stepSamples;
      chunkIndex++;
    }

    send({ type: 'progress', percent: 95, stage: 'finalizing', id });

    // Cleanup temp file if we created one
    if (wavInfo.needsCleanup && fs.existsSync(wavInfo.wavPath)) {
      try { fs.unlinkSync(wavInfo.wavPath); } catch { }
    }

    send({
      type: 'result',
      text: fullText,
      segments,
      duration: totalDuration,
      timestamps: [],
      id
    });
  } catch (err) {
    // Cleanup temp file on error
    if (wavInfo && wavInfo.needsCleanup && fs.existsSync(wavInfo.wavPath)) {
      try { fs.unlinkSync(wavInfo.wavPath); } catch { }
    }
    send({ type: 'error', error: err.message, id });
  }
}

function getAvailableModels(msg) {
  const { modelPath, configs, id } = msg;

  try {
    const availableFiles = new Set();
    try {
      const files = fs.readdirSync(modelPath);
      files.forEach(f => availableFiles.add(f));
    } catch {
      // Directory might not exist
    }

    const models = Object.entries(configs).map(([name, config]) => ({
      name,
      available: availableFiles.has(config.encoder) &&
                 availableFiles.has(config.decoder) &&
                 availableFiles.has(config.tokens),
      size: config.size,
      description: config.description
    }));

    send({ type: 'availableModels', models, id });
  } catch (err) {
    send({ type: 'error', error: err.message, id });
  }
}

// Read input line by line
const readline = require('readline');
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    handleMessage(msg);
  } catch (err) {
    send({ type: 'error', error: `Failed to parse message: ${err.message}` });
  }
});

// Signal ready
send({ type: 'ready', version: sherpa.version || 'unknown' });
