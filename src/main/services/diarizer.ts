/**
 * Speaker Diarization service using Python Pyannote
 *
 * This service handles:
 * - Spawning Python diarizer subprocess
 * - Loading Pyannote speaker diarization model
 * - Identifying speaker segments in audio
 * - Mapping speakers to transcription segments
 *
 * GPU Support:
 * - CUDA (NVIDIA GPUs) - Best performance
 * - MPS (Apple Metal - M1/M2/M3) - Native macOS acceleration
 * - CPU - Fallback for all systems
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { spawn, ChildProcess } from 'child_process'

// Public types
interface SpeakerSegment {
  speaker: string
  start: number
  end: number
}

interface DiarizationResult {
  speakers: string[]
  segments: SpeakerSegment[]
}

interface DiarizationProgress {
  percent: number
  stage: 'loading' | 'processing' | 'complete'
  message?: string
}

type ProgressCallback = (progress: DiarizationProgress) => void

// Message types for Python IPC
interface PythonMessage {
  type: string
  id?: string
  [key: string]: unknown
}

interface ReadyMessage extends PythonMessage {
  type: 'ready'
  device: string
  version: string
}

interface ModelLoadedMessage extends PythonMessage {
  type: 'modelLoaded'
  device: string
}

interface DiarizationResultMessage extends PythonMessage {
  type: 'diarizationResult'
  segments: SpeakerSegment[]
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

export class DiarizerService {
  private process: ChildProcess | null = null
  private modelLoaded = false
  private device: string | null = null
  private hfToken: string | null = null
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

  constructor() {}

  private getExecutablePath(): string | null {
    // Check multiple possible locations for the Python executable
    const possiblePaths = [
      // Development: built executable in resources
      join(process.cwd(), 'resources', 'pyannote', 'pyannote-diarizer'),
      // Production: bundled with app
      join(app.getAppPath(), '..', 'pyannote', 'pyannote-diarizer'),
      join(process.resourcesPath || '', 'pyannote', 'pyannote-diarizer'),
      // Development: run Python directly
      join(process.cwd(), 'python', 'diarizer.py')
    ]

    // On Windows, add .exe extension for compiled executables
    if (process.platform === 'win32') {
      const withExe = possiblePaths.map((p) =>
        p.endsWith('.py') ? p : p + '.exe'
      )
      possiblePaths.length = 0
      possiblePaths.push(...withExe)
    }

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        console.log('[DiarizerService] Found executable:', path)
        return path
      }
    }

    console.error('[DiarizerService] No executable found. Searched:', possiblePaths)
    return null
  }

  private async ensureProcessRunning(): Promise<void> {
    if (this.process && !this.process.killed) {
      // Process already running, wait for ready if needed
      if (this.readyPromise) {
        await this.readyPromise
      }
      return
    }

    const execPath = this.getExecutablePath()
    if (!execPath) {
      throw new Error(
        'Pyannote diarizer executable not found. Please run scripts/build-pyannote.sh first.'
      )
    }

    console.log('[DiarizerService] Starting Python diarizer process...')

    // Create ready promise
    this.readyPromise = new Promise<void>((resolve) => {
      this.readyResolve = resolve
    })

    // Determine how to run the executable
    const isPythonScript = execPath.endsWith('.py')

    if (isPythonScript) {
      // Development mode: run with Python
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3'
      this.process = spawn(pythonCmd, [execPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...process.env,
          PYTHONUNBUFFERED: '1'
        }
      })
    } else {
      // Production mode: run compiled executable
      this.process = spawn(execPath, [], {
        stdio: ['pipe', 'pipe', 'pipe']
      })
    }

    // Handle stdout (JSON messages)
    let buffer = ''
    this.process.stdout?.on('data', (data: Buffer) => {
      buffer += data.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        if (line.trim()) {
          try {
            const msg = JSON.parse(line) as PythonMessage
            this.handleMessage(msg)
          } catch (e) {
            console.error('[DiarizerService] Failed to parse message:', line, e)
          }
        }
      }
    })

    // Handle stderr (Python errors/logs)
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString().trim()
      if (text) {
        console.log('[DiarizerService Python]', text)
      }
    })

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      console.log(`[DiarizerService] Process exited with code ${code}, signal ${signal}`)
      this.process = null
      this.modelLoaded = false
      this.readyPromise = null

      // Reject any pending requests
      for (const [id, request] of this.pendingRequests) {
        request.reject(new Error(`Diarizer process exited unexpectedly (code ${code})`))
        this.pendingRequests.delete(id)
      }
    })

    this.process.on('error', (error) => {
      console.error('[DiarizerService] Process error:', error)
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
    console.log('[DiarizerService] Process ready, device:', this.device)
  }

  private handleMessage(msg: PythonMessage): void {
    console.log('[DiarizerService] Received:', msg.type, msg.id || '')

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
        this.modelLoaded = true
        this.resolveRequest(msg.id, msg)
        break
      }

      case 'diarizationResult': {
        this.resolveRequest(msg.id, msg)
        break
      }

      case 'progress': {
        const progressMsg = msg as ProgressMessage
        const request = this.pendingRequests.get(msg.id || '')
        if (request?.onProgress) {
          request.onProgress({
            percent: progressMsg.percent,
            stage: progressMsg.stage as DiarizationProgress['stage'],
            message: progressMsg.message
          })
        }
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
          console.error('[DiarizerService] Unhandled error:', errorMsg.error)
        }
        break
      }

      default:
        console.warn('[DiarizerService] Unknown message type:', msg.type)
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
      throw new Error('Diarizer process not running')
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
      // Set up timeout (default 30 minutes for long diarization)
      const timeout = options?.timeout || 1800000
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
   * Set the HuggingFace token for model access
   * Note: pyannote/speaker-diarization-3.1 requires accepting terms on HuggingFace
   */
  setHuggingFaceToken(token: string): void {
    this.hfToken = token
  }

  /**
   * Load the Pyannote diarization model
   */
  async loadModels(): Promise<boolean> {
    if (this.modelLoaded) {
      return true
    }

    console.log('[DiarizerService] Loading Pyannote model...')

    const result = await this.sendRequest<ModelLoadedMessage>({
      type: 'loadModel',
      hfToken: this.hfToken
    })

    if (result.type === 'modelLoaded') {
      this.modelLoaded = true
      this.device = result.device
      console.log('[DiarizerService] Model loaded on device:', this.device)
      return true
    }

    throw new Error('Failed to load model')
  }

  /**
   * Run speaker diarization on an audio file
   */
  async diarize(
    filePath: string,
    options: {
      numSpeakers?: number
      onProgress?: ProgressCallback
    } = {}
  ): Promise<DiarizationResult> {
    // Ensure model is loaded
    if (!this.modelLoaded) {
      await this.loadModels()
    }

    console.log(`[DiarizerService] Diarizing: ${filePath}`)

    const result = await this.sendRequest<DiarizationResultMessage>(
      {
        type: 'diarize',
        filePath,
        numSpeakers: options.numSpeakers
      },
      { onProgress: options.onProgress }
    )

    if (result.type === 'diarizationResult') {
      console.log(`[DiarizerService] Found ${result.speakers.length} speakers`)
      return {
        speakers: result.speakers,
        segments: result.segments
      }
    }

    throw new Error('Unexpected response from diarizer')
  }

  /**
   * Check if the model is loaded
   */
  isModelLoaded(): boolean {
    return this.modelLoaded
  }

  /**
   * Get the current device being used
   */
  getDevice(): string | null {
    return this.device
  }

  /**
   * Ping the diarizer process to check if it's alive
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
   * Stop the diarizer process
   */
  dispose(): void {
    if (this.process) {
      console.log('[DiarizerService] Stopping process...')
      this.process.kill()
      this.process = null
    }
    this.modelLoaded = false
    this.device = null
    this.pendingRequests.clear()
  }
}

// Singleton instance
let diarizerInstance: DiarizerService | null = null

export function getDiarizerService(): DiarizerService {
  if (!diarizerInstance) {
    diarizerInstance = new DiarizerService()
  }
  return diarizerInstance
}

/**
 * Merge transcription segments with diarization results
 * Assigns speaker labels to transcription segments based on timing overlap
 */
export function mergeTranscriptionWithDiarization(
  transcription: { start: number; end: number; text: string }[],
  diarization: DiarizationResult
): { start: number; end: number; text: string; speaker: string }[] {
  return transcription.map((segment) => {
    // Find the speaker segment with the most overlap
    let bestMatch = 'UNKNOWN'
    let maxOverlap = 0

    for (const speakerSeg of diarization.segments) {
      const overlapStart = Math.max(segment.start, speakerSeg.start)
      const overlapEnd = Math.min(segment.end, speakerSeg.end)
      const overlap = Math.max(0, overlapEnd - overlapStart)

      if (overlap > maxOverlap) {
        maxOverlap = overlap
        bestMatch = speakerSeg.speaker
      }
    }

    return {
      ...segment,
      speaker: bestMatch
    }
  })
}
