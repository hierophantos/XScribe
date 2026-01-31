/**
 * Transcription store - manages active transcription state
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

interface TranscriptionSegment {
  start: number
  end: number
  text: string
  speaker?: string
}

interface Segment {
  id: number
  transcriptionId: string
  speakerId: string | null
  startTime: number
  endTime: number
  text: string
  confidence: number | null
}

interface Speaker {
  id: string
  transcriptionId: string
  speakerId: string
  displayName: string | null
  color: string | null
}

interface TranscriptionProgress {
  id: string
  percent: number
  currentTime: number
  totalTime: number
  stage?: 'downloading' | 'transcribing' | 'aligning' | 'diarizing' | 'assigning' | 'processing' | 'formatting' | 'complete'
  stageLabel?: string
}

type TranscriptionStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

// Pending transcription from database
interface PendingTranscription {
  id: string
  filePath: string
  fileName: string
  projectId: string | null
  queueModel: string | null
  queueDiarization: boolean | null
  duration: number | null
}

// Full transcription metadata
interface Transcription {
  id: string
  projectId: string | null
  filePath: string
  fileName: string
  fileSize: number | null
  duration: number | null
  language: string | null
  modelUsed: string | null
  status: string
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  queueModel: string | null
  queueDiarization: boolean | null
  segmentCount?: number
}

export const useTranscriptionStore = defineStore('transcription', () => {
  // State
  const activeTranscriptionId = ref<string | null>(null)
  const segments = ref<Segment[]>([])
  const speakers = ref<Speaker[]>([])
  const status = ref<TranscriptionStatus>('idle')
  const progress = ref<TranscriptionProgress | null>(null)
  const error = ref<string | null>(null)
  const isLoading = ref(false)

  // Queue state for batch processing (persisted in database)
  const pendingQueue = ref<PendingTranscription[]>([])
  const isProcessingQueue = ref(false)
  const currentProcessingId = ref<string | null>(null)

  // Full transcription metadata (for display in TranscriptionView)
  const activeTranscription = ref<Transcription | null>(null)

  // Computed
  const speakerMap = computed(() => {
    const map = new Map<string, Speaker>()
    for (const speaker of speakers.value) {
      map.set(speaker.speakerId, speaker)
    }
    return map
  })

  const segmentsWithSpeakerNames = computed(() => {
    return segments.value.map((seg) => {
      const speaker = seg.speakerId ? speakerMap.value.get(seg.speakerId) : null
      return {
        ...seg,
        speakerName: speaker?.displayName || seg.speakerId || 'Unknown'
      }
    })
  })

  const uniqueSpeakers = computed(() => {
    const speakerIds = new Set(segments.value.map((s) => s.speakerId).filter(Boolean))
    return [...speakerIds].map((id) => speakerMap.value.get(id!) || { speakerId: id, displayName: id })
  })

  const fullText = computed(() => {
    return segments.value.map((s) => s.text).join(' ')
  })

  const totalDuration = computed(() => {
    if (segments.value.length === 0) return 0
    return Math.max(...segments.value.map((s) => s.endTime))
  })

  // Get the filename of the currently processing item
  const currentProcessingFileName = computed(() => {
    if (!currentProcessingId.value) return null
    const item = pendingQueue.value.find(i => i.id === currentProcessingId.value)
    return item?.fileName || null
  })

  // Actions
  async function loadTranscription(id: string) {
    isLoading.value = true
    error.value = null
    activeTranscriptionId.value = id

    try {
      const [transcription, segmentsList, speakersList] = await Promise.all([
        window.electronAPI.db.transcriptions.get(id),
        window.electronAPI.db.segments.get(id),
        window.electronAPI.db.speakers.get(id)
      ])

      activeTranscription.value = transcription
      segments.value = segmentsList
      speakers.value = speakersList
      status.value = 'completed'
    } catch (err) {
      console.error('[TranscriptionStore] Failed to load transcription:', err)
      error.value = err instanceof Error ? err.message : 'Failed to load transcription'
      status.value = 'failed'
    } finally {
      isLoading.value = false
    }
  }

  function clearTranscription() {
    activeTranscriptionId.value = null
    activeTranscription.value = null
    segments.value = []
    speakers.value = []
    status.value = 'idle'
    progress.value = null
    error.value = null
  }

  async function renameSpeaker(speakerId: string, displayName: string) {
    if (!activeTranscriptionId.value) return

    try {
      await window.electronAPI.db.speakers.rename(activeTranscriptionId.value, speakerId, displayName)

      // Update local state
      const speaker = speakers.value.find((s) => s.speakerId === speakerId)
      if (speaker) {
        speaker.displayName = displayName
      }
    } catch (err) {
      console.error('[TranscriptionStore] Failed to rename speaker:', err)
      throw err
    }
  }

  // Transcription process handlers
  function onTranscriptionCreated(data: { id: string; fileName: string; status: string }) {
    activeTranscriptionId.value = data.id
    status.value = 'pending'
    segments.value = []
    speakers.value = []
    error.value = null
    progress.value = null
  }

  // Track previous stage to detect transitions
  const previousStage = ref<string | null>(null)

  function onTranscriptionProgress(data: TranscriptionProgress) {
    if (data.id === activeTranscriptionId.value) {
      // Detect transition from downloading to transcription stages
      // When this happens, reset the progress to show transcription starting fresh
      const currentStage = data.stage
      const wasDownloading = previousStage.value === 'downloading'
      const isNowTranscribing = currentStage && currentStage !== 'downloading' && currentStage !== 'complete'

      if (wasDownloading && isNowTranscribing) {
        // Transitioning from download to transcription - the new percent is for transcription
        // No adjustment needed, just let the new progress flow through
      }

      previousStage.value = currentStage || null
      progress.value = data
      status.value = 'processing'
    }
  }

  function onTranscriptionCompleted(data: { id: string; duration: number; segmentCount: number }) {
    if (data.id === activeTranscriptionId.value) {
      status.value = 'completed'
      progress.value = null
      // Reload to get the segments from database
      loadTranscription(data.id)
    }
  }

  function onTranscriptionFailed(data: { id: string; error: string }) {
    if (data.id === activeTranscriptionId.value) {
      status.value = 'failed'
      error.value = data.error
      progress.value = null
    }
  }

  function onTranscriptionCancelled(data: { id: string }) {
    if (data.id === activeTranscriptionId.value) {
      status.value = 'cancelled'
      progress.value = null
    }
  }

  // Handle partial transcription results (streaming)
  function onTranscriptionPartial(data: {
    id: string
    segments: Array<{ start: number; end: number; text: string }>
    text: string
    duration: number
  }) {
    if (data.id === activeTranscriptionId.value) {
      // Update segments with partial results for live display
      segments.value = data.segments.map((seg, index) => ({
        id: index,
        transcriptionId: data.id,
        speakerId: null,
        startTime: seg.start,
        endTime: seg.end,
        text: seg.text,
        confidence: null
      }))
      status.value = 'processing'
    }
  }

  // Extensions that require ffmpeg for conversion
  const NEEDS_FFMPEG = ['.mp3', '.m4a', '.flac', '.ogg', '.webm', '.mp4', '.mkv', '.avi', '.mov']

  // Check if a file needs ffmpeg and if it's installed
  // FFmpeg is bundled with the app, so this should always succeed
  // But we keep the check as a fallback in case the bundled binary fails
  async function ensureFFmpegForFile(filePath: string): Promise<boolean> {
    const ext = filePath.toLowerCase().split('.').pop()
    if (!ext || !NEEDS_FFMPEG.includes(`.${ext}`)) {
      return true // WAV files don't need ffmpeg
    }

    // Check if ffmpeg is available (bundled or system)
    const ffmpegStatus = await window.electronAPI.ffmpeg.check()
    if (ffmpegStatus.installed) {
      return true
    }

    // FFmpeg not found - this shouldn't happen with bundled ffmpeg
    // but provide a fallback to install system ffmpeg
    console.warn('[TranscriptionStore] Bundled FFmpeg not found, prompting for installation')

    // Prompt user to install ffmpeg
    const choice = await window.electronAPI.ffmpeg.promptInstall()

    if (choice === 'cancel') {
      throw new Error('FFmpeg is required to process this file type. Installation was cancelled.')
    }

    if (choice === 'manual') {
      await window.electronAPI.ffmpeg.showManualInstructions()
      throw new Error('Please install FFmpeg manually and restart XScribe.')
    }

    // User chose to install automatically
    const installResult = await window.electronAPI.ffmpeg.install()

    if (!installResult.success) {
      throw new Error(installResult.error || 'FFmpeg installation failed. Please install manually.')
    }

    // Verify installation
    const newStatus = await window.electronAPI.ffmpeg.check()
    if (!newStatus.installed) {
      throw new Error('FFmpeg installation completed, but could not be detected. Please restart XScribe and try again.')
    }

    return true
  }

  // Start a new transcription using WhisperX
  async function startTranscription(
    filePath: string,
    options?: {
      language?: string
      model?: string
      useDiarization?: boolean
      projectId?: string
    }
  ) {
    status.value = 'pending'
    error.value = null
    progress.value = null

    try {
      // Check for ffmpeg if needed for this file type
      await ensureFFmpegForFile(filePath)

      // Use WhisperX for transcription with word-level timestamps
      const result = await window.electronAPI.whisperx.transcribe(filePath, {
        language: options?.language,
        modelSize: options?.model,
        enableDiarization: options?.useDiarization ?? true,
        projectId: options?.projectId
      })

      activeTranscriptionId.value = result.id

      // Convert the result segments to our format
      segments.value = result.segments.map((seg, index) => ({
        id: index,
        transcriptionId: result.id,
        speakerId: seg.speaker || null,
        startTime: seg.start,
        endTime: seg.end,
        text: seg.text,
        confidence: null
      }))

      status.value = 'completed'
      return result
    } catch (err) {
      console.error('[TranscriptionStore] Transcription failed:', err)
      error.value = err instanceof Error ? err.message : 'Transcription failed'
      status.value = 'failed'
      throw err
    }
  }

  /**
   * Switch to viewing a processing transcription (shows progress view)
   */
  function viewProcessingTranscription(id: string) {
    activeTranscriptionId.value = id
    status.value = 'processing'
    // Clear any loaded segments from a previous transcription
    segments.value = []
    speakers.value = []
    error.value = null
  }

  /**
   * Load pending queue from database
   */
  async function loadPendingQueue() {
    try {
      const pending = await window.electronAPI.db.transcriptions.getPending()
      pendingQueue.value = pending.map(t => ({
        id: t.id,
        filePath: t.filePath,
        fileName: t.fileName,
        projectId: t.projectId,
        queueModel: t.queueModel,
        queueDiarization: t.queueDiarization,
        duration: t.duration
      }))
    } catch (err) {
      console.error('[TranscriptionStore] Failed to load pending queue:', err)
    }
  }

  /**
   * Add a file to the transcription queue (persisted in database)
   */
  async function queueTranscription(
    filePath: string,
    fileName: string,
    options: {
      projectId?: string
      model?: string
      useDiarization?: boolean
      fileSize?: number
      duration?: number
    } = {}
  ) {
    try {
      const pendingRecord = await window.electronAPI.db.transcriptions.createPending({
        filePath,
        fileName,
        fileSize: options.fileSize,
        projectId: options.projectId,
        duration: options.duration,
        queueModel: options.model || 'base.en',
        queueDiarization: options.useDiarization ?? true
      })

      // Add to local state
      pendingQueue.value.push({
        id: pendingRecord.id,
        filePath: pendingRecord.filePath,
        fileName: pendingRecord.fileName,
        projectId: pendingRecord.projectId,
        queueModel: pendingRecord.queueModel,
        queueDiarization: pendingRecord.queueDiarization,
        duration: pendingRecord.duration
      })

      return pendingRecord
    } catch (err) {
      console.error('[TranscriptionStore] Failed to queue transcription:', err)
      throw err
    }
  }

  /**
   * Process the transcription queue sequentially
   * Called on app startup and after adding items to queue
   */
  async function processQueue() {
    if (isProcessingQueue.value) {
      return
    }

    // Reload queue from database to get latest state
    await loadPendingQueue()

    if (pendingQueue.value.length === 0) {
      return
    }

    isProcessingQueue.value = true

    while (pendingQueue.value.length > 0) {
      const item = pendingQueue.value[0]
      currentProcessingId.value = item.id

      try {
        // Check for ffmpeg if needed
        await ensureFFmpegForFile(item.filePath)

        // Start transcription - this updates status to 'processing' in DB via IPC
        await window.electronAPI.whisperx.transcribe(item.filePath, {
          modelSize: item.queueModel || 'base.en',
          enableDiarization: item.queueDiarization ?? true,
          projectId: item.projectId || undefined
        })
      } catch (err) {
        console.error('[TranscriptionStore] Queue item failed:', item.filePath, err)
        // The IPC handler will update the status to 'failed' in DB
      }

      // Remove from local queue (status is already updated in DB by IPC)
      pendingQueue.value.shift()
      currentProcessingId.value = null
    }

    isProcessingQueue.value = false
  }

  /**
   * Remove a specific item from the queue by ID
   */
  async function removeFromQueue(id: string) {
    try {
      // Delete from database
      await window.electronAPI.db.transcriptions.delete(id)

      // Remove from local state
      const index = pendingQueue.value.findIndex(item => item.id === id)
      if (index !== -1) {
        pendingQueue.value.splice(index, 1)
      }
    } catch (err) {
      console.error('[TranscriptionStore] Failed to remove from queue:', err)
      throw err
    }
  }

  /**
   * Clear all pending items from the queue
   */
  async function clearQueue() {
    try {
      // Delete all pending items from database
      for (const item of pendingQueue.value) {
        await window.electronAPI.db.transcriptions.delete(item.id)
      }
      pendingQueue.value = []
    } catch (err) {
      console.error('[TranscriptionStore] Failed to clear queue:', err)
      throw err
    }
  }

  return {
    // State
    activeTranscriptionId,
    activeTranscription,
    segments,
    speakers,
    status,
    progress,
    error,
    isLoading,
    pendingQueue,
    isProcessingQueue,
    currentProcessingId,

    // Computed
    speakerMap,
    segmentsWithSpeakerNames,
    uniqueSpeakers,
    fullText,
    totalDuration,
    currentProcessingFileName,

    // Actions
    loadTranscription,
    clearTranscription,
    renameSpeaker,
    startTranscription,
    viewProcessingTranscription,
    loadPendingQueue,
    queueTranscription,
    processQueue,
    clearQueue,
    removeFromQueue,

    // Event handlers
    onTranscriptionCreated,
    onTranscriptionProgress,
    onTranscriptionCompleted,
    onTranscriptionFailed,
    onTranscriptionCancelled,
    onTranscriptionPartial
  }
})
