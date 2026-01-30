/**
 * Transcription service using sherpa-onnx
 *
 * Uses sherpa-onnx's Whisper implementation for transcription.
 * This avoids native addon issues and provides consistent cross-platform support.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, mkdirSync, createWriteStream, unlinkSync } from 'fs'
import { createGunzip } from 'zlib'
import { pipeline } from 'stream/promises'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

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
// File names match sherpa-onnx release artifacts
const MODEL_CONFIGS = {
  'tiny.en': {
    encoder: 'tiny.en-encoder.onnx',
    decoder: 'tiny.en-decoder.onnx',
    tokens: 'tiny.en-tokens.txt',
    size: '~150MB',
    sizeBytes: 150_000_000,
    archiveName: 'sherpa-onnx-whisper-tiny.en.tar.bz2',
    description: 'Fastest, English only'
  },
  tiny: {
    encoder: 'tiny-encoder.onnx',
    decoder: 'tiny-decoder.onnx',
    tokens: 'tiny-tokens.txt',
    size: '~150MB',
    sizeBytes: 150_000_000,
    archiveName: 'sherpa-onnx-whisper-tiny.tar.bz2',
    description: 'Fastest, multilingual'
  },
  'base.en': {
    encoder: 'base.en-encoder.onnx',
    decoder: 'base.en-decoder.onnx',
    tokens: 'base.en-tokens.txt',
    size: '~280MB',
    sizeBytes: 280_000_000,
    archiveName: 'sherpa-onnx-whisper-base.en.tar.bz2',
    description: 'Balanced, English only'
  },
  base: {
    encoder: 'base-encoder.onnx',
    decoder: 'base-decoder.onnx',
    tokens: 'base-tokens.txt',
    size: '~280MB',
    sizeBytes: 280_000_000,
    archiveName: 'sherpa-onnx-whisper-base.tar.bz2',
    description: 'Balanced, multilingual'
  },
  'small.en': {
    encoder: 'small.en-encoder.onnx',
    decoder: 'small.en-decoder.onnx',
    tokens: 'small.en-tokens.txt',
    size: '~900MB',
    sizeBytes: 900_000_000,
    archiveName: 'sherpa-onnx-whisper-small.en.tar.bz2',
    description: 'Most accurate, English only'
  },
  small: {
    encoder: 'small-encoder.onnx',
    decoder: 'small-decoder.onnx',
    tokens: 'small-tokens.txt',
    size: '~900MB',
    sizeBytes: 900_000_000,
    archiveName: 'sherpa-onnx-whisper-small.tar.bz2',
    description: 'Most accurate, multilingual'
  }
} as const

const MODEL_BASE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

type DownloadProgressCallback = (progress: { percent: number; downloadedBytes: number; totalBytes: number }) => void

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

  getAvailableModels(): { name: string; available: boolean; size: string; description: string }[] {
    if (!this.modelPath) {
      return Object.entries(MODEL_CONFIGS).map(([name, config]) => ({
        name,
        available: false,
        size: config.size,
        description: config.description
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
      size: config.size,
      description: config.description
    }))
  }

  /**
   * Get the first available model, preferring English models
   */
  private getFirstAvailableModel(): ModelName | null {
    const models = this.getAvailableModels()
    // Prefer English models in order: tiny.en, base.en, small.en, then multilingual
    const preferredOrder: ModelName[] = ['tiny.en', 'base.en', 'small.en', 'tiny', 'base', 'small']
    for (const name of preferredOrder) {
      const model = models.find((m) => m.name === name && m.available)
      if (model) {
        return name
      }
    }
    return null
  }

  async loadModel(modelName?: ModelName): Promise<boolean> {
    // Auto-detect model if not specified
    if (!modelName) {
      const availableModel = this.getFirstAvailableModel()
      if (availableModel) {
        modelName = availableModel
        console.log(`[TranscriberService] Auto-selected model: ${modelName}`)
      } else {
        modelName = 'base' // Default for error message
      }
    }
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
    // Load model if needed (auto-detects available model if not specified)
    if (!this.isReady || (options.model && options.model !== this.currentModel)) {
      await this.loadModel(options.model || this.currentModel || undefined)
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

  /**
   * Download a model from sherpa-onnx releases
   */
  async downloadModel(
    modelName: ModelName,
    onProgress?: DownloadProgressCallback
  ): Promise<boolean> {
    if (!this.modelPath) {
      throw new Error('Model directory not found')
    }

    const config = MODEL_CONFIGS[modelName]
    if (!config) {
      throw new Error(`Unknown model: ${modelName}`)
    }

    // Check if already downloaded
    const models = this.getAvailableModels()
    const existing = models.find((m) => m.name === modelName)
    if (existing?.available) {
      console.log(`[TranscriberService] Model ${modelName} already downloaded`)
      return true
    }

    const url = `${MODEL_BASE_URL}/${config.archiveName}`
    const tempFile = join(this.modelPath, `${modelName}-temp.tar.bz2`)

    console.log(`[TranscriberService] Downloading model: ${modelName} from ${url}`)

    try {
      // Ensure model directory exists
      if (!existsSync(this.modelPath)) {
        mkdirSync(this.modelPath, { recursive: true })
      }

      // Download the file with progress tracking
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`)
      }

      const totalBytes = parseInt(response.headers.get('content-length') || '0', 10) || config.sizeBytes
      let downloadedBytes = 0

      const fileStream = createWriteStream(tempFile)
      const reader = response.body?.getReader()

      if (!reader) {
        throw new Error('Failed to get response reader')
      }

      // Read and write chunks
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        fileStream.write(Buffer.from(value))
        downloadedBytes += value.length

        onProgress?.({
          percent: Math.round((downloadedBytes / totalBytes) * 100),
          downloadedBytes,
          totalBytes
        })
      }

      fileStream.end()
      await new Promise((resolve) => fileStream.on('finish', resolve))

      console.log(`[TranscriberService] Download complete, extracting...`)
      onProgress?.({ percent: 95, downloadedBytes: totalBytes, totalBytes })

      // Extract the tar.bz2 file
      // Use tar command on macOS/Linux
      await execAsync(`tar -xjf "${tempFile}" -C "${this.modelPath}"`)

      // Move files from extracted directory to models root
      const extractedDir = join(this.modelPath, `sherpa-onnx-whisper-${modelName}`)
      if (existsSync(extractedDir)) {
        const files = readdirSync(extractedDir)
        for (const file of files) {
          const src = join(extractedDir, file)
          const dest = join(this.modelPath, file)
          await execAsync(`mv "${src}" "${dest}"`)
        }
        await execAsync(`rm -rf "${extractedDir}"`)
      }

      // Clean up temp file
      if (existsSync(tempFile)) {
        unlinkSync(tempFile)
      }

      console.log(`[TranscriberService] Model ${modelName} installed successfully`)
      onProgress?.({ percent: 100, downloadedBytes: totalBytes, totalBytes })

      return true
    } catch (error) {
      console.error(`[TranscriberService] Failed to download model:`, error)

      // Clean up temp file on error
      if (existsSync(tempFile)) {
        try {
          unlinkSync(tempFile)
        } catch {
          // Ignore cleanup errors
        }
      }

      throw error
    }
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
