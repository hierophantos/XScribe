/**
 * Speaker Diarization service using sherpa-onnx
 *
 * This service handles:
 * - Loading speaker segmentation and embedding models
 * - Identifying speaker segments in audio
 * - Mapping speakers to transcription segments
 */

import { app } from 'electron'
import { join } from 'path'
import { existsSync, readdirSync } from 'fs'

// sherpa-onnx types
interface SherpaOnnxDiarizationConfig {
  segmentation: {
    pyannote: { model: string }
    numThreads?: number
    debug?: number
    provider?: string
  }
  embedding: {
    model: string
    numThreads?: number
    debug?: number
    provider?: string
  }
  clustering: {
    numClusters?: number
    threshold?: number
  }
  minDurationOn?: number
  minDurationOff?: number
}

interface SherpaSegment {
  start: number
  end: number
  speaker: number
}

interface SherpaOnnxDiarization {
  sampleRate: number
  process(samples: Float32Array): SherpaSegment[]
  free(): void
}

interface SherpaOnnx {
  createOfflineSpeakerDiarization(config: SherpaOnnxDiarizationConfig): SherpaOnnxDiarization
  readWave(filename: string): { samples: Float32Array; sampleRate: number }
}

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
  private sherpaOnnx: SherpaOnnx | null = null
  private diarizer: SherpaOnnxDiarization | null = null
  private isReady = false

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
      // Dynamic import of sherpa-onnx
      this.sherpaOnnx = await import('sherpa-onnx')

      // Create the diarization pipeline
      this.diarizer = this.sherpaOnnx.createOfflineSpeakerDiarization({
        segmentation: {
          pyannote: { model: segmentationModel },
          numThreads: 2,
          debug: 0,
          provider: 'cpu'
        },
        embedding: {
          model: embeddingModel,
          numThreads: 2,
          debug: 0,
          provider: 'cpu'
        },
        clustering: {
          numClusters: -1, // Auto-detect number of speakers
          threshold: 0.5
        },
        minDurationOn: 0.3,
        minDurationOff: 0.5
      })

      this.isReady = true
      console.log('[DiarizerService] Models loaded successfully')
      return true
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
    if (!this.sherpaOnnx || !this.diarizer) {
      // Try to load models if not already loaded
      await this.loadModels()
    }

    if (!this.sherpaOnnx || !this.diarizer) {
      throw new Error('Diarization models not loaded')
    }

    console.log(`[DiarizerService] Diarizing: ${filePath}`)

    try {
      // Report progress: loading
      options.onProgress?.({ percent: 10, stage: 'loading' })

      // Read the audio file
      const waveData = this.sherpaOnnx.readWave(filePath)

      // Report progress: segmenting
      options.onProgress?.({ percent: 30, stage: 'segmenting' })

      // Process the audio
      const segments = this.diarizer.process(waveData.samples)

      // Report progress: clustering
      options.onProgress?.({ percent: 80, stage: 'clustering' })

      // Extract unique speakers and format results
      const speakerSet = new Set<number>()
      const formattedSegments: SpeakerSegment[] = segments.map((seg) => {
        speakerSet.add(seg.speaker)
        return {
          speaker: `SPEAKER_${seg.speaker.toString().padStart(2, '0')}`,
          start: seg.start,
          end: seg.end
        }
      })

      const speakers = Array.from(speakerSet)
        .sort((a, b) => a - b)
        .map((id) => `SPEAKER_${id.toString().padStart(2, '0')}`)

      // Report progress: complete
      options.onProgress?.({ percent: 100, stage: 'clustering' })

      console.log(`[DiarizerService] Found ${speakers.length} speakers`)

      return {
        speakers,
        segments: formattedSegments
      }
    } catch (error) {
      console.error('[DiarizerService] Diarization failed:', error)
      throw error
    }
  }

  isModelLoaded(): boolean {
    return this.isReady
  }

  dispose(): void {
    if (this.diarizer) {
      this.diarizer.free()
      this.diarizer = null
    }
    this.isReady = false
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
