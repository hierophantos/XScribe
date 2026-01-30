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
}

type TranscriptionStatus = 'idle' | 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

export const useTranscriptionStore = defineStore('transcription', () => {
  // State
  const activeTranscriptionId = ref<string | null>(null)
  const segments = ref<Segment[]>([])
  const speakers = ref<Speaker[]>([])
  const status = ref<TranscriptionStatus>('idle')
  const progress = ref<TranscriptionProgress | null>(null)
  const error = ref<string | null>(null)
  const isLoading = ref(false)

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

  // Actions
  async function loadTranscription(id: string) {
    isLoading.value = true
    error.value = null
    activeTranscriptionId.value = id

    try {
      const [segmentsList, speakersList] = await Promise.all([
        window.electronAPI.db.segments.get(id),
        window.electronAPI.db.speakers.get(id)
      ])

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

  function onTranscriptionProgress(data: TranscriptionProgress) {
    if (data.id === activeTranscriptionId.value) {
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

  // Start a new transcription
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

      const result = await window.electronAPI.transcribe.start(filePath, options)

      // The result contains the transcription ID and segments
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

  return {
    // State
    activeTranscriptionId,
    segments,
    speakers,
    status,
    progress,
    error,
    isLoading,

    // Computed
    speakerMap,
    segmentsWithSpeakerNames,
    uniqueSpeakers,
    fullText,
    totalDuration,

    // Actions
    loadTranscription,
    clearTranscription,
    renameSpeaker,
    startTranscription,

    // Event handlers
    onTranscriptionCreated,
    onTranscriptionProgress,
    onTranscriptionCompleted,
    onTranscriptionFailed,
    onTranscriptionCancelled
  }
})
