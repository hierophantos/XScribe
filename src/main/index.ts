import { app, BrowserWindow, ipcMain, dialog } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { getTranscriberService } from './services/transcriber'
import { getDiarizerService, mergeTranscriptionWithDiarization } from './services/diarizer'
import { getDatabaseService, closeDatabaseService } from './database'
import { getExporterService, ExportFormat } from './services/exporter'
import {
  checkFFmpeg,
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
  CreateSpeakerData
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

// ============ Transcription IPC Handlers ============

ipcMain.handle(
  'transcribe:start',
  async (
    event,
    filePath: string,
    options?: {
      language?: string
      model?: string
      useDiarization?: boolean
      projectId?: string
    }
  ) => {
    const transcriber = getTranscriberService()
    const diarizer = getDiarizerService()
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
      modelUsed: options?.model || 'base'
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
      const sendProgress = (progress: { percent: number; currentTime: number; totalTime: number }) => {
        event.sender.send('transcribe:progress', {
          id: transcriptionRecord.id,
          ...progress
        })
      }

      // Send partial results for streaming display
      const partialResultHandler = (data: {
        segments: Array<{ start: number; end: number; text: string }>
        text: string
        duration: number
      }) => {
        event.sender.send('transcribe:partial', {
          id: transcriptionRecord.id,
          segments: data.segments,
          text: data.text,
          duration: data.duration
        })
      }
      transcriber.on('partialResult', partialResultHandler)

      // Transcribe the audio
      let transcription
      try {
        transcription = await transcriber.transcribe(filePath, {
          language: options?.language,
          onProgress: sendProgress
        })
      } finally {
        // Remove the partial result listener
        transcriber.off('partialResult', partialResultHandler)
      }

      let finalSegments = transcription.segments

      // If diarization is requested, identify speakers
      if (options?.useDiarization) {
        try {
          const diarization = await diarizer.diarize(filePath)

          // Merge transcription with speaker labels
          finalSegments = mergeTranscriptionWithDiarization(
            transcription.segments,
            diarization
          )

          // Save speakers to database
          const uniqueSpeakers = [...new Set(diarization.speakers)]
          const speakersData = uniqueSpeakers.map((speakerId, index) => ({
            speakerId,
            displayName: `Speaker ${index + 1}`
          }))
          await db.saveSpeakers(transcriptionRecord.id, speakersData)
        } catch (diarizationError) {
          console.warn('[Main] Diarization failed, continuing without speaker labels:', diarizationError)
        }
      }

      // Save segments to database
      const segmentsData = finalSegments.map((seg) => ({
        speakerId: seg.speaker || undefined,
        startTime: seg.start,
        endTime: seg.end,
        text: seg.text
      }))
      db.saveSegments(transcriptionRecord.id, segmentsData)

      // Update transcription record with completion info
      const completedAt = new Date().toISOString()
      db.updateTranscription(transcriptionRecord.id, {
        status: 'completed',
        duration: transcription.duration,
        language: transcription.language,
        completedAt
      })

      // Send completion event
      event.sender.send('transcribe:completed', {
        id: transcriptionRecord.id,
        status: 'completed',
        duration: transcription.duration,
        segmentCount: finalSegments.length
      })

      return {
        id: transcriptionRecord.id,
        ...transcription,
        segments: finalSegments
      }
    } catch (error) {
      console.error('[Main] Transcription failed:', error)

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
  const transcriber = getTranscriberService()
  const db = getDatabaseService()

  try {
    // Kill the worker process if it's running
    transcriber.cancelCurrentTranscription()

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

// ============ Diarization IPC Handlers ============

ipcMain.handle('diarize:start', async (event, filePath: string) => {
  const diarizer = getDiarizerService()

  try {
    const sendProgress = (progress: { percent: number; stage: string }) => {
      event.sender.send('diarize:progress', progress)
    }

    const result = await diarizer.diarize(filePath, {
      onProgress: sendProgress
    })

    return result
  } catch (error) {
    console.error('[Main] Diarization failed:', error)
    throw error
  }
})

// ============ Model Management IPC Handlers ============

ipcMain.handle('models:getDirectory', () => {
  const transcriber = getTranscriberService()
  return transcriber.getModelDirectory()
})

ipcMain.handle('models:getAvailable', () => {
  const transcriber = getTranscriberService()
  return transcriber.getAvailableModels()
})

ipcMain.handle('models:load', async (_event, modelName: string) => {
  const transcriber = getTranscriberService()
  return transcriber.loadModel(modelName)
})

ipcMain.handle('models:isReady', () => {
  const transcriber = getTranscriberService()
  return transcriber.isModelLoaded()
})

ipcMain.handle('models:download', async (event, modelName: string) => {
  const transcriber = getTranscriberService()
  return transcriber.downloadModel(modelName as 'tiny.en' | 'tiny' | 'base.en' | 'base' | 'small.en' | 'small', (progress) => {
    // Send progress updates to renderer
    event.sender.send('models:downloadProgress', { modelName, ...progress })
  })
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

// ============ App Lifecycle ============

app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.xscribe.app')

  // Initialize database
  console.log('[Main] Initializing database...')
  const db = getDatabaseService()
  console.log(`[Main] Database initialized at: ${db.getDbPath()}`)

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
