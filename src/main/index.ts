import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getWhisperXTranscriberService } from './services/whisperx-transcriber'
import { getDatabaseService, closeDatabaseService } from './database'
import { getExporterService, ExportFormat } from './services/exporter'
import {
  scanDirectory,
  estimateTranscriptionTime,
  type ScannedFile
} from './services/media-scanner'
import {
  promptFFmpegInstall,
  installFFmpeg,
  showManualInstructions,
  getFFmpegStatus,
  clearFFmpegCache
} from './services/ffmpeg-installer'
import type {
  CreateProjectData,
  UpdateProjectData,
  TranscriptionFilters,
  CreateTranscriptionData,
  UpdateTranscriptionData,
  CreateSegmentData,
  CreateSpeakerData,
  CreatePendingTranscriptionData
} from './database'

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  // HMR for renderer based on electron-vite cli
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ============ Dialog IPC Handlers ============

ipcMain.handle('dialog:openFile', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Audio Files', extensions: ['mp3', 'wav', 'flac', 'm4a', 'ogg', 'webm'] },
      { name: 'Video Files', extensions: ['mp4', 'mkv', 'avi', 'mov', 'webm'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('dialog:openDirectory', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

// ============ Media Scanner IPC Handlers ============

ipcMain.handle(
  'media:scanDirectory',
  async (_event, dirPath: string, recursive: boolean = false) => {
    const db = getDatabaseService()

    // Get only completed transcription file paths to mark already-transcribed files
    // (don't include pending, processing, failed, or cancelled transcriptions)
    const existingTranscriptions = db.getTranscriptions({ status: 'completed' })
    const existingPaths = new Set(existingTranscriptions.map((t) => t.filePath))

    return scanDirectory(dirPath, existingPaths, recursive)
  }
)

ipcMain.handle(
  'media:estimateTime',
  async (
    _event,
    durationSeconds: number,
    modelSize: string,
    enableDiarization: boolean
  ) => {
    return estimateTranscriptionTime(durationSeconds, modelSize, enableDiarization)
  }
)

// ============ App Info IPC Handlers ============

ipcMain.handle('app:getVersion', () => {
  return app.getVersion()
})

ipcMain.handle('app:getPlatform', () => {
  return process.platform
})

// ============ FFmpeg IPC Handlers ============

ipcMain.handle('ffmpeg:check', async () => {
  return await getFFmpegStatus(true) // Force check
})

ipcMain.handle('ffmpeg:promptInstall', async () => {
  return await promptFFmpegInstall(mainWindow)
})

ipcMain.handle('ffmpeg:install', async (event) => {
  const result = await installFFmpeg(mainWindow, (message) => {
    event.sender.send('ffmpeg:installProgress', { message })
  })

  // Clear cache so next check is fresh
  if (result.success) {
    clearFFmpegCache()
  }

  return result
})

ipcMain.handle('ffmpeg:showManualInstructions', async () => {
  await showManualInstructions(mainWindow)
})

// ============ WhisperX Transcription IPC Handlers ============
// WhisperX provides word-level timestamps and built-in speaker diarization

ipcMain.handle(
  'transcribe:start',
  async (
    event,
    filePath: string,
    options?: {
      language?: string
      modelSize?: string
      enableDiarization?: boolean
      numSpeakers?: number
      projectId?: string
    }
  ) => {
    // Redirect to WhisperX - this maintains backward compatibility
    const whisperX = getWhisperXTranscriberService()
    const db = getDatabaseService()

    // Get file info
    const path = await import('path')
    const fs = await import('fs')
    const fileName = path.basename(filePath)
    let fileSize: number | undefined

    try {
      const stats = fs.statSync(filePath)
      fileSize = stats.size
    } catch {
      // File size is optional
    }

    // Create transcription record in database (pending status)
    const transcriptionRecord = await db.createTranscription({
      filePath,
      fileName,
      fileSize,
      projectId: options?.projectId,
      language: options?.language,
      modelUsed: `whisperx-${options?.modelSize || 'base'}`
    })

    // Send the transcription ID immediately so UI can track it
    event.sender.send('transcribe:created', {
      id: transcriptionRecord.id,
      fileName,
      status: 'pending'
    })

    try {
      // Update status to processing
      db.updateTranscription(transcriptionRecord.id, { status: 'processing' })
      event.sender.send('transcribe:status', {
        id: transcriptionRecord.id,
        status: 'processing'
      })

      // Send progress updates to renderer
      const sendProgress = (progress: { percent: number; stage: string; message?: string }) => {
        event.sender.send('transcribe:progress', {
          id: transcriptionRecord.id,
          percent: progress.percent,
          currentTime: 0,
          totalTime: 0,
          stage: progress.stage,
          stageLabel: progress.message || progress.stage
        })
      }

      // Transcribe with WhisperX (includes word-level timestamps and optional diarization)
      console.log('[Main] Starting WhisperX transcription...')
      const result = await whisperX.transcribe(filePath, {
        language: options?.language,
        modelSize: (options?.modelSize || 'base') as 'tiny' | 'base' | 'small' | 'medium' | 'large',
        enableDiarization: options?.enableDiarization ?? true,
        numSpeakers: options?.numSpeakers,
        onProgress: sendProgress
      })

      console.log('[Main] WhisperX transcription complete:', {
        segmentCount: result.segments.length,
        language: result.language,
        duration: result.duration,
        speakerCount: result.speakers.length
      })

      // Format segments for database (WhisperX already has speaker labels)
      const segmentsData = result.segments.map((seg) => ({
        speakerId: seg.speaker || undefined,
        startTime: seg.start,
        endTime: seg.end,
        text: seg.text
      }))

      // Save segments to database
      db.saveSegments(transcriptionRecord.id, segmentsData)

      // Save speakers if diarization was enabled
      if (result.speakers.length > 0) {
        const speakersData = result.speakers.map((speakerId, index) => ({
          speakerId,
          displayName: `Speaker ${index + 1}`
        }))
        console.log('[Main] Saving speakers:', speakersData)
        await db.saveSpeakers(transcriptionRecord.id, speakersData)
      }

      // Update transcription record with completion info
      const completedAt = new Date().toISOString()
      db.updateTranscription(transcriptionRecord.id, {
        status: 'completed',
        duration: result.duration,
        language: result.language,
        completedAt
      })

      // Send completion event
      event.sender.send('transcribe:completed', {
        id: transcriptionRecord.id,
        status: 'completed',
        duration: result.duration,
        segmentCount: result.segments.length,
        speakerCount: result.speakers.length
      })

      return {
        id: transcriptionRecord.id,
        segments: result.segments,
        language: result.language,
        duration: result.duration,
        speakers: result.speakers
      }
    } catch (error) {
      console.error('[Main] WhisperX transcription failed:', error)

      // Update database with error status
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      db.updateTranscription(transcriptionRecord.id, {
        status: 'failed',
        error: errorMessage
      })

      // Send error event
      event.sender.send('transcribe:failed', {
        id: transcriptionRecord.id,
        status: 'failed',
        error: errorMessage
      })

      throw error
    }
  }
)

// Alias for transcribe:whisperx (used by renderer's whisperx API)
ipcMain.handle(
  'transcribe:whisperx',
  async (
    event,
    filePath: string,
    options?: {
      language?: string
      modelSize?: string
      enableDiarization?: boolean
      numSpeakers?: number
      projectId?: string
    }
  ) => {
    // This is the same as transcribe:start - WhisperX is now the only engine
    const whisperX = getWhisperXTranscriberService()
    const db = getDatabaseService()

    // Get file info
    const path = await import('path')
    const fs = await import('fs')
    const fileName = path.basename(filePath)
    let fileSize: number | undefined

    try {
      const stats = fs.statSync(filePath)
      fileSize = stats.size
    } catch {
      // File size is optional
    }

    // Create transcription record in database (pending status)
    const transcriptionRecord = await db.createTranscription({
      filePath,
      fileName,
      fileSize,
      projectId: options?.projectId,
      language: options?.language,
      modelUsed: `whisperx-${options?.modelSize || 'base'}`
    })

    // Send the transcription ID immediately so UI can track it
    event.sender.send('transcribe:created', {
      id: transcriptionRecord.id,
      fileName,
      status: 'pending'
    })

    try {
      // Update status to processing
      db.updateTranscription(transcriptionRecord.id, { status: 'processing' })
      event.sender.send('transcribe:status', {
        id: transcriptionRecord.id,
        status: 'processing'
      })

      // Send progress updates to renderer
      const sendProgress = (progress: { percent: number; stage: string; message?: string }) => {
        event.sender.send('transcribe:progress', {
          id: transcriptionRecord.id,
          percent: progress.percent,
          currentTime: 0,
          totalTime: 0,
          stage: progress.stage,
          stageLabel: progress.message || progress.stage
        })
      }

      // Transcribe with WhisperX (includes word-level timestamps and optional diarization)
      console.log('[Main] Starting WhisperX transcription...')
      const result = await whisperX.transcribe(filePath, {
        language: options?.language,
        modelSize: (options?.modelSize || 'base') as 'tiny' | 'base' | 'small' | 'medium' | 'large',
        enableDiarization: options?.enableDiarization ?? true,
        numSpeakers: options?.numSpeakers,
        onProgress: sendProgress
      })

      console.log('[Main] WhisperX transcription complete:', {
        segmentCount: result.segments.length,
        language: result.language,
        duration: result.duration,
        speakerCount: result.speakers.length
      })

      // Format segments for database (WhisperX already has speaker labels)
      const segmentsData = result.segments.map((seg) => ({
        speakerId: seg.speaker || undefined,
        startTime: seg.start,
        endTime: seg.end,
        text: seg.text
      }))

      // Save segments to database
      db.saveSegments(transcriptionRecord.id, segmentsData)

      // Save speakers if diarization was enabled
      if (result.speakers.length > 0) {
        const speakersData = result.speakers.map((speakerId, index) => ({
          speakerId,
          displayName: `Speaker ${index + 1}`
        }))
        console.log('[Main] Saving speakers:', speakersData)
        await db.saveSpeakers(transcriptionRecord.id, speakersData)
      }

      // Update transcription record with completion info
      const completedAt = new Date().toISOString()
      db.updateTranscription(transcriptionRecord.id, {
        status: 'completed',
        duration: result.duration,
        language: result.language,
        completedAt
      })

      // Send completion event
      event.sender.send('transcribe:completed', {
        id: transcriptionRecord.id,
        status: 'completed',
        duration: result.duration,
        segmentCount: result.segments.length,
        speakerCount: result.speakers.length
      })

      return {
        id: transcriptionRecord.id,
        segments: result.segments,
        language: result.language,
        duration: result.duration,
        speakers: result.speakers
      }
    } catch (error) {
      console.error('[Main] WhisperX transcription failed:', error)

      // Update database with error status
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      db.updateTranscription(transcriptionRecord.id, {
        status: 'failed',
        error: errorMessage
      })

      // Send error event
      event.sender.send('transcribe:failed', {
        id: transcriptionRecord.id,
        status: 'failed',
        error: errorMessage
      })

      throw error
    }
  }
)

// Cancel transcription
ipcMain.handle('transcribe:cancel', async (event, transcriptionId: string) => {
  const whisperX = getWhisperXTranscriberService()
  const db = getDatabaseService()

  try {
    whisperX.cancelCurrentTranscription()

    // Update database status to cancelled
    db.updateTranscription(transcriptionId, { status: 'cancelled' })

    // Notify renderer
    event.sender.send('transcribe:cancelled', { id: transcriptionId })

    return { success: true }
  } catch (error) {
    console.error('[Main] Failed to cancel transcription:', error)
    throw error
  }
})

// Get available WhisperX models
ipcMain.handle('whisperx:getModels', () => {
  const whisperX = getWhisperXTranscriberService()
  return whisperX.getAvailableModels()
})

// Check WhisperX model status
ipcMain.handle('whisperx:isReady', () => {
  const whisperX = getWhisperXTranscriberService()
  return whisperX.isModelLoaded()
})

// Load WhisperX model
ipcMain.handle('whisperx:loadModel', async (_event, modelSize: string, language?: string) => {
  const whisperX = getWhisperXTranscriberService()
  return whisperX.loadModel(
    modelSize as 'tiny' | 'base' | 'small' | 'medium' | 'large',
    language
  )
})

// ============ Database IPC Handlers ============

// Projects
ipcMain.handle('db:projects:list', () => {
  const db = getDatabaseService()
  return db.getProjects()
})

ipcMain.handle('db:projects:get', (_event, id: string) => {
  const db = getDatabaseService()
  return db.getProject(id)
})

ipcMain.handle('db:projects:create', async (_event, data: CreateProjectData) => {
  const db = getDatabaseService()
  return await db.createProject(data)
})

ipcMain.handle('db:projects:update', (_event, id: string, data: UpdateProjectData) => {
  const db = getDatabaseService()
  return db.updateProject(id, data)
})

ipcMain.handle('db:projects:delete', (_event, id: string) => {
  const db = getDatabaseService()
  return db.deleteProject(id)
})

// Transcriptions
ipcMain.handle('db:transcriptions:list', (_event, filters?: TranscriptionFilters) => {
  const db = getDatabaseService()
  return db.getTranscriptions(filters)
})

ipcMain.handle('db:transcriptions:get', (_event, id: string) => {
  const db = getDatabaseService()
  return db.getTranscription(id)
})

ipcMain.handle('db:transcriptions:create', async (_event, data: CreateTranscriptionData) => {
  const db = getDatabaseService()
  return await db.createTranscription(data)
})

ipcMain.handle('db:transcriptions:update', (_event, id: string, data: UpdateTranscriptionData) => {
  const db = getDatabaseService()
  return db.updateTranscription(id, data)
})

ipcMain.handle('db:transcriptions:delete', (_event, id: string) => {
  const db = getDatabaseService()
  return db.deleteTranscription(id)
})

ipcMain.handle('db:transcriptions:recent', (_event, limit?: number) => {
  const db = getDatabaseService()
  return db.getRecentTranscriptions(limit)
})

ipcMain.handle('db:transcriptions:search', (_event, query: string, limit?: number) => {
  const db = getDatabaseService()
  return db.searchTranscriptions(query, limit)
})

// Queue (Pending Transcriptions)
ipcMain.handle('db:transcriptions:createPending', async (_event, data: CreatePendingTranscriptionData) => {
  const db = getDatabaseService()
  return await db.createPendingTranscription(data)
})

ipcMain.handle('db:transcriptions:getPending', () => {
  const db = getDatabaseService()
  return db.getPendingTranscriptions()
})

ipcMain.handle('db:transcriptions:recoverInterrupted', () => {
  const db = getDatabaseService()
  return db.recoverInterruptedTranscriptions()
})

// Segments
ipcMain.handle('db:segments:get', (_event, transcriptionId: string) => {
  const db = getDatabaseService()
  return db.getSegments(transcriptionId)
})

ipcMain.handle('db:segments:save', (_event, transcriptionId: string, segments: CreateSegmentData[]) => {
  const db = getDatabaseService()
  db.saveSegments(transcriptionId, segments)
  return true
})

// Speakers
ipcMain.handle('db:speakers:get', (_event, transcriptionId: string) => {
  const db = getDatabaseService()
  return db.getSpeakers(transcriptionId)
})

ipcMain.handle('db:speakers:save', async (_event, transcriptionId: string, speakers: CreateSpeakerData[]) => {
  const db = getDatabaseService()
  await db.saveSpeakers(transcriptionId, speakers)
  return true
})

ipcMain.handle('db:speakers:rename', (_event, transcriptionId: string, speakerId: string, displayName: string) => {
  const db = getDatabaseService()
  db.renameSpeaker(transcriptionId, speakerId, displayName)
  return true
})

// Tags
ipcMain.handle('db:tags:list', () => {
  const db = getDatabaseService()
  return db.getTags()
})

ipcMain.handle('db:tags:create', async (_event, name: string, color?: string) => {
  const db = getDatabaseService()
  return await db.createTag(name, color)
})

ipcMain.handle('db:tags:delete', (_event, id: string) => {
  const db = getDatabaseService()
  return db.deleteTag(id)
})

ipcMain.handle('db:tags:addToTranscription', (_event, transcriptionId: string, tagId: string) => {
  const db = getDatabaseService()
  db.addTagToTranscription(transcriptionId, tagId)
  return true
})

ipcMain.handle('db:tags:removeFromTranscription', (_event, transcriptionId: string, tagId: string) => {
  const db = getDatabaseService()
  db.removeTagFromTranscription(transcriptionId, tagId)
  return true
})

// Settings
ipcMain.handle('db:settings:get', (_event, key: string) => {
  const db = getDatabaseService()
  return db.getSetting(key)
})

ipcMain.handle('db:settings:set', (_event, key: string, value: string) => {
  const db = getDatabaseService()
  db.setSetting(key, value)
  return true
})

// ============ Export IPC Handlers ============

ipcMain.handle(
  'export:transcription',
  async (
    _event,
    transcriptionId: string,
    format: ExportFormat
  ): Promise<{ content: string; mimeType: string; extension: string }> => {
    const db = getDatabaseService()
    const exporter = getExporterService()

    // Get transcription data
    const transcription = db.getTranscription(transcriptionId)
    if (!transcription) {
      throw new Error('Transcription not found')
    }

    const segments = db.getSegments(transcriptionId)
    const speakers = db.getSpeakers(transcriptionId)

    // DEBUG: Log export data
    console.log('[Main] Export data:', {
      format,
      segmentCount: segments.length,
      withSpeakerId: segments.filter((s) => s.speakerId).length,
      speakerCount: speakers.length,
      speakers: speakers,
      sampleSegments: segments.slice(0, 3)
    })

    // Export
    const result = await exporter.export(format, transcription, segments, speakers)

    // Convert Buffer to base64 string for DOCX
    if (result.content instanceof Buffer) {
      return {
        content: result.content.toString('base64'),
        mimeType: result.mimeType,
        extension: result.extension
      }
    }

    return result as { content: string; mimeType: string; extension: string }
  }
)

ipcMain.handle(
  'export:save',
  async (
    _event,
    transcriptionId: string,
    format: ExportFormat
  ): Promise<string | null> => {
    const db = getDatabaseService()
    const exporter = getExporterService()

    // Get transcription data
    const transcription = db.getTranscription(transcriptionId)
    if (!transcription) {
      throw new Error('Transcription not found')
    }

    const segments = db.getSegments(transcriptionId)
    const speakers = db.getSpeakers(transcriptionId)

    // Export
    const result = await exporter.export(format, transcription, segments, speakers)

    // Generate default filename
    const baseName = transcription.fileName.replace(/\.[^/.]+$/, '')
    const defaultPath = `${baseName}.${result.extension}`

    // Show save dialog
    const { filePath } = await dialog.showSaveDialog({
      defaultPath,
      filters: [
        {
          name: format.toUpperCase(),
          extensions: [result.extension]
        }
      ]
    })

    if (!filePath) {
      return null // User cancelled
    }

    // Write file
    const fs = await import('fs')
    if (result.content instanceof Buffer) {
      fs.writeFileSync(filePath, result.content)
    } else {
      fs.writeFileSync(filePath, result.content, 'utf-8')
    }

    return filePath
  }
)

// Export entire project (all transcriptions)
ipcMain.handle(
  'export:project',
  async (
    _event,
    projectId: string,
    format: ExportFormat
  ): Promise<{ exportDir: string; count: number } | null> => {
    const db = getDatabaseService()
    const exporter = getExporterService()

    // Get project
    const project = db.getProject(projectId)
    if (!project) {
      throw new Error('Project not found')
    }

    // Get all completed transcriptions in the project
    const transcriptions = db.getTranscriptions({ projectId, status: 'completed' })
    if (transcriptions.length === 0) {
      throw new Error('No completed transcriptions in project')
    }

    // Show directory picker dialog
    const { filePaths, canceled } = await dialog.showOpenDialog({
      title: `Select folder to export ${transcriptions.length} transcription(s)`,
      properties: ['openDirectory', 'createDirectory']
    })

    if (canceled || !filePaths[0]) {
      return null
    }

    const exportDir = filePaths[0]
    const exportedFiles: string[] = []
    const fs = await import('fs')
    const path = await import('path')

    for (const transcription of transcriptions) {
      const segments = db.getSegments(transcription.id)
      const speakers = db.getSpeakers(transcription.id)

      // Export
      const result = await exporter.export(format, transcription, segments, speakers)

      // Generate filename
      const baseName = transcription.fileName.replace(/\.[^/.]+$/, '')
      const filename = `${baseName}.${result.extension}`
      const filePath = path.join(exportDir, filename)

      // Write file
      if (result.content instanceof Buffer) {
        fs.writeFileSync(filePath, result.content)
      } else {
        fs.writeFileSync(filePath, result.content, 'utf-8')
      }

      exportedFiles.push(filePath)
    }

    return { exportDir, count: exportedFiles.length }
  }
)

// ============ App Lifecycle ============

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.xscribe.app')

  // Initialize database
  console.log('[Main] Initializing database...')
  const db = getDatabaseService()
  console.log(`[Main] Database initialized at: ${db.getDbPath()}`)

  // Recover any interrupted transcriptions (mark as failed)
  const recoveredCount = db.recoverInterruptedTranscriptions()
  if (recoveredCount > 0) {
    console.log(`[Main] Recovered ${recoveredCount} interrupted transcription(s)`)
  }

  // Default open or close DevTools by F12 in development
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('will-quit', () => {
  // Close database connection
  console.log('[Main] Closing database...')
  closeDatabaseService()
})
