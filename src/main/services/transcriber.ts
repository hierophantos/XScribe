/**
 * Transcription service using sherpa-onnx-node via child process
 *
 * Runs sherpa-onnx-node in a separate Node.js process to avoid
 * Electron bundling issues with native addons.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync, mkdirSync, createWriteStream, unlinkSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { exec } from 'child_process'
import { promisify } from 'util'
import { EventEmitter } from 'events'

const execAsync = promisify(exec)

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
// Using int8 quantized models for better compatibility
const MODEL_CONFIGS = {
  'tiny.en': {
    encoder: 'tiny.en-encoder.int8.onnx',
    decoder: 'tiny.en-decoder.int8.onnx',
    tokens: 'tiny.en-tokens.txt',
    size: '~100MB',
    sizeBytes: 100_000_000,
    archiveName: 'sherpa-onnx-whisper-tiny.en.tar.bz2',
    description: 'Fastest, English only'
  },
  tiny: {
    encoder: 'tiny-encoder.int8.onnx',
    decoder: 'tiny-decoder.int8.onnx',
    tokens: 'tiny-tokens.txt',
    size: '~100MB',
    sizeBytes: 100_000_000,
    archiveName: 'sherpa-onnx-whisper-tiny.tar.bz2',
    description: 'Fastest, multilingual'
  },
  'base.en': {
    encoder: 'base.en-encoder.int8.onnx',
    decoder: 'base.en-decoder.int8.onnx',
    tokens: 'base.en-tokens.txt',
    size: '~160MB',
    sizeBytes: 160_000_000,
    archiveName: 'sherpa-onnx-whisper-base.en.tar.bz2',
    description: 'Balanced, English only'
  },
  base: {
    encoder: 'base-encoder.int8.onnx',
    decoder: 'base-decoder.int8.onnx',
    tokens: 'base-tokens.txt',
    size: '~160MB',
    sizeBytes: 160_000_000,
    archiveName: 'sherpa-onnx-whisper-base.tar.bz2',
    description: 'Balanced, multilingual'
  },
  'small.en': {
    encoder: 'small.en-encoder.int8.onnx',
    decoder: 'small.en-decoder.int8.onnx',
    tokens: 'small.en-tokens.txt',
    size: '~500MB',
    sizeBytes: 500_000_000,
    archiveName: 'sherpa-onnx-whisper-small.en.tar.bz2',
    description: 'Most accurate, English only'
  },
  small: {
    encoder: 'small-encoder.int8.onnx',
    decoder: 'small-decoder.int8.onnx',
    tokens: 'small-tokens.txt',
    size: '~500MB',
    sizeBytes: 500_000_000,
    archiveName: 'sherpa-onnx-whisper-small.tar.bz2',
    description: 'Most accurate, multilingual'
  }
} as const

const MODEL_BASE_URL = 'https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models'

type DownloadProgressCallback = (progress: {
  percent: number
  downloadedBytes: number
  totalBytes: number
}) => void

type ModelName = keyof typeof MODEL_CONFIGS

interface WorkerMessage {
  type: string
  id?: string
  [key: string]: unknown
}

export class TranscriberService extends EventEmitter {
  private modelPath: string | null = null
  private currentModel: ModelName | null = null
  private worker: ChildProcess | null = null
  private isReady = false
  private pendingRequests = new Map<string, { resolve: Function; reject: Function }>()
  private requestId = 0

  constructor() {
    super()
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
      mkdirSync(userDataModels, { recursive: true })
      console.log(`[TranscriberService] Created model directory: ${userDataModels}`)
      return userDataModels
    } catch {
      console.warn('[TranscriberService] Could not create model directory')
      return null
    }
  }

  /**
   * Start the worker process
   */
  private async startWorker(): Promise<void> {
    if (this.worker) {
      return
    }

    return new Promise((resolve, reject) => {
      // Find the worker script
      const workerPath = join(__dirname, 'transcription-worker.js')

      // For development, the worker might be in src
      const devWorkerPath = join(process.cwd(), 'src', 'main', 'services', 'transcription-worker.js')

      const actualWorkerPath = existsSync(workerPath) ? workerPath : devWorkerPath

      if (!existsSync(actualWorkerPath)) {
        reject(new Error(`Worker script not found at ${workerPath} or ${devWorkerPath}`))
        return
      }

      console.log(`[TranscriberService] Starting worker from: ${actualWorkerPath}`)

      // Get the platform-specific addon directory for sherpa-onnx native libs
      const platformArch = `${process.platform === 'win32' ? 'win' : process.platform}-${process.arch}`
      const addonDir = join(process.cwd(), 'node_modules', `sherpa-onnx-${platformArch}`)

      // Build environment with library path - MUST be set before process starts on macOS
      const env: NodeJS.ProcessEnv = { ...process.env }
      if (process.platform === 'darwin') {
        env.DYLD_LIBRARY_PATH = addonDir + (env.DYLD_LIBRARY_PATH ? ':' + env.DYLD_LIBRARY_PATH : '')
      } else if (process.platform === 'linux') {
        env.LD_LIBRARY_PATH = addonDir + (env.LD_LIBRARY_PATH ? ':' + env.LD_LIBRARY_PATH : '')
      }

      console.log(`[TranscriberService] Setting library path to: ${addonDir}`)

      // Spawn the worker as a child process with correct environment
      this.worker = spawn('node', [actualWorkerPath], {
        cwd: process.cwd(),
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      })

      // Handle stdout (JSON messages)
      this.worker.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().split('\n').filter((l) => l.trim())
        for (const line of lines) {
          try {
            const msg = JSON.parse(line) as WorkerMessage
            this.handleWorkerMessage(msg)

            // Resolve startup promise on ready
            if (msg.type === 'ready') {
              console.log(`[TranscriberService] Worker ready, version: ${msg.version}`)
              resolve()
            }
          } catch (err) {
            console.error('[TranscriberService] Failed to parse worker message:', line)
          }
        }
      })

      // Handle stderr
      this.worker.stderr?.on('data', (data: Buffer) => {
        console.error('[TranscriberService] Worker stderr:', data.toString())
      })

      // Handle worker exit
      this.worker.on('exit', (code) => {
        console.log(`[TranscriberService] Worker exited with code ${code}`)
        this.worker = null
        this.isReady = false

        // Reject all pending requests
        for (const [id, { reject }] of this.pendingRequests) {
          reject(new Error('Worker exited unexpectedly'))
        }
        this.pendingRequests.clear()
      })

      // Handle errors
      this.worker.on('error', (err) => {
        console.error('[TranscriberService] Worker error:', err)
        reject(err)
      })

      // Timeout for startup
      setTimeout(() => {
        if (!this.isReady && this.worker) {
          reject(new Error('Worker startup timeout'))
        }
      }, 10000)
    })
  }

  /**
   * Send a message to the worker and wait for response
   */
  private sendToWorker<T>(msg: Omit<WorkerMessage, 'id'>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.worker?.stdin) {
        reject(new Error('Worker not running'))
        return
      }

      const id = String(++this.requestId)
      this.pendingRequests.set(id, { resolve, reject })

      const fullMsg = { ...msg, id }
      this.worker.stdin.write(JSON.stringify(fullMsg) + '\n')

      // Timeout for request
      setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error('Request timeout'))
        }
      }, 300000) // 5 minute timeout for long transcriptions
    })
  }

  /**
   * Handle messages from the worker
   */
  private handleWorkerMessage(msg: WorkerMessage): void {
    const { type, id } = msg

    // Handle progress updates (no response needed)
    if (type === 'progress') {
      this.emit('progress', msg)
      return
    }

    // Handle responses to pending requests
    if (id && this.pendingRequests.has(id)) {
      const { resolve, reject } = this.pendingRequests.get(id)!
      this.pendingRequests.delete(id)

      if (type === 'error') {
        reject(new Error(msg.error as string))
      } else {
        resolve(msg)
      }
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
    // Start worker if not running
    if (!this.worker) {
      await this.startWorker()
    }

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

    // Check all required files exist locally first
    const encoderPath = join(this.modelPath, config.encoder)
    const decoderPath = join(this.modelPath, config.decoder)
    const tokensPath = join(this.modelPath, config.tokens)

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
      console.log(`[TranscriberService] Loading model: ${modelName}`)

      await this.sendToWorker({
        type: 'loadModel',
        modelPath: this.modelPath,
        modelName,
        config: {
          encoder: config.encoder,
          decoder: config.decoder,
          tokens: config.tokens
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

    console.log(`[TranscriberService] Transcribing: ${filePath}`)

    // Set up progress listener
    const progressHandler = (msg: WorkerMessage) => {
      if (options.onProgress) {
        options.onProgress({
          percent: (msg.percent as number) || 0,
          currentTime: 0,
          totalTime: 0
        })
      }
    }
    this.on('progress', progressHandler)

    try {
      const result = (await this.sendToWorker({
        type: 'transcribe',
        filePath
      })) as {
        text: string
        duration: number
        timestamps: number[]
        segments?: Array<{ start: number; end: number; text: string }>
      }

      // Use segments from worker if available (chunked transcription)
      // Otherwise fall back to single segment from full text
      const segments: TranscriptionSegment[] =
        result.segments && result.segments.length > 0
          ? result.segments.map((seg) => ({
              start: seg.start,
              end: seg.end,
              text: seg.text
            }))
          : result.text.trim()
            ? [
                {
                  start: 0,
                  end: result.duration,
                  text: result.text.trim()
                }
              ]
            : []

      return {
        segments,
        language: options.language || 'auto',
        duration: result.duration
      }
    } finally {
      this.off('progress', progressHandler)
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
  async downloadModel(modelName: ModelName, onProgress?: DownloadProgressCallback): Promise<boolean> {
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

  /**
   * Cancel the current transcription by killing the worker
   */
  cancelCurrentTranscription(): void {
    console.log('[TranscriberService] Cancelling current transcription...')
    if (this.worker) {
      this.worker.kill()
      this.worker = null
      this.isReady = false

      // Reject all pending requests with cancellation error
      for (const [, { reject }] of this.pendingRequests) {
        reject(new Error('Transcription cancelled'))
      }
      this.pendingRequests.clear()
    }
  }

  dispose(): void {
    if (this.worker) {
      this.worker.kill()
      this.worker = null
    }
    this.isReady = false
    this.pendingRequests.clear()
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
