import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Import types from database (we'll define matching types here)
// These match the types in src/main/database/types.ts

interface Project {
  id: string
  name: string
  description: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

interface CreateProjectData {
  name: string
  description?: string
  color?: string
}

interface UpdateProjectData {
  name?: string
  description?: string | null
  color?: string | null
}

type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled'

interface Tag {
  id: string
  name: string
  color: string | null
}

interface Transcription {
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
  tags?: Tag[]
  segmentCount?: number
}

interface TranscriptionFilters {
  projectId?: string | null
  status?: TranscriptionStatus
  tagIds?: string[]
  limit?: number
  offset?: number
}

interface CreateTranscriptionData {
  filePath: string
  fileName: string
  projectId?: string
  fileSize?: number
  language?: string
  modelUsed?: string
}

interface UpdateTranscriptionData {
  projectId?: string | null
  status?: TranscriptionStatus
  duration?: number
  language?: string
  error?: string | null
  completedAt?: string | null
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

interface CreateSegmentData {
  speakerId?: string
  startTime: number
  endTime: number
  text: string
  confidence?: number
}

interface Speaker {
  id: string
  transcriptionId: string
  speakerId: string
  displayName: string | null
  color: string | null
}

interface CreateSpeakerData {
  speakerId: string
  displayName?: string
  color?: string
}

interface SearchResult {
  transcriptionId: string
  transcription: Transcription
  matchingSegments: Array<{
    segment: Segment
    highlight: string
  }>
}

// Transcription-related types
interface TranscribeOptions {
  language?: string
  model?: 'tiny' | 'base' | 'small' | 'medium' | 'large'
  useDiarization?: boolean
}

interface TranscriptionSegment {
  start: number
  end: number
  text: string
  speaker?: string
}

interface TranscriptionResult {
  segments: TranscriptionSegment[]
  language: string
  duration: number
}

interface TranscriptionProgress {
  percent: number
  currentTime: number
  totalTime: number
}

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
  stage: 'loading' | 'processing' | 'clustering'
}

interface ModelInfo {
  name: string
  available: boolean
  size: string
  description: string
}

interface ModelDownloadProgress {
  modelName: string
  percent: number
  downloadedBytes: number
  totalBytes: number
}

type ExportFormat = 'srt' | 'vtt' | 'txt' | 'json' | 'docx'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File utilities
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // Dialog
  openFileDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),

  // App info
  getVersion: (): Promise<string> => ipcRenderer.invoke('app:getVersion'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('app:getPlatform'),

  // FFmpeg
  ffmpeg: {
    check: (): Promise<{ installed: boolean; path?: string; version?: string; bundled?: boolean }> =>
      ipcRenderer.invoke('ffmpeg:check'),
    promptInstall: (): Promise<'install' | 'cancel' | 'manual'> =>
      ipcRenderer.invoke('ffmpeg:promptInstall'),
    install: (): Promise<{ success: boolean; error?: string }> =>
      ipcRenderer.invoke('ffmpeg:install'),
    showManualInstructions: (): Promise<void> =>
      ipcRenderer.invoke('ffmpeg:showManualInstructions'),
    onInstallProgress: (callback: (data: { message: string }) => void) => {
      ipcRenderer.on('ffmpeg:installProgress', (_event, data) => callback(data))
    },
    removeInstallProgressListener: () => {
      ipcRenderer.removeAllListeners('ffmpeg:installProgress')
    }
  },

  // Transcription
  transcribe: {
    start: (filePath: string, options?: TranscribeOptions): Promise<TranscriptionResult & { id: string }> =>
      ipcRenderer.invoke('transcribe:start', filePath, options),
    cancel: (transcriptionId: string): Promise<{ success: boolean }> =>
      ipcRenderer.invoke('transcribe:cancel', transcriptionId)
  },

  onTranscriptionCreated: (callback: (data: { id: string; fileName: string; status: string }) => void) => {
    ipcRenderer.on('transcribe:created', (_event, data) => callback(data))
  },

  onTranscriptionStatus: (callback: (data: { id: string; status: string }) => void) => {
    ipcRenderer.on('transcribe:status', (_event, data) => callback(data))
  },

  onTranscriptionProgress: (callback: (progress: TranscriptionProgress & { id: string }) => void) => {
    ipcRenderer.on('transcribe:progress', (_event, progress) => callback(progress))
  },

  onTranscriptionCompleted: (
    callback: (data: { id: string; status: string; duration: number; segmentCount: number }) => void
  ) => {
    ipcRenderer.on('transcribe:completed', (_event, data) => callback(data))
  },

  onTranscriptionFailed: (callback: (data: { id: string; status: string; error: string }) => void) => {
    ipcRenderer.on('transcribe:failed', (_event, data) => callback(data))
  },

  onTranscriptionCancelled: (callback: (data: { id: string }) => void) => {
    ipcRenderer.on('transcribe:cancelled', (_event, data) => callback(data))
  },

  onTranscriptionPartial: (
    callback: (data: {
      id: string
      segments: Array<{ start: number; end: number; text: string }>
      text: string
      duration: number
    }) => void
  ) => {
    ipcRenderer.on('transcribe:partial', (_event, data) => callback(data))
  },

  // Diarization
  diarize: (filePath: string): Promise<DiarizationResult> =>
    ipcRenderer.invoke('diarize:start', filePath),

  onDiarizationProgress: (callback: (progress: DiarizationProgress) => void) => {
    ipcRenderer.on('diarize:progress', (_event, progress) => callback(progress))
  },

  // Models
  models: {
    getDirectory: (): Promise<string | null> => ipcRenderer.invoke('models:getDirectory'),
    getAvailable: (): Promise<ModelInfo[]> => ipcRenderer.invoke('models:getAvailable'),
    load: (modelName: string): Promise<boolean> => ipcRenderer.invoke('models:load', modelName),
    isReady: (): Promise<boolean> => ipcRenderer.invoke('models:isReady'),
    download: (modelName: string): Promise<boolean> => ipcRenderer.invoke('models:download', modelName),
    onDownloadProgress: (
      callback: (data: { modelName: string; percent: number; downloadedBytes: number; totalBytes: number }) => void
    ) => {
      ipcRenderer.on('models:downloadProgress', (_event, data) => callback(data))
    },
    removeDownloadProgressListener: () => {
      ipcRenderer.removeAllListeners('models:downloadProgress')
    }
  },

  // Database - Projects
  db: {
    projects: {
      list: (): Promise<Project[]> => ipcRenderer.invoke('db:projects:list'),
      get: (id: string): Promise<Project | null> => ipcRenderer.invoke('db:projects:get', id),
      create: (data: CreateProjectData): Promise<Project> => ipcRenderer.invoke('db:projects:create', data),
      update: (id: string, data: UpdateProjectData): Promise<Project | null> =>
        ipcRenderer.invoke('db:projects:update', id, data),
      delete: (id: string): Promise<boolean> => ipcRenderer.invoke('db:projects:delete', id)
    },

    transcriptions: {
      list: (filters?: TranscriptionFilters): Promise<Transcription[]> =>
        ipcRenderer.invoke('db:transcriptions:list', filters),
      get: (id: string): Promise<Transcription | null> => ipcRenderer.invoke('db:transcriptions:get', id),
      create: (data: CreateTranscriptionData): Promise<Transcription> =>
        ipcRenderer.invoke('db:transcriptions:create', data),
      update: (id: string, data: UpdateTranscriptionData): Promise<Transcription | null> =>
        ipcRenderer.invoke('db:transcriptions:update', id, data),
      delete: (id: string): Promise<boolean> => ipcRenderer.invoke('db:transcriptions:delete', id),
      recent: (limit?: number): Promise<Transcription[]> => ipcRenderer.invoke('db:transcriptions:recent', limit),
      search: (query: string, limit?: number): Promise<SearchResult[]> =>
        ipcRenderer.invoke('db:transcriptions:search', query, limit)
    },

    segments: {
      get: (transcriptionId: string): Promise<Segment[]> => ipcRenderer.invoke('db:segments:get', transcriptionId),
      save: (transcriptionId: string, segments: CreateSegmentData[]): Promise<boolean> =>
        ipcRenderer.invoke('db:segments:save', transcriptionId, segments)
    },

    speakers: {
      get: (transcriptionId: string): Promise<Speaker[]> => ipcRenderer.invoke('db:speakers:get', transcriptionId),
      save: (transcriptionId: string, speakers: CreateSpeakerData[]): Promise<boolean> =>
        ipcRenderer.invoke('db:speakers:save', transcriptionId, speakers),
      rename: (transcriptionId: string, speakerId: string, displayName: string): Promise<boolean> =>
        ipcRenderer.invoke('db:speakers:rename', transcriptionId, speakerId, displayName)
    },

    tags: {
      list: (): Promise<Tag[]> => ipcRenderer.invoke('db:tags:list'),
      create: (name: string, color?: string): Promise<Tag> => ipcRenderer.invoke('db:tags:create', name, color),
      delete: (id: string): Promise<boolean> => ipcRenderer.invoke('db:tags:delete', id),
      addToTranscription: (transcriptionId: string, tagId: string): Promise<boolean> =>
        ipcRenderer.invoke('db:tags:addToTranscription', transcriptionId, tagId),
      removeFromTranscription: (transcriptionId: string, tagId: string): Promise<boolean> =>
        ipcRenderer.invoke('db:tags:removeFromTranscription', transcriptionId, tagId)
    },

    settings: {
      get: (key: string): Promise<string | null> => ipcRenderer.invoke('db:settings:get', key),
      set: (key: string, value: string): Promise<boolean> => ipcRenderer.invoke('db:settings:set', key, value)
    }
  },

  // Export
  export: {
    transcription: (
      transcriptionId: string,
      format: ExportFormat
    ): Promise<{ content: string; mimeType: string; extension: string }> =>
      ipcRenderer.invoke('export:transcription', transcriptionId, format),
    save: (transcriptionId: string, format: ExportFormat): Promise<string | null> =>
      ipcRenderer.invoke('export:save', transcriptionId, format)
  }
})

// Declare types for renderer
declare global {
  interface Window {
    electronAPI: {
      getPathForFile: (file: File) => string
      openFileDialog: () => Promise<string | null>
      getVersion: () => Promise<string>
      getPlatform: () => Promise<string>
      ffmpeg: {
        check: () => Promise<{ installed: boolean; path?: string; version?: string; bundled?: boolean }>
        promptInstall: () => Promise<'install' | 'cancel' | 'manual'>
        install: () => Promise<{ success: boolean; error?: string }>
        showManualInstructions: () => Promise<void>
        onInstallProgress: (callback: (data: { message: string }) => void) => void
        removeInstallProgressListener: () => void
      }
      transcribe: {
        start: (filePath: string, options?: TranscribeOptions) => Promise<TranscriptionResult & { id: string }>
        cancel: (transcriptionId: string) => Promise<{ success: boolean }>
      }
      onTranscriptionCreated: (callback: (data: { id: string; fileName: string; status: string }) => void) => void
      onTranscriptionStatus: (callback: (data: { id: string; status: string }) => void) => void
      onTranscriptionProgress: (callback: (progress: TranscriptionProgress & { id: string }) => void) => void
      onTranscriptionCompleted: (
        callback: (data: { id: string; status: string; duration: number; segmentCount: number }) => void
      ) => void
      onTranscriptionFailed: (callback: (data: { id: string; status: string; error: string }) => void) => void
      onTranscriptionCancelled: (callback: (data: { id: string }) => void) => void
      onTranscriptionPartial: (
        callback: (data: {
          id: string
          segments: Array<{ start: number; end: number; text: string }>
          text: string
          duration: number
        }) => void
      ) => void
      diarize: (filePath: string) => Promise<DiarizationResult>
      onDiarizationProgress: (callback: (progress: DiarizationProgress) => void) => void
      models: {
        getDirectory: () => Promise<string | null>
        getAvailable: () => Promise<ModelInfo[]>
        load: (modelName: string) => Promise<boolean>
        isReady: () => Promise<boolean>
        download: (modelName: string) => Promise<boolean>
        onDownloadProgress: (callback: (data: ModelDownloadProgress) => void) => void
        removeDownloadProgressListener: () => void
      }
      db: {
        projects: {
          list: () => Promise<Project[]>
          get: (id: string) => Promise<Project | null>
          create: (data: CreateProjectData) => Promise<Project>
          update: (id: string, data: UpdateProjectData) => Promise<Project | null>
          delete: (id: string) => Promise<boolean>
        }
        transcriptions: {
          list: (filters?: TranscriptionFilters) => Promise<Transcription[]>
          get: (id: string) => Promise<Transcription | null>
          create: (data: CreateTranscriptionData) => Promise<Transcription>
          update: (id: string, data: UpdateTranscriptionData) => Promise<Transcription | null>
          delete: (id: string) => Promise<boolean>
          recent: (limit?: number) => Promise<Transcription[]>
          search: (query: string, limit?: number) => Promise<SearchResult[]>
        }
        segments: {
          get: (transcriptionId: string) => Promise<Segment[]>
          save: (transcriptionId: string, segments: CreateSegmentData[]) => Promise<boolean>
        }
        speakers: {
          get: (transcriptionId: string) => Promise<Speaker[]>
          save: (transcriptionId: string, speakers: CreateSpeakerData[]) => Promise<boolean>
          rename: (transcriptionId: string, speakerId: string, displayName: string) => Promise<boolean>
        }
        tags: {
          list: () => Promise<Tag[]>
          create: (name: string, color?: string) => Promise<Tag>
          delete: (id: string) => Promise<boolean>
          addToTranscription: (transcriptionId: string, tagId: string) => Promise<boolean>
          removeFromTranscription: (transcriptionId: string, tagId: string) => Promise<boolean>
        }
        settings: {
          get: (key: string) => Promise<string | null>
          set: (key: string, value: string) => Promise<boolean>
        }
      }
      export: {
        transcription: (
          transcriptionId: string,
          format: ExportFormat
        ) => Promise<{ content: string; mimeType: string; extension: string }>
        save: (transcriptionId: string, format: ExportFormat) => Promise<string | null>
      }
    }
  }
}

export {}
