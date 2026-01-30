/**
 * Database service - SQLite persistence layer
 */

import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'
import { existsSync, mkdirSync } from 'fs'
import { initializeSchema } from './schema'

// Lazy-loaded uuid (ESM-only package)
let uuid: typeof import('uuid') | null = null

async function getUuid() {
  if (!uuid) {
    uuid = await import('uuid')
  }
  return uuid
}
import type {
  Project,
  Tag,
  Transcription,
  Segment,
  Speaker,
  TranscriptionFilters,
  SearchResult,
  CreateProjectData,
  UpdateProjectData,
  CreateTranscriptionData,
  UpdateTranscriptionData,
  CreateSegmentData,
  CreateSpeakerData
} from './types'

export class DatabaseService {
  private db: Database.Database
  private dbPath: string

  constructor() {
    this.dbPath = this.getDatabasePath()
    this.db = this.initDatabase()
  }

  private getDatabasePath(): string {
    const userDataPath = app.getPath('userData')

    // Ensure directory exists
    if (!existsSync(userDataPath)) {
      mkdirSync(userDataPath, { recursive: true })
    }

    return join(userDataPath, 'xscribe.db')
  }

  private initDatabase(): Database.Database {
    console.log(`[Database] Opening database at: ${this.dbPath}`)

    const db = new Database(this.dbPath)

    // Performance optimizations
    db.pragma('journal_mode = WAL')
    db.pragma('synchronous = NORMAL')

    // Initialize schema
    initializeSchema(db)

    return db
  }

  // ============ Projects ============

  async createProject(data: CreateProjectData): Promise<Project> {
    const now = new Date().toISOString()
    const { v4: uuidv4 } = await getUuid()
    const project: Project = {
      id: uuidv4(),
      name: data.name,
      description: data.description || null,
      color: data.color || null,
      createdAt: now,
      updatedAt: now
    }

    const stmt = this.db.prepare(`
      INSERT INTO projects (id, name, description, color, createdAt, updatedAt)
      VALUES (@id, @name, @description, @color, @createdAt, @updatedAt)
    `)
    stmt.run(project)

    return project
  }

  getProject(id: string): Project | null {
    const stmt = this.db.prepare('SELECT * FROM projects WHERE id = ?')
    return stmt.get(id) as Project | undefined || null
  }

  getProjects(): Project[] {
    const stmt = this.db.prepare('SELECT * FROM projects ORDER BY name ASC')
    return stmt.all() as Project[]
  }

  updateProject(id: string, data: UpdateProjectData): Project | null {
    const existing = this.getProject(id)
    if (!existing) return null

    const updated: Project = {
      ...existing,
      ...data,
      updatedAt: new Date().toISOString()
    }

    const stmt = this.db.prepare(`
      UPDATE projects
      SET name = @name, description = @description, color = @color, updatedAt = @updatedAt
      WHERE id = @id
    `)
    stmt.run(updated)

    return updated
  }

  deleteProject(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM projects WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  // ============ Tags ============

  async createTag(name: string, color?: string): Promise<Tag> {
    const { v4: uuidv4 } = await getUuid()
    const tag: Tag = {
      id: uuidv4(),
      name,
      color: color || null
    }

    const stmt = this.db.prepare(`
      INSERT INTO tags (id, name, color) VALUES (@id, @name, @color)
    `)
    stmt.run(tag)

    return tag
  }

  getTags(): Tag[] {
    const stmt = this.db.prepare('SELECT * FROM tags ORDER BY name ASC')
    return stmt.all() as Tag[]
  }

  deleteTag(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM tags WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  addTagToTranscription(transcriptionId: string, tagId: string): void {
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO transcription_tags (transcriptionId, tagId)
      VALUES (?, ?)
    `)
    stmt.run(transcriptionId, tagId)
  }

  removeTagFromTranscription(transcriptionId: string, tagId: string): void {
    const stmt = this.db.prepare(`
      DELETE FROM transcription_tags WHERE transcriptionId = ? AND tagId = ?
    `)
    stmt.run(transcriptionId, tagId)
  }

  getTagsForTranscription(transcriptionId: string): Tag[] {
    const stmt = this.db.prepare(`
      SELECT t.* FROM tags t
      INNER JOIN transcription_tags tt ON t.id = tt.tagId
      WHERE tt.transcriptionId = ?
      ORDER BY t.name ASC
    `)
    return stmt.all(transcriptionId) as Tag[]
  }

  // ============ Transcriptions ============

  async createTranscription(data: CreateTranscriptionData): Promise<Transcription> {
    const now = new Date().toISOString()
    const { v4: uuidv4 } = await getUuid()
    const transcription: Transcription = {
      id: uuidv4(),
      projectId: data.projectId || null,
      filePath: data.filePath,
      fileName: data.fileName,
      fileSize: data.fileSize || null,
      duration: null,
      language: data.language || null,
      modelUsed: data.modelUsed || null,
      status: 'pending',
      error: null,
      createdAt: now,
      updatedAt: now,
      completedAt: null
    }

    const stmt = this.db.prepare(`
      INSERT INTO transcriptions
        (id, projectId, filePath, fileName, fileSize, duration, language, modelUsed, status, error, createdAt, updatedAt, completedAt)
      VALUES
        (@id, @projectId, @filePath, @fileName, @fileSize, @duration, @language, @modelUsed, @status, @error, @createdAt, @updatedAt, @completedAt)
    `)
    stmt.run(transcription)

    return transcription
  }

  getTranscription(id: string): Transcription | null {
    const stmt = this.db.prepare('SELECT * FROM transcriptions WHERE id = ?')
    const transcription = stmt.get(id) as Transcription | undefined

    if (transcription) {
      transcription.tags = this.getTagsForTranscription(id)
    }

    return transcription || null
  }

  getTranscriptions(filters?: TranscriptionFilters): Transcription[] {
    let query = 'SELECT * FROM transcriptions WHERE 1=1'
    const params: Record<string, unknown> = {}

    if (filters?.projectId !== undefined) {
      if (filters.projectId === null) {
        query += ' AND projectId IS NULL'
      } else {
        query += ' AND projectId = @projectId'
        params.projectId = filters.projectId
      }
    }

    if (filters?.status) {
      query += ' AND status = @status'
      params.status = filters.status
    }

    query += ' ORDER BY createdAt DESC'

    if (filters?.limit) {
      query += ' LIMIT @limit'
      params.limit = filters.limit
    }

    if (filters?.offset) {
      query += ' OFFSET @offset'
      params.offset = filters.offset
    }

    const stmt = this.db.prepare(query)
    const transcriptions = stmt.all(params) as Transcription[]

    // Fetch tags for each transcription
    for (const t of transcriptions) {
      t.tags = this.getTagsForTranscription(t.id)
    }

    // Filter by tags if specified
    if (filters?.tagIds && filters.tagIds.length > 0) {
      return transcriptions.filter((t) =>
        filters.tagIds!.some((tagId) => t.tags?.some((tag) => tag.id === tagId))
      )
    }

    return transcriptions
  }

  getRecentTranscriptions(limit: number = 10): Transcription[] {
    return this.getTranscriptions({ limit })
  }

  updateTranscription(id: string, data: UpdateTranscriptionData): Transcription | null {
    const existing = this.getTranscription(id)
    if (!existing) return null

    const fields: string[] = ['updatedAt = @updatedAt']
    const params: Record<string, unknown> = {
      id,
      updatedAt: new Date().toISOString()
    }

    if (data.projectId !== undefined) {
      fields.push('projectId = @projectId')
      params.projectId = data.projectId
    }
    if (data.status !== undefined) {
      fields.push('status = @status')
      params.status = data.status
    }
    if (data.duration !== undefined) {
      fields.push('duration = @duration')
      params.duration = data.duration
    }
    if (data.language !== undefined) {
      fields.push('language = @language')
      params.language = data.language
    }
    if (data.error !== undefined) {
      fields.push('error = @error')
      params.error = data.error
    }
    if (data.completedAt !== undefined) {
      fields.push('completedAt = @completedAt')
      params.completedAt = data.completedAt
    }

    const stmt = this.db.prepare(`
      UPDATE transcriptions SET ${fields.join(', ')} WHERE id = @id
    `)
    stmt.run(params)

    return this.getTranscription(id)
  }

  deleteTranscription(id: string): boolean {
    const stmt = this.db.prepare('DELETE FROM transcriptions WHERE id = ?')
    const result = stmt.run(id)
    return result.changes > 0
  }

  // ============ Segments ============

  saveSegments(transcriptionId: string, segments: CreateSegmentData[]): void {
    // Delete existing segments first
    const deleteStmt = this.db.prepare('DELETE FROM segments WHERE transcriptionId = ?')
    deleteStmt.run(transcriptionId)

    // Insert new segments
    const insertStmt = this.db.prepare(`
      INSERT INTO segments (transcriptionId, speakerId, startTime, endTime, text, confidence)
      VALUES (@transcriptionId, @speakerId, @startTime, @endTime, @text, @confidence)
    `)

    const insertMany = this.db.transaction((segs: CreateSegmentData[]) => {
      for (const seg of segs) {
        insertStmt.run({
          transcriptionId,
          speakerId: seg.speakerId || null,
          startTime: seg.startTime,
          endTime: seg.endTime,
          text: seg.text,
          confidence: seg.confidence || null
        })
      }
    })

    insertMany(segments)
  }

  getSegments(transcriptionId: string): Segment[] {
    const stmt = this.db.prepare(`
      SELECT * FROM segments WHERE transcriptionId = ? ORDER BY startTime ASC
    `)
    return stmt.all(transcriptionId) as Segment[]
  }

  // ============ Speakers ============

  async saveSpeakers(transcriptionId: string, speakers: CreateSpeakerData[]): Promise<void> {
    // Delete existing speakers first
    const deleteStmt = this.db.prepare('DELETE FROM speakers WHERE transcriptionId = ?')
    deleteStmt.run(transcriptionId)

    // Insert new speakers
    const insertStmt = this.db.prepare(`
      INSERT INTO speakers (id, transcriptionId, speakerId, displayName, color)
      VALUES (@id, @transcriptionId, @speakerId, @displayName, @color)
    `)

    const { v4: uuidv4 } = await getUuid()

    const insertMany = this.db.transaction((spkrs: CreateSpeakerData[]) => {
      for (const spkr of spkrs) {
        insertStmt.run({
          id: uuidv4(),
          transcriptionId,
          speakerId: spkr.speakerId,
          displayName: spkr.displayName || null,
          color: spkr.color || null
        })
      }
    })

    insertMany(speakers)
  }

  getSpeakers(transcriptionId: string): Speaker[] {
    const stmt = this.db.prepare(`
      SELECT * FROM speakers WHERE transcriptionId = ? ORDER BY speakerId ASC
    `)
    return stmt.all(transcriptionId) as Speaker[]
  }

  renameSpeaker(transcriptionId: string, speakerId: string, displayName: string): void {
    const stmt = this.db.prepare(`
      UPDATE speakers SET displayName = ? WHERE transcriptionId = ? AND speakerId = ?
    `)
    stmt.run(displayName, transcriptionId, speakerId)
  }

  // ============ Search ============

  searchTranscriptions(query: string, limit: number = 50): SearchResult[] {
    if (!query.trim()) return []

    // Search in full-text index
    const searchStmt = this.db.prepare(`
      SELECT s.*, highlight(segments_fts, 0, '<mark>', '</mark>') as highlight
      FROM segments_fts
      INNER JOIN segments s ON segments_fts.rowid = s.id
      WHERE segments_fts MATCH ?
      ORDER BY rank
      LIMIT ?
    `)

    const matchingSegments = searchStmt.all(query, limit) as Array<Segment & { highlight: string }>

    // Group by transcription
    const resultMap = new Map<string, SearchResult>()

    for (const seg of matchingSegments) {
      const transcriptionId = seg.transcriptionId

      if (!resultMap.has(transcriptionId)) {
        const transcription = this.getTranscription(transcriptionId)
        if (transcription) {
          resultMap.set(transcriptionId, {
            transcriptionId,
            transcription,
            matchingSegments: []
          })
        }
      }

      const result = resultMap.get(transcriptionId)
      if (result) {
        result.matchingSegments.push({
          segment: seg,
          highlight: seg.highlight
        })
      }
    }

    return Array.from(resultMap.values())
  }

  // ============ Settings ============

  getSetting(key: string): string | null {
    const stmt = this.db.prepare('SELECT value FROM settings WHERE key = ?')
    const result = stmt.get(key) as { value: string } | undefined
    return result?.value || null
  }

  setSetting(key: string, value: string): void {
    const stmt = this.db.prepare(`
      INSERT INTO settings (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `)
    stmt.run(key, value)
  }

  // ============ Lifecycle ============

  close(): void {
    this.db.close()
    console.log('[Database] Closed')
  }

  getDbPath(): string {
    return this.dbPath
  }
}

// Singleton instance
let dbInstance: DatabaseService | null = null

export function getDatabaseService(): DatabaseService {
  if (!dbInstance) {
    dbInstance = new DatabaseService()
  }
  return dbInstance
}

export function closeDatabaseService(): void {
  if (dbInstance) {
    dbInstance.close()
    dbInstance = null
  }
}

// Re-export types
export * from './types'
