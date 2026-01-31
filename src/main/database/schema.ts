/**
 * Database schema and migrations
 */

import type Database from 'better-sqlite3'

const SCHEMA_VERSION = 2

export function initializeSchema(db: Database.Database): void {
  // Enable foreign keys
  db.pragma('foreign_keys = ON')

  // Check current version
  const versionResult = db.pragma('user_version', { simple: true }) as number
  const currentVersion = versionResult || 0

  if (currentVersion < SCHEMA_VERSION) {
    console.log(`[Database] Migrating from version ${currentVersion} to ${SCHEMA_VERSION}`)
    migrate(db, currentVersion)
  }
}

function migrate(db: Database.Database, fromVersion: number): void {
  // Run migrations in a transaction
  db.transaction(() => {
    if (fromVersion < 1) {
      migrateToV1(db)
    }
    if (fromVersion < 2) {
      migrateToV2(db)
    }

    // Set new version
    db.pragma(`user_version = ${SCHEMA_VERSION}`)
  })()
}

function migrateToV1(db: Database.Database): void {
  console.log('[Database] Creating schema v1...')

  // Projects table
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      color TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `)

  // Tags table
  db.exec(`
    CREATE TABLE IF NOT EXISTS tags (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT
    )
  `)

  // Transcriptions table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcriptions (
      id TEXT PRIMARY KEY,
      projectId TEXT,
      filePath TEXT NOT NULL,
      fileName TEXT NOT NULL,
      fileSize INTEGER,
      duration REAL,
      language TEXT,
      modelUsed TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      completedAt TEXT,
      FOREIGN KEY (projectId) REFERENCES projects(id) ON DELETE SET NULL
    )
  `)

  // Transcription-Tags junction table
  db.exec(`
    CREATE TABLE IF NOT EXISTS transcription_tags (
      transcriptionId TEXT NOT NULL,
      tagId TEXT NOT NULL,
      PRIMARY KEY (transcriptionId, tagId),
      FOREIGN KEY (transcriptionId) REFERENCES transcriptions(id) ON DELETE CASCADE,
      FOREIGN KEY (tagId) REFERENCES tags(id) ON DELETE CASCADE
    )
  `)

  // Segments table
  db.exec(`
    CREATE TABLE IF NOT EXISTS segments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      transcriptionId TEXT NOT NULL,
      speakerId TEXT,
      startTime REAL NOT NULL,
      endTime REAL NOT NULL,
      text TEXT NOT NULL,
      confidence REAL,
      FOREIGN KEY (transcriptionId) REFERENCES transcriptions(id) ON DELETE CASCADE
    )
  `)

  // Speakers table
  db.exec(`
    CREATE TABLE IF NOT EXISTS speakers (
      id TEXT PRIMARY KEY,
      transcriptionId TEXT NOT NULL,
      speakerId TEXT NOT NULL,
      displayName TEXT,
      color TEXT,
      FOREIGN KEY (transcriptionId) REFERENCES transcriptions(id) ON DELETE CASCADE,
      UNIQUE(transcriptionId, speakerId)
    )
  `)

  // Settings table
  db.exec(`
    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `)

  // Full-text search for segments
  db.exec(`
    CREATE VIRTUAL TABLE IF NOT EXISTS segments_fts USING fts5(
      text,
      content='segments',
      content_rowid='id'
    )
  `)

  // Triggers to keep FTS in sync
  db.exec(`
    CREATE TRIGGER IF NOT EXISTS segments_ai AFTER INSERT ON segments BEGIN
      INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
    END
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS segments_ad AFTER DELETE ON segments BEGIN
      INSERT INTO segments_fts(segments_fts, rowid, text) VALUES('delete', old.id, old.text);
    END
  `)

  db.exec(`
    CREATE TRIGGER IF NOT EXISTS segments_au AFTER UPDATE ON segments BEGIN
      INSERT INTO segments_fts(segments_fts, rowid, text) VALUES('delete', old.id, old.text);
      INSERT INTO segments_fts(rowid, text) VALUES (new.id, new.text);
    END
  `)

  // Indexes
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_transcriptions_project ON transcriptions(projectId);
    CREATE INDEX IF NOT EXISTS idx_transcriptions_status ON transcriptions(status);
    CREATE INDEX IF NOT EXISTS idx_transcriptions_created ON transcriptions(createdAt DESC);
    CREATE INDEX IF NOT EXISTS idx_segments_transcription ON segments(transcriptionId);
    CREATE INDEX IF NOT EXISTS idx_speakers_transcription ON speakers(transcriptionId);
  `)

  console.log('[Database] Schema v1 created successfully')
}

function migrateToV2(db: Database.Database): void {
  console.log('[Database] Migrating to schema v2...')

  // Add queue metadata columns to transcriptions table
  // These store the model and diarization settings for pending queue items
  db.exec(`
    ALTER TABLE transcriptions ADD COLUMN queueModel TEXT;
  `)

  db.exec(`
    ALTER TABLE transcriptions ADD COLUMN queueDiarization INTEGER DEFAULT 1;
  `)

  console.log('[Database] Schema v2 migration complete')
}
