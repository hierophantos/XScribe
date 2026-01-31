/**
 * Database types - shared between main process and renderer
 */

export interface Project {
  id: string
  name: string
  description: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

export interface Tag {
  id: string
  name: string
  color: string | null
}

export type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed'

export interface Transcription {
  id: string
  projectId: string | null
  filePath: string
  fileName: string
  fileSize: number | null
  duration: number | null
  language: string | null
  modelUsed: string | null
  status: TranscriptionStatus
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  // Queue metadata (for pending items)
  queueModel: string | null
  queueDiarization: boolean | null
  // Joined data
  tags?: Tag[]
  segmentCount?: number
}

export interface Segment {
  id: number
  transcriptionId: string
  speakerId: string | null
  startTime: number
  endTime: number
  text: string
  confidence: number | null
}

export interface Speaker {
  id: string
  transcriptionId: string
  speakerId: string
  displayName: string | null
  color: string | null
}

export interface Settings {
  key: string
  value: string
}

// Query filters
export interface TranscriptionFilters {
  projectId?: string | null
  status?: TranscriptionStatus
  tagIds?: string[]
  limit?: number
  offset?: number
}

export interface SearchResult {
  transcriptionId: string
  transcription: Transcription
  matchingSegments: Array<{
    segment: Segment
    highlight: string
  }>
}

// Create/Update DTOs
export interface CreateProjectData {
  name: string
  description?: string
  color?: string
}

export interface UpdateProjectData {
  name?: string
  description?: string | null
  color?: string | null
}

export interface CreateTranscriptionData {
  filePath: string
  fileName: string
  fileSize?: number
  projectId?: string | null
  language?: string
  modelUsed?: string
}

export interface UpdateTranscriptionData {
  projectId?: string | null
  status?: TranscriptionStatus
  duration?: number
  language?: string
  error?: string | null
  completedAt?: string | null
}

export interface CreateSegmentData {
  speakerId?: string | null
  startTime: number
  endTime: number
  text: string
  confidence?: number | null
}

export interface CreateSpeakerData {
  speakerId: string
  displayName?: string | null
  color?: string | null
}

// Data for creating a pending queue item
export interface CreatePendingTranscriptionData {
  filePath: string
  fileName: string
  fileSize?: number
  projectId?: string | null
  duration?: number | null
  queueModel: string
  queueDiarization: boolean
}
