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
  // Queue metadata (for pending items)
  queueModel: string | null
  queueDiarization: boolean | null
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

interface CreatePendingTranscriptionData {
  filePath: string
  fileName: string
  fileSize?: number
  projectId?: string | null
  duration?: number | null
  queueModel: string
  queueDiarization: boolean
}

interface SearchResult {
  transcriptionId: string
  transcription: Transcription
  matchingSegments: Array<{
    segment: Segment
    highlight: string
  }>
}

// WhisperX transcription options
interface WhisperXTranscribeOptions {
  language?: string
  modelSize?: 'tiny' | 'tiny.en' | 'base' | 'base.en' | 'small' | 'small.en' | 'medium' | 'medium.en' | 'large' | 'large-v2' | 'large-v3'
  enableDiarization?: boolean
  numSpeakers?: number
  projectId?: string
}

// Word-level timestamp data
interface WordTimestamp {
  word: string
  start: number
  end: number
  speaker?: string
  confidence?: number
}

// WhisperX segment with word-level data
interface WhisperXSegment {
  start: number
  end: number
  text: string
  speaker?: string
  words?: WordTimestamp[]
}

// WhisperX transcription result
interface WhisperXTranscriptionResult {
  id: string
  segments: WhisperXSegment[]
  language: string
  duration: number
  speakers: string[]
}

// WhisperX model info
interface WhisperXModelInfo {
  name: string
  description: string
  size: string
  downloaded: boolean
}

interface TranscriptionProgress {
  percent: number
  currentTime: number
  totalTime: number
}

type ExportFormat = 'srt' | 'vtt' | 'txt' | 'json' | 'docx'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  // File utilities
  getPathForFile: (file: File): string => webUtils.getPathForFile(file),

  // Dialog
  openFileDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFile'),
  openDirectoryDialog: (): Promise<string | null> => ipcRenderer.invoke('dialog:openDirectory'),

  // Media Scanner
  media: {
    scanDirectory: (
      dirPath: string,
      recursive: boolean = false
    ): Promise<{
      files: Array<{
        path: string
        name: string
        size: number
        duration: number | null
        isVideo: boolean
        alreadyTranscribed: boolean
      }>
      totalCount: number
      totalDuration: number
      errors: string[]
    }> => ipcRenderer.invoke('media:scanDirectory', dirPath, recursive),

    estimateTime: (
      durationSeconds: number,
      modelSize: string,
      enableDiarization: boolean
    ): Promise<number> =>
      ipcRenderer.invoke('media:estimateTime', durationSeconds, modelSize, enableDiarization)
  },

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

  // WhisperX Transcription (word-level timestamps + built-in diarization)
  whisperx: {
    transcribe: (filePath: string, options?: WhisperXTranscribeOptions): Promise<WhisperXTranscriptionResult> =>
      ipcRenderer.invoke('transcribe:whisperx', filePath, options),
    getModels: (): Promise<WhisperXModelInfo[]> => ipcRenderer.invoke('whisperx:getModels'),
    isReady: (): Promise<boolean> => ipcRenderer.invoke('whisperx:isReady'),
    loadModel: (modelSize: string, language?: string): Promise<boolean> =>
      ipcRenderer.invoke('whisperx:loadModel', modelSize, language)
  },

  // Transcription control
  transcribe: {
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
        ipcRenderer.invoke('db:transcriptions:search', query, limit),
      // Queue methods
      createPending: (data: CreatePendingTranscriptionData): Promise<Transcription> =>
        ipcRenderer.invoke('db:transcriptions:createPending', data),
      getPending: (): Promise<Transcription[]> =>
        ipcRenderer.invoke('db:transcriptions:getPending'),
      recoverInterrupted: (): Promise<number> =>
        ipcRenderer.invoke('db:transcriptions:recoverInterrupted')
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
      ipcRenderer.invoke('export:save', transcriptionId, format),
    project: (projectId: string, format: ExportFormat): Promise<{ exportDir: string; count: number } | null> =>
      ipcRenderer.invoke('export:project', projectId, format)
  },

  // Setup (first-run)
  setup: {
    isComplete: (): Promise<boolean> => ipcRenderer.invoke('setup:isComplete'),
    run: (): Promise<void> => ipcRenderer.invoke('setup:run'),
    reset: (): Promise<void> => ipcRenderer.invoke('setup:reset'),
    getPythonPath: (): Promise<string> => ipcRenderer.invoke('setup:getPythonPath')
  },
  onSetupProgress: (
    callback: (progress: { stage: string; percent: number; message: string; error?: string }) => void
  ) => {
    ipcRenderer.on('setup:progress', (_event, progress) => callback(progress))
  }
})

// Declare types for renderer
declare global {
  interface Window {
    electronAPI: {
      getPathForFile: (file: File) => string
      openFileDialog: () => Promise<string | null>
      openDirectoryDialog: () => Promise<string | null>
      media: {
        scanDirectory: (
          dirPath: string,
          recursive?: boolean
        ) => Promise<{
          files: Array<{
            path: string
            name: string
            size: number
            duration: number | null
            isVideo: boolean
            alreadyTranscribed: boolean
          }>
          totalCount: number
          totalDuration: number
          errors: string[]
        }>
        estimateTime: (
          durationSeconds: number,
          modelSize: string,
          enableDiarization: boolean
        ) => Promise<number>
      }
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
      whisperx: {
        transcribe: (filePath: string, options?: WhisperXTranscribeOptions) => Promise<WhisperXTranscriptionResult>
        getModels: () => Promise<WhisperXModelInfo[]>
        isReady: () => Promise<boolean>
        loadModel: (modelSize: string, language?: string) => Promise<boolean>
      }
      transcribe: {
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
          // Queue methods
          createPending: (data: CreatePendingTranscriptionData) => Promise<Transcription>
          getPending: () => Promise<Transcription[]>
          recoverInterrupted: () => Promise<number>
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
        project: (projectId: string, format: ExportFormat) => Promise<{ exportDir: string; count: number } | null>
      }
      setup: {
        isComplete: () => Promise<boolean>
        run: () => Promise<void>
        reset: () => Promise<void>
        getPythonPath: () => Promise<string>
      }
      onSetupProgress: (
        callback: (progress: { stage: string; percent: number; message: string; error?: string }) => void
      ) => void
    }
  }
}

export {}
