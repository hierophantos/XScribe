import { app, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'

/**
 * Centralized logging service for XScribe.
 * Writes to ~/.xscribe/logs/debug.log (or %APPDATA%/xscribe/logs/ on Windows)
 * with automatic log rotation.
 */
class LoggerService {
  private logPath: string
  private logDir: string
  private maxSize = 5 * 1024 * 1024 // 5MB
  private initialized = false

  constructor() {
    // Will be set during initialize() when app is ready
    this.logDir = ''
    this.logPath = ''
  }

  /**
   * Initialize the logger. Must be called after app is ready.
   */
  initialize(): void {
    if (this.initialized) return

    this.logDir = path.join(app.getPath('userData'), 'logs')
    fs.mkdirSync(this.logDir, { recursive: true })
    this.logPath = path.join(this.logDir, 'debug.log')
    this.initialized = true

    // Log startup
    this.log('Logger', 'Debug logging initialized', {
      logPath: this.logPath,
      platform: process.platform,
      appVersion: app.getVersion()
    })
  }

  /**
   * Log a message with timestamp and source
   */
  log(source: string, message: string, data?: unknown): void {
    if (!this.initialized) {
      console.log(`[${source}] ${message}`, data || '')
      return
    }

    const timestamp = new Date().toISOString()
    let line = `[${timestamp}] [${source}] ${message}`
    if (data !== undefined) {
      try {
        line += ' ' + JSON.stringify(data)
      } catch {
        line += ' [unserializable data]'
      }
    }
    line += '\n'

    try {
      fs.appendFileSync(this.logPath, line)
      this.rotateIfNeeded()
    } catch (err) {
      console.error('Failed to write to log file:', err)
    }

    // Also log to console in development
    if (process.env.NODE_ENV === 'development' || !app.isPackaged) {
      console.log(line.trim())
    }
  }

  /**
   * Log an error with stack trace
   */
  error(source: string, message: string, error?: Error | unknown): void {
    let errorData: unknown = undefined
    if (error instanceof Error) {
      errorData = {
        name: error.name,
        message: error.message,
        stack: error.stack
      }
    } else if (error !== undefined) {
      errorData = error
    }
    this.log(source, `ERROR: ${message}`, errorData)
  }

  /**
   * Get the path to the log file
   */
  getPath(): string {
    return this.logPath
  }

  /**
   * Get the path to the logs directory
   */
  getDir(): string {
    return this.logDir
  }

  /**
   * Read the entire log file contents
   */
  getContents(): string {
    if (!this.initialized || !fs.existsSync(this.logPath)) {
      return ''
    }
    try {
      return fs.readFileSync(this.logPath, 'utf-8')
    } catch (err) {
      console.error('Failed to read log file:', err)
      return ''
    }
  }

  /**
   * Get the last N lines of the log file
   */
  getTail(lines: number = 100): string {
    const contents = this.getContents()
    if (!contents) return ''
    const allLines = contents.split('\n')
    return allLines.slice(-lines).join('\n')
  }

  /**
   * Clear the log file
   */
  clear(): void {
    if (!this.initialized) return
    try {
      fs.writeFileSync(this.logPath, '')
      this.log('Logger', 'Log file cleared')
    } catch (err) {
      console.error('Failed to clear log file:', err)
    }
  }

  /**
   * Open the logs directory in the system file explorer
   */
  openInExplorer(): void {
    if (!this.initialized) return
    shell.openPath(this.logDir)
  }

  /**
   * Rotate the log file if it exceeds maxSize
   * Keeps the last half of the file
   */
  private rotateIfNeeded(): void {
    try {
      const stats = fs.statSync(this.logPath)
      if (stats.size > this.maxSize) {
        const contents = fs.readFileSync(this.logPath, 'utf-8')
        const lines = contents.split('\n')
        // Keep the last half of lines
        const keepLines = lines.slice(Math.floor(lines.length / 2))
        fs.writeFileSync(this.logPath, keepLines.join('\n'))
        this.log('Logger', 'Log file rotated', {
          previousSize: stats.size,
          newSize: keepLines.join('\n').length
        })
      }
    } catch {
      // Ignore rotation errors
    }
  }
}

// Export singleton instance
export const logger = new LoggerService()
