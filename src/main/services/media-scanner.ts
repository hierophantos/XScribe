/**
 * Media Scanner Service
 *
 * Scans directories for supported audio/video files and retrieves metadata.
 */

import { readdirSync, statSync } from 'fs'
import { join, extname, basename } from 'path'
import { execSync } from 'child_process'

// Supported media formats
const AUDIO_EXTENSIONS = new Set([
  '.wav',
  '.mp3',
  '.m4a',
  '.flac',
  '.ogg',
  '.aac',
  '.wma'
])

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.webm', '.mov', '.avi', '.wmv'])

const ALL_MEDIA_EXTENSIONS = new Set([...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS])

export interface ScannedFile {
  path: string
  name: string
  size: number
  duration: number | null // Duration in seconds, null if couldn't be determined
  isVideo: boolean
  alreadyTranscribed: boolean
}

export interface ScanResult {
  files: ScannedFile[]
  totalCount: number
  totalDuration: number // Total duration of files with known duration
  errors: string[]
}

/**
 * Check if a file extension is a supported media format
 */
export function isSupportedMedia(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return ALL_MEDIA_EXTENSIONS.has(ext)
}

/**
 * Check if a file is a video format
 */
export function isVideoFile(filePath: string): boolean {
  const ext = extname(filePath).toLowerCase()
  return VIDEO_EXTENSIONS.has(ext)
}

/**
 * Get the duration of a media file using ffprobe
 * Returns duration in seconds, or null if it couldn't be determined
 */
export function getMediaDuration(filePath: string): number | null {
  try {
    // Use ffprobe to get duration
    // Try bundled ffprobe first, then system ffprobe
    const ffprobePaths = ['ffprobe', '/usr/local/bin/ffprobe', '/opt/homebrew/bin/ffprobe']

    for (const ffprobe of ffprobePaths) {
      try {
        const result = execSync(
          `${ffprobe} -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
          { encoding: 'utf-8', timeout: 10000 }
        )
        const duration = parseFloat(result.trim())
        if (!isNaN(duration) && duration > 0) {
          return duration
        }
      } catch {
        // Try next ffprobe path
        continue
      }
    }
    return null
  } catch {
    return null
  }
}

/**
 * Scan a directory for media files
 * @param dirPath - Directory to scan
 * @param existingFilePaths - Set of file paths that already have transcriptions
 * @param recursive - Whether to scan subdirectories (default: false)
 */
export function scanDirectory(
  dirPath: string,
  existingFilePaths: Set<string> = new Set(),
  recursive: boolean = false
): ScanResult {
  const files: ScannedFile[] = []
  const errors: string[] = []
  let totalDuration = 0

  function scanDir(currentPath: string): void {
    try {
      const entries = readdirSync(currentPath, { withFileTypes: true })

      for (const entry of entries) {
        const fullPath = join(currentPath, entry.name)

        // Skip hidden files and directories
        if (entry.name.startsWith('.')) {
          continue
        }

        if (entry.isDirectory()) {
          // Only recurse into subdirectory if recursive is enabled
          if (recursive) {
            scanDir(fullPath)
          }
        } else if (entry.isFile()) {
          // Check if it's a supported media file
          if (isSupportedMedia(fullPath)) {
            try {
              const stats = statSync(fullPath)
              const duration = getMediaDuration(fullPath)
              const alreadyTranscribed = existingFilePaths.has(fullPath)

              files.push({
                path: fullPath,
                name: basename(fullPath),
                size: stats.size,
                duration,
                isVideo: isVideoFile(fullPath),
                alreadyTranscribed
              })

              if (duration !== null) {
                totalDuration += duration
              }
            } catch (err) {
              errors.push(`Error reading ${fullPath}: ${err}`)
            }
          }
        }
      }
    } catch (err) {
      errors.push(`Error scanning ${currentPath}: ${err}`)
    }
  }

  scanDir(dirPath)

  // Sort files by name
  files.sort((a, b) => a.name.localeCompare(b.name))

  return {
    files,
    totalCount: files.length,
    totalDuration,
    errors
  }
}

/**
 * Estimate transcription time based on audio duration and model
 *
 * Speed factors (approximate, based on typical CPU performance):
 * - tiny/tiny.en: 0.1x (10 min audio → ~1 min)
 * - base/base.en: 0.15x
 * - small/small.en: 0.25x
 * - medium/medium.en: 0.5x
 * - large-v3: 1.0x (real-time on CPU)
 *
 * Add +20% for diarization
 */
export function estimateTranscriptionTime(
  durationSeconds: number,
  modelSize: string,
  enableDiarization: boolean = true
): number {
  const speedFactors: Record<string, number> = {
    tiny: 0.1,
    'tiny.en': 0.1,
    base: 0.15,
    'base.en': 0.15,
    small: 0.25,
    'small.en': 0.25,
    medium: 0.5,
    'medium.en': 0.5,
    large: 1.0,
    'large-v2': 1.0,
    'large-v3': 1.0
  }

  const factor = speedFactors[modelSize] || 0.5 // Default to medium speed
  let estimatedTime = durationSeconds * factor

  // Add 20% for diarization
  if (enableDiarization) {
    estimatedTime *= 1.2
  }

  return Math.ceil(estimatedTime)
}

/**
 * Format duration in seconds to human-readable string
 */
export function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${Math.round(seconds)}s`
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    return secs > 0 ? `${mins}m ${secs}s` : `${mins}m`
  } else {
    const hours = Math.floor(seconds / 3600)
    const mins = Math.round((seconds % 3600) / 60)
    return mins > 0 ? `${hours}h ${mins}m` : `${hours}h`
  }
}
