/**
 * Transcription service using sherpa-onnx
 *
 * Uses sherpa-onnx's Whisper implementation for transcription.
 * This avoids native addon issues and provides consistent cross-platform support.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'

// Lazy load sherpa-onnx to avoid startup issues
let sherpaOnnx: typeof import('sherpa-onnx') | null = null

async function getSherpaOnnx() {
  if (!sherpaOnnx) {
    sherpaOnnx = await import('sherpa-onnx')
  }
  return sherpaOnnx
}

interface TranscriptionResult {
  segments: TranscriptionSegment[]
  language: string
  duration: number
}

interface TranscriptionSegment {
  start: number
  end: number
  text: string
  speaker?: string
}

interface TranscriptionProgress {
  percent: number
  currentTime: number
  totalTime: number
}

type ProgressCallback = (progress: TranscriptionProgress) => void

// Whisper model configurations for sherpa-onnx
// These use the ONNX-converted whisper models
const MODEL_CONFIGS = {
  'tiny.en': {
    encoder: 'whisper-tiny.en-encoder.onnx',
    decoder: 'whisper-tiny.en-decoder.onnx',
    tokens: 'whisper-tiny.en-tokens.txt',
    size: '~60MB'
  },
  tiny: {
    encoder: 'whisper-tiny-encoder.onnx',
    decoder: 'whisper-tiny-decoder.onnx',
    tokens: 'whisper-tiny-tokens.txt',
    size: '~60MB'
  },
  'base.en': {
    encoder: 'whisper-base.en-encoder.onnx',
    decoder: 'whisper-base.en-decoder.onnx',
    tokens: 'whisper-base.en-tokens.txt',
    size: '~120MB'
  },
  base: {
    encoder: 'whisper-base-encoder.onnx',
    decoder: 'whisper-base-decoder.onnx',
    tokens: 'whisper-base-tokens.txt',
    size: '~120MB'
  },
  'small.en': {
    encoder: 'whisper-small.en-encoder.onnx',
    decoder: 'whisper-small.en-decoder.onnx',
    tokens: 'whisper-small.en-tokens.txt',
    size: '~400MB'
  },
  small: {
    encoder: 'whisper-small-encoder.onnx',
    decoder: 'whisper-small-decoder.onnx',
    tokens: 'whisper-small-tokens.txt',
    size: '~400MB'
  }
} as const

type ModelName = keyof typeof MODEL_CONFIGS

export class TranscriberService {
  private modelPath: string | null = null
  private currentModel: ModelName | null = null
  private recognizer: ReturnType<typeof import('sherpa-onnx').createOfflineRecognizer> | null = null
  private isReady = false

  constructor() {
    this.modelPath = this.findModelPath()
  }

  private findModelPath(): string | null {
    const possiblePaths = [
      // Development path
      join(process.cwd(), 'models'),
      // Production path (resources folder)
      join(app.getAppPath(), '..', 'models'),
      join(app.getPath('userData'), 'models')
    ]

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        console.log(`[TranscriberService] Found model directory: ${path}`)
        return path
      }
    }

    // Create user data models directory if none exist
    const userDataModels = join(app.getPath('userData'), 'models')
    try {
      require('fs').mkdirSync(userDataModels, { recursive: true })
      console.log(`[TranscriberService] Created model directory: ${userDataModels}`)
      return userDataModels
    } catch {
      console.warn('[TranscriberService] Could not create model directory')
      return null
    }
  }

  getAvailableModels(): { name: string; available: boolean; size: string }[] {
    if (!this.modelPath) {
      return Object.entries(MODEL_CONFIGS).map(([name, config]) => ({
        name,
        available: false,
        size: config.size
      }))
    }

    const availableFiles = new Set<string>()
    try {
      const files = readdirSync(this.modelPath)
      files.forEach((f) => availableFiles.add(f))
    } catch {
      // Directory might not exist yet
    }

    return Object.entries(MODEL_CONFIGS).map(([name, config]) => ({
      name,
      available:
        availableFiles.has(config.encoder) &&
        availableFiles.has(config.decoder) &&
        availableFiles.has(config.tokens),
      size: config.size
    }))
  }

  async loadModel(modelName: ModelName = 'base'): Promise<boolean> {
    if (!this.modelPath) {
      throw new Error('Model directory not found')
    }

    const config = MODEL_CONFIGS[modelName]
    if (!config) {
      throw new Error(`Unknown model: ${modelName}. Available: ${Object.keys(MODEL_CONFIGS).join(', ')}`)
    }

    const encoderPath = join(this.modelPath, config.encoder)
    const decoderPath = join(this.modelPath, config.decoder)
    const tokensPath = join(this.modelPath, config.tokens)

    // Check all required files exist
    const missing: string[] = []
    if (!existsSync(encoderPath)) missing.push(config.encoder)
    if (!existsSync(decoderPath)) missing.push(config.decoder)
    if (!existsSync(tokensPath)) missing.push(config.tokens)

    if (missing.length > 0) {
      throw new Error(
        `Missing model files: ${missing.join(', ')}. ` +
          `Download from: https://github.com/k2-fsa/sherpa-onnx/releases/tag/asr-models`
      )
    }

    try {
      const sherpa = await getSherpaOnnx()

      // Create offline recognizer with Whisper model
      this.recognizer = sherpa.createOfflineRecognizer({
        modelConfig: {
          whisper: {
            encoder: encoderPath,
            decoder: decoderPath
          },
          tokens: tokensPath,
          numThreads: 2,
          provider: 'cpu',
          debug: 0
        }
      })

      this.currentModel = modelName
      this.isReady = true
      console.log(`[TranscriberService] Model loaded: ${modelName}`)
      return true
    } catch (error) {
      console.error('[TranscriberService] Failed to load model:', error)
      throw error
    }
  }

  async transcribe(
    filePath: string,
    options: {
      language?: string
      model?: ModelName
      onProgress?: ProgressCallback
    } = {}
  ): Promise<TranscriptionResult> {
    // Load model if needed
    if (!this.isReady || (options.model && options.model !== this.currentModel)) {
      await this.loadModel(options.model || this.currentModel || 'base')
    }

    if (!this.recognizer) {
      throw new Error('Recognizer not initialized')
    }

    console.log(`[TranscriberService] Transcribing: ${filePath}`)

    try {
      const sherpa = await getSherpaOnnx()

      // Report initial progress
      options.onProgress?.({ percent: 10, currentTime: 0, totalTime: 0 })

      // Read the audio file
      const waveData = sherpa.readWave(filePath)
      const totalDuration = waveData.samples.length / waveData.sampleRate

      options.onProgress?.({ percent: 30, currentTime: 0, totalTime: totalDuration })

      // Create a stream and process
      const stream = this.recognizer.createStream()
      stream.acceptWaveform(waveData.sampleRate, waveData.samples)

      options.onProgress?.({ percent: 50, currentTime: 0, totalTime: totalDuration })

      // Decode
      this.recognizer.decode(stream)

      options.onProgress?.({ percent: 90, currentTime: totalDuration, totalTime: totalDuration })

      // Get result
      const result = this.recognizer.getResult(stream)

      options.onProgress?.({ percent: 100, currentTime: totalDuration, totalTime: totalDuration })

      // Parse the result into segments
      // sherpa-onnx offline recognizer returns text, we'll create a single segment
      // For word-level timestamps, we'd need to use a different model configuration
      const segments: TranscriptionSegment[] = result.text.trim()
        ? [
            {
              start: 0,
              end: totalDuration,
              text: result.text.trim()
            }
          ]
        : []

      // If timestamps are available in the result
      if (result.timestamps && result.timestamps.length > 0) {
        // TODO: Parse word-level timestamps into segments
      }

      return {
        segments,
        language: options.language || 'auto',
        duration: totalDuration
      }
    } catch (error) {
      console.error('[TranscriberService] Transcription failed:', error)
      throw error
    }
  }

  isModelLoaded(): boolean {
    return this.isReady
  }

  getCurrentModel(): string | null {
    return this.currentModel
  }

  getModelDirectory(): string | null {
    return this.modelPath
  }

  dispose(): void {
    this.recognizer = null
    this.isReady = false
  }
}

// Singleton instance
let transcriberInstance: TranscriberService | null = null

export function getTranscriberService(): TranscriberService {
  if (!transcriberInstance) {
    transcriberInstance = new TranscriberService()
  }
  return transcriberInstance
}
