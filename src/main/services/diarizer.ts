/**
 * Speaker Diarization service using sherpa-onnx-node via worker
 *
 * This service handles:
 * - Loading speaker segmentation and embedding models via the transcription worker
 * - Identifying speaker segments in audio
 * - Mapping speakers to transcription segments
 *
 * Uses the same worker process as transcription to avoid native addon loading issues.
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'
import { getTranscriberService, TranscriberService } from './transcriber'

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
  stage: 'loading' | 'segmenting' | 'embedding' | 'clustering'
}

type ProgressCallback = (progress: DiarizationProgress) => void

// Required model files
const REQUIRED_MODELS = {
  segmentation: 'sherpa-onnx-pyannote-segmentation-3-0.onnx',
  embedding: 'wespeaker_en_voxceleb_resnet34.onnx'
}

export class DiarizerService {
  private modelPath: string | null = null
  private transcriber: TranscriberService | null = null
  private modelsLoaded = false

  constructor() {
    this.modelPath = this.findModelPath()
  }

  private findModelPath(): string | null {
    const possiblePaths = [
      join(process.cwd(), 'models'),
      join(app.getAppPath(), '..', 'models'),
      join(app.getPath('userData'), 'models')
    ]

    for (const path of possiblePaths) {
      if (existsSync(path)) {
        return path
      }
    }

    return null
  }

  getRequiredModels(): { name: string; file: string; available: boolean }[] {
    if (!this.modelPath) {
      return Object.entries(REQUIRED_MODELS).map(([name, file]) => ({
        name,
        file,
        available: false
      }))
    }

    const availableFiles = new Set<string>()
    try {
      const files = readdirSync(this.modelPath)
      files.forEach((f) => availableFiles.add(f))
    } catch {
      // Directory might not exist
    }

    return Object.entries(REQUIRED_MODELS).map(([name, file]) => ({
      name,
      file,
      available: availableFiles.has(file)
    }))
  }

  private getTranscriber(): TranscriberService {
    if (!this.transcriber) {
      this.transcriber = getTranscriberService()
    }
    return this.transcriber
  }

  async loadModels(): Promise<boolean> {
    if (!this.modelPath) {
      throw new Error('Model directory not found')
    }

    const segmentationModel = join(this.modelPath, REQUIRED_MODELS.segmentation)
    const embeddingModel = join(this.modelPath, REQUIRED_MODELS.embedding)

    // Check if models exist
    const hasSegmentation = existsSync(segmentationModel)
    const hasEmbedding = existsSync(embeddingModel)

    if (!hasSegmentation || !hasEmbedding) {
      const missing: string[] = []
      if (!hasSegmentation) missing.push(REQUIRED_MODELS.segmentation)
      if (!hasEmbedding) missing.push(REQUIRED_MODELS.embedding)

      throw new Error(
        `Missing diarization models: ${missing.join(', ')}. ` +
          `Download from: https://github.com/k2-fsa/sherpa-onnx/releases`
      )
    }

    try {
      // Ensure the worker is running
      const transcriber = this.getTranscriber()
      await transcriber.ensureWorkerRunning()

      console.log('[DiarizerService] Loading diarization models via worker...')

      // Send load request to worker
      const result = await transcriber.sendWorkerMessage<{ type: string }>({
        type: 'loadDiarizationModels',
        modelPath: this.modelPath,
        segmentationModel: REQUIRED_MODELS.segmentation,
        embeddingModel: REQUIRED_MODELS.embedding
      })

      if (result.type === 'diarizationModelsLoaded') {
        this.modelsLoaded = true
        console.log('[DiarizerService] Models loaded successfully')
        return true
      } else {
        throw new Error('Unexpected response from worker')
      }
    } catch (error) {
      console.error('[DiarizerService] Failed to load models:', error)
      throw error
    }
  }

  async diarize(
    filePath: string,
    options: {
      minSpeakers?: number
      maxSpeakers?: number
      onProgress?: ProgressCallback
    } = {}
  ): Promise<DiarizationResult> {
    // Load models if not already loaded
    if (!this.modelsLoaded) {
      await this.loadModels()
    }

    console.log(`[DiarizerService] Diarizing: ${filePath}`)

    try {
      const transcriber = this.getTranscriber()

      // Set up progress listener
      const progressHandler = (msg: { type: string; percent?: number; stage?: string }) => {
        if (msg.type === 'progress' && options.onProgress) {
          options.onProgress({
            percent: msg.percent || 0,
            stage: (msg.stage as DiarizationProgress['stage']) || 'segmenting'
          })
        }
      }
      transcriber.onWorkerMessage(progressHandler)

      try {
        // Send diarization request to worker
        const result = await transcriber.sendWorkerMessage<{
          type: string
          speakers: string[]
          segments: SpeakerSegment[]
        }>({
          type: 'diarize',
          filePath,
          numSpeakers: options.minSpeakers // Use minSpeakers as hint if provided
        })

        if (result.type === 'diarizationResult') {
          console.log(`[DiarizerService] Found ${result.speakers.length} speakers`)
          return {
            speakers: result.speakers,
            segments: result.segments
          }
        } else {
          throw new Error('Unexpected response from worker')
        }
      } finally {
        transcriber.offWorkerMessage(progressHandler)
      }
    } catch (error) {
      console.error('[DiarizerService] Diarization failed:', error)
      throw error
    }
  }

  isModelLoaded(): boolean {
    return this.modelsLoaded
  }

  dispose(): void {
    this.modelsLoaded = false
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
