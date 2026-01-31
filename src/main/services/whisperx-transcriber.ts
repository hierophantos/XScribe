/**
 * WhisperX Transcription service using Python subprocess
 *
 * This service provides:
 * - Whisper transcription via faster-whisper
 * - Word-level timestamps via wav2vec2 forced alignment
 * - Built-in speaker diarization with pyannote.audio
 * - Automatic speaker-word alignment
 *
 * GPU Support:
 * - CUDA (NVIDIA GPUs) - Best performance
 * - CPU - Fallback (MPS not supported by faster-whisper)
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { getSetupService } from './setup-service'

// Word-level timestamp data
interface WordTimestamp {
  word: string
  start: number
  end: number
  speaker?: string
  confidence?: number
}

// Segment with word-level data
interface TranscriptionSegment {
  start: number
  end: number
  text: string
  speaker?: string
  words?: WordTimestamp[]
}

interface TranscriptionResult {
  segments: TranscriptionSegment[]
  language: string
  duration: number
  speakers: string[]
}

interface TranscriptionProgress {
  percent: number
  stage: 'downloading' | 'loading' | 'transcribing' | 'aligning' | 'diarizing' | 'assigning' | 'processing' | 'formatting' | 'complete'
  message?: string
}

type ProgressCallback = (progress: TranscriptionProgress) => void

// Available Whisper model sizes
type ModelSize = 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large' | 'large-v2' | 'large-v3'

// Model info for UI
const MODEL_INFO: Record<ModelSize, { description: string; size: string }> = {
  'tiny': { description: 'Fastest, multilingual', size: '~75MB' },
  'tiny.en': { description: 'Fastest, English only', size: '~75MB' },
  'base': { description: 'Fast, multilingual', size: '~145MB' },
  'base.en': { description: 'Fast, English only', size: '~145MB' },
  'small': { description: 'Balanced, multilingual', size: '~470MB' },
  'small.en': { description: 'Balanced, English only', size: '~470MB' },
  'medium': { description: 'Accurate, multilingual', size: '~1.5GB' },
  'medium.en': { description: 'Accurate, English only', size: '~1.5GB' },
  'large': { description: 'Most accurate, multilingual', size: '~2.9GB' },
  'large-v2': { description: 'Most accurate v2, multilingual', size: '~2.9GB' },
  'large-v3': { description: 'Latest, most accurate', size: '~2.9GB' }
}

// Message types for Python IPC
interface PythonMessage {
  type: string
  id?: string
  [key: string]: unknown
}

interface ReadyMessage extends PythonMessage {
  type: 'ready'
  device: string
  computeType: string
  version: string
}

interface ModelLoadedMessage extends PythonMessage {
  type: 'modelLoaded'
  device: string
  modelSize: string
}

interface TranscriptionResultMessage extends PythonMessage {
  type: 'transcriptionResult'
  segments: TranscriptionSegment[]
  language: string
  duration: number
  speakers: string[]
}

interface ProgressMessage extends PythonMessage {
  type: 'progress'
  percent: number
  stage: string
  message?: string
}

interface ErrorMessage extends PythonMessage {
  type: 'error'
  error: string
}

export class WhisperXTranscriberService extends EventEmitter {
  private process: ChildProcess | null = null
  private modelLoaded = false
  private device: string | null = null
  private currentModelSize: ModelSize | null = null
  private messageId = 0
  private pendingRequests: Map<
    string,
    {
      resolve: (value: unknown) => void
      reject: (error: Error) => void
      onProgress?: ProgressCallback
    }
  > = new Map()
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null

  constructor() {
    super()
  }

  /**
   * Get the path to the transcriber.py script
   */
  private getTranscriberScriptPath(): string | null {
    const possiblePaths = [
      // Production: bundled in resources
      join(process.resourcesPath || '', 'python', 'transcriber.py'),
      // Development: local python directory
      join(process.cwd(), 'python', 'transcriber.py')
    ]

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        console.log('[WhisperXTranscriberService] Found transcriber script:', path)
        return path
      }
    }

    console.error('[WhisperXTranscriberService] Transcriber script not found. Searched:', possiblePaths)
    return null
  }

  /**
   * Get the path to the Python executable
   * Delegates to SetupService which handles bundled, lite, and development builds
   */
  private getPythonPath(): string | null {
    const setupService = getSetupService()
    const pythonPath = setupService.getPythonPath()

    if (existsSync(pythonPath)) {
      console.log('[WhisperXTranscriberService] Using Python:', pythonPath)
      return pythonPath
    }

    console.error('[WhisperXTranscriberService] Python not found at:', pythonPath)
    return null
  }

  private getExecutablePath(): string | null {
    // For backward compatibility, just return the transcriber script path
    return this.getTranscriberScriptPath()
  }

  private async ensureProcessRunning(): Promise<void> {
    if (this.process && !this.process.killed) {
      if (this.readyPromise) {
        await this.readyPromise
      }
      return
    }

    const scriptPath = this.getTranscriberScriptPath()
    if (!scriptPath) {
      throw new Error(
        'WhisperX transcriber not found. Please ensure python/transcriber.py exists.'
      )
    }

    const pythonPath = this.getPythonPath()
    if (!pythonPath) {
      throw new Error(
        'Python not found. Please ensure Python is installed or bundled with the app.'
      )
    }

    console.log('[WhisperXTranscriberService] Starting Python process...')
    console.log('[WhisperXTranscriberService] Python:', pythonPath)
    console.log('[WhisperXTranscriberService] Script:', scriptPath)

    // Create ready promise
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve
    })

    // Build environment with correct paths
    const pythonDir = app.isPackaged
      ? join(process.resourcesPath, 'python')
      : join(process.cwd(), 'python', 'venv')

    const env = {
      ...process.env,
      PYTHONUNBUFFERED: '1',
      PATH: process.platform === 'win32'
        ? `${pythonDir};${pythonDir}\\Scripts;${process.env.PATH}`
        : `${join(pythonDir, 'bin')}:${process.env.PATH}`
    }

    this.process = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env
    })

    // Handle stdout (JSON messages)
    let buffer = ''
    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        // Trim to handle Windows \r\n line endings (Python outputs \r\n on Windows)
        const trimmedLine = line.trim()
        if (trimmedLine) {
          try {
            const msg = JSON.parse(trimmedLine) as PythonMessage
            this.handleMessage(msg)
          } catch (e) {
            console.error('[WhisperXTranscriberService] Failed to parse message:', trimmedLine, e)
          }
        }
      }
    })

    // Handle stderr (Python logs)
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        console.log('[WhisperXTranscriberService Python]', text)
      }
    })

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      console.log(`[WhisperXTranscriberService] Process exited with code ${code}, signal ${signal}`)
      this.process = null
      this.modelLoaded = false
      this.readyPromise = null

      // Reject any pending requests
      for (const [id, request] of this.pendingRequests) {
        request.reject(new Error(`WhisperX process exited unexpectedly (code ${code})`))
        this.pendingRequests.delete(id)
      }
    })

    this.process.on('error', (error) => {
      console.error('[WhisperXTranscriberService] Process error:', error)
      this.process = null
      this.modelLoaded = false

      // Reject any pending requests
      for (const [id, request] of this.pendingRequests) {
        request.reject(error)
        this.pendingRequests.delete(id)
      }
    })

    // Wait for ready message
    await this.readyPromise
    console.log('[WhisperXTranscriberService] Process ready, device:', this.device)
  }

  private handleMessage(msg: PythonMessage): void {
    // Only log non-progress messages to reduce noise
    if (msg.type !== 'progress') {
      console.log('[WhisperXTranscriberService] Received:', msg.type, msg.id || '')
    }

    switch (msg.type) {
      case 'ready': {
        const readyMsg = msg as ReadyMessage
        this.device = readyMsg.device
        if (this.readyResolve) {
          this.readyResolve()
          this.readyResolve = null
        }
        break
      }

      case 'modelLoaded': {
        const loadedMsg = msg as ModelLoadedMessage
        this.device = loadedMsg.device
        this.currentModelSize = loadedMsg.modelSize as ModelSize
        this.modelLoaded = true
        this.resolveRequest(msg.id, msg)
        break
      }

      case 'transcriptionResult': {
        this.resolveRequest(msg.id, msg)
        break
      }

      case 'progress': {
        const progressMsg = msg as ProgressMessage
        const request = this.pendingRequests.get(msg.id || '')
        if (request?.onProgress) {
          request.onProgress({
            percent: progressMsg.percent,
            stage: progressMsg.stage as TranscriptionProgress['stage'],
            message: progressMsg.message
          })
        }
        // Also emit for external listeners
        this.emit('progress', {
          percent: progressMsg.percent,
          stage: progressMsg.stage,
          message: progressMsg.message
        })
        break
      }

      case 'pong': {
        this.resolveRequest(msg.id, msg)
        break
      }

      case 'error': {
        const errorMsg = msg as ErrorMessage
        const request = this.pendingRequests.get(msg.id || '')
        if (request) {
          request.reject(new Error(errorMsg.error))
          this.pendingRequests.delete(msg.id || '')
        } else {
          console.error('[WhisperXTranscriberService] Unhandled error:', errorMsg.error)
        }
        break
      }

      default:
        console.warn('[WhisperXTranscriberService] Unknown message type:', msg.type)
    }
  }

  private resolveRequest(id: string | undefined, result: unknown): void {
    if (!id) return
    const request = this.pendingRequests.get(id)
    if (request) {
      request.resolve(result)
      this.pendingRequests.delete(id)
    }
  }

  private sendMessage(msg: PythonMessage): void {
    if (!this.process?.stdin?.writable) {
      throw new Error('WhisperX process not running')
    }
    const json = JSON.stringify(msg) + '\n'
    this.process.stdin.write(json)
  }

  private async sendRequest<T>(
    msg: Omit<PythonMessage, 'id'>,
    options?: { onProgress?: ProgressCallback; timeout?: number }
  ): Promise<T> {
    await this.ensureProcessRunning()

    const id = `msg_${++this.messageId}`
    const msgWithId = { ...msg, id }

    return new Promise<T>((resolve, reject) => {
      // Set up timeout (default 60 minutes for long transcriptions)
      const timeout = options?.timeout || 3600000
      const timeoutId = setTimeout(() => {
        if (this.pendingRequests.has(id)) {
          this.pendingRequests.delete(id)
          reject(new Error(`Request timeout after ${timeout / 1000} seconds`))
        }
      }, timeout)

      this.pendingRequests.set(id, {
        resolve: (result) => {
          clearTimeout(timeoutId)
          resolve(result as T)
        },
        reject: (error) => {
          clearTimeout(timeoutId)
          reject(error)
        },
        onProgress: options?.onProgress
      })

      try {
        this.sendMessage(msgWithId)
      } catch (error) {
        clearTimeout(timeoutId)
        this.pendingRequests.delete(id)
        reject(error)
      }
    })
  }

  /**
   * Check which models are downloaded locally
   */
  private getDownloadedModels(): Set<ModelSize> {
    const downloaded = new Set<ModelSize>()

    // HuggingFace cache location
    const cacheDir = join(homedir(), '.cache', 'huggingface', 'hub')

    if (!existsSync(cacheDir)) {
      return downloaded
    }

    try {
      const dirs = readdirSync(cacheDir)

      // Map directory names to model sizes
      // Format: models--Systran--faster-whisper-{size}
      for (const dir of dirs) {
        if (dir.startsWith('models--Systran--faster-whisper-')) {
          const modelName = dir.replace('models--Systran--faster-whisper-', '')
          // Handle model name variations (e.g., "base.en" stored as "base.en")
          if (modelName in MODEL_INFO) {
            downloaded.add(modelName as ModelSize)
          }
        }
      }
    } catch (err) {
      console.error('[WhisperXTranscriberService] Error reading cache dir:', err)
    }

    return downloaded
  }

  /**
   * Get available model info for UI
   */
  getAvailableModels(): { name: ModelSize; description: string; size: string; downloaded: boolean }[] {
    const downloadedModels = this.getDownloadedModels()

    return Object.entries(MODEL_INFO).map(([name, info]) => ({
      name: name as ModelSize,
      ...info,
      downloaded: downloadedModels.has(name as ModelSize)
    }))
  }

  /**
   * Load a Whisper model
   */
  async loadModel(
    modelSize: ModelSize = 'base',
    language = 'en',
    onProgress?: ProgressCallback
  ): Promise<boolean> {
    if (this.modelLoaded && this.currentModelSize === modelSize) {
      return true
    }

    console.log(`[WhisperXTranscriberService] Loading model: ${modelSize}`)

    const result = await this.sendRequest<ModelLoadedMessage>(
      {
        type: 'loadModel',
        modelSize,
        language
      },
      { onProgress }
    )

    if (result.type === 'modelLoaded') {
      this.modelLoaded = true
      this.currentModelSize = modelSize
      this.device = result.device
      console.log('[WhisperXTranscriberService] Model loaded on device:', this.device)
      return true
    }

    throw new Error('Failed to load model')
  }

  /**
   * Transcribe an audio file with word-level timestamps and speaker diarization
   */
  async transcribe(
    filePath: string,
    options: {
      language?: string
      modelSize?: ModelSize
      enableDiarization?: boolean
      numSpeakers?: number
      onProgress?: ProgressCallback
    } = {}
  ): Promise<TranscriptionResult> {
    const {
      language = 'en',
      modelSize = 'base',
      enableDiarization = true,
      numSpeakers,
      onProgress
    } = options

    // Load model if needed (pass onProgress to show download progress)
    if (!this.modelLoaded || (modelSize && modelSize !== this.currentModelSize)) {
      await this.loadModel(modelSize, language, onProgress)
    }

    console.log(`[WhisperXTranscriberService] Transcribing: ${filePath}`)

    const result = await this.sendRequest<TranscriptionResultMessage>(
      {
        type: 'transcribe',
        filePath,
        language,
        enableDiarization,
        numSpeakers
      },
      { onProgress }
    )

    if (result.type === 'transcriptionResult') {
      console.log(`[WhisperXTranscriberService] Transcription complete: ${result.segments.length} segments`)
      return {
        segments: result.segments,
        language: result.language,
        duration: result.duration,
        speakers: result.speakers
      }
    }

    throw new Error('Unexpected response from WhisperX')
  }

  /**
   * Check if model is loaded
   */
  isModelLoaded(): boolean {
    return this.modelLoaded
  }

  /**
   * Get current model size
   */
  getCurrentModel(): ModelSize | null {
    return this.currentModelSize
  }

  /**
   * Get current device
   */
  getDevice(): string | null {
    return this.device
  }

  /**
   * Ping the process to check if it's alive
   */
  async ping(): Promise<boolean> {
    try {
      const result = await this.sendRequest<PythonMessage>(
        { type: 'ping' },
        { timeout: 5000 }
      )
      return result.type === 'pong'
    } catch {
      return false
    }
  }

  /**
   * Cancel current transcription
   */
  cancelCurrentTranscription(): void {
    console.log('[WhisperXTranscriberService] Cancelling transcription...')
    if (this.process) {
      this.process.kill()
      this.process = null
      this.modelLoaded = false

      // Reject all pending requests
      for (const [, { reject }] of this.pendingRequests) {
        reject(new Error('Transcription cancelled'))
      }
      this.pendingRequests.clear()
    }
  }

  /**
   * Stop the process
   */
  dispose(): void {
    if (this.process) {
      console.log('[WhisperXTranscriberService] Stopping process...')
      this.process.kill()
      this.process = null
    }
    this.modelLoaded = false
    this.device = null
    this.currentModelSize = null
    this.pendingRequests.clear()
  }
}

// Singleton instance
let whisperXInstance: WhisperXTranscriberService | null = null

export function getWhisperXTranscriberService(): WhisperXTranscriberService {
  if (!whisperXInstance) {
    whisperXInstance = new WhisperXTranscriberService()
  }
  return whisperXInstance
}
