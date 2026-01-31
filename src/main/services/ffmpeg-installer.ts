/**
 * FFmpeg Installer Service
 *
 * Handles detection and installation of ffmpeg for different platforms.
 * Detection order:
 * 1. Bundled ffmpeg-static (ASAR-unpacked)
 * 2. Downloaded ffmpeg (in userData)
 * 3. System ffmpeg (in PATH)
 */

import { exec, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, createWriteStream, chmodSync } from 'fs'
import { rm } from 'fs/promises'
import { join } from 'path'
import { app, dialog, BrowserWindow } from 'electron'
import https from 'https'

const execAsync = promisify(exec)

// FFmpeg download URLs for runtime installation
interface FFmpegDownloadInfo {
  url: string
  binaryPath: string // Path to ffmpeg binary within the extracted archive
}

const FFMPEG_DOWNLOADS: Record<string, FFmpegDownloadInfo> = {
  win32: {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip',
    binaryPath: 'ffmpeg-master-latest-win64-gpl/bin/ffmpeg.exe'
  },
  darwin: {
    url: 'https://evermeet.cx/ffmpeg/getrelease/ffmpeg/zip',
    binaryPath: 'ffmpeg'
  },
  linux: {
    url: 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-linux64-gpl.tar.xz',
    binaryPath: 'ffmpeg-master-latest-linux64-gpl/bin/ffmpeg'
  }
}

interface FFmpegStatus {
  installed: boolean
  path?: string
  version?: string
  bundled?: boolean
}

/**
 * Get the path to the bundled ffmpeg binary from ffmpeg-static
 * Handles ASAR unpacking for packaged apps
 */
function getBundledFFmpegPath(): string | null {
  // For packaged apps, manually construct the path to the ASAR-unpacked binary
  // require('ffmpeg-static') returns a path inside the ASAR archive which doesn't work
  if (app.isPackaged) {
    const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
    const unpackedPath = join(
      process.resourcesPath,
      'app.asar.unpacked',
      'node_modules',
      'ffmpeg-static',
      binaryName
    )

    if (existsSync(unpackedPath)) {
      console.log('[FFmpeg] Found bundled ffmpeg at:', unpackedPath)
      return unpackedPath
    }
    console.log('[FFmpeg] Bundled ffmpeg not found at:', unpackedPath)
  }

  // Development: use ffmpeg-static directly
  try {
    const ffmpegStatic = require('ffmpeg-static')
    if (ffmpegStatic && existsSync(ffmpegStatic)) {
      console.log('[FFmpeg] Using ffmpeg-static:', ffmpegStatic)
      return ffmpegStatic
    }
  } catch {
    // ffmpeg-static not available
  }

  return null
}

/**
 * Get the path to downloaded ffmpeg in userData
 */
function getDownloadedFFmpegPath(): string | null {
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const downloadedPath = join(app.getPath('userData'), 'ffmpeg', binaryName)

  if (existsSync(downloadedPath)) {
    console.log('[FFmpeg] Found downloaded ffmpeg at:', downloadedPath)
    return downloadedPath
  }

  return null
}

/**
 * Verify ffmpeg works by running -version
 */
async function verifyFFmpeg(ffmpegPath: string): Promise<{ version: string } | null> {
  try {
    const { stdout } = await execAsync(`"${ffmpegPath}" -version`)
    const versionMatch = stdout.match(/ffmpeg version (\S+)/)
    const version = versionMatch ? versionMatch[1] : 'unknown'
    return { version }
  } catch {
    return null
  }
}

/**
 * Check if ffmpeg is installed and available
 * Detection order: bundled → downloaded → system
 */
export async function checkFFmpeg(): Promise<FFmpegStatus> {
  // Tier 1: Check for bundled ffmpeg (ASAR-unpacked)
  const bundledPath = getBundledFFmpegPath()
  if (bundledPath) {
    const result = await verifyFFmpeg(bundledPath)
    if (result) {
      return {
        installed: true,
        path: bundledPath,
        version: result.version,
        bundled: true
      }
    }
    console.log('[FFmpeg] Bundled ffmpeg verification failed')
  }

  // Tier 2: Check for downloaded ffmpeg in userData
  const downloadedPath = getDownloadedFFmpegPath()
  if (downloadedPath) {
    const result = await verifyFFmpeg(downloadedPath)
    if (result) {
      return {
        installed: true,
        path: downloadedPath,
        version: result.version,
        bundled: false // Downloaded, not bundled
      }
    }
    console.log('[FFmpeg] Downloaded ffmpeg verification failed')
  }

  // Tier 3: Fall back to system ffmpeg
  try {
    const { stdout } = await execAsync('ffmpeg -version')
    const versionMatch = stdout.match(/ffmpeg version (\S+)/)
    const version = versionMatch ? versionMatch[1] : 'unknown'

    // Get the path
    let ffmpegPath: string | undefined
    try {
      if (process.platform === 'win32') {
        const { stdout: wherePath } = await execAsync('where ffmpeg')
        ffmpegPath = wherePath.trim().split('\n')[0]
      } else {
        const { stdout: whichPath } = await execAsync('which ffmpeg')
        ffmpegPath = whichPath.trim()
      }
    } catch {
      // Path detection failed but ffmpeg works
    }

    return {
      installed: true,
      path: ffmpegPath,
      version,
      bundled: false
    }
  } catch {
    return { installed: false }
  }
}

/**
 * Get installation instructions for the current platform
 */
export function getInstallInstructions(): {
  platform: string
  method: string
  command?: string
  manualUrl?: string
} {
  switch (process.platform) {
    case 'darwin':
      return {
        platform: 'macOS',
        method: 'Homebrew',
        command: 'brew install ffmpeg',
        manualUrl: 'https://ffmpeg.org/download.html#build-mac'
      }
    case 'win32':
      return {
        platform: 'Windows',
        method: 'Automatic download',
        command: undefined, // We download automatically
        manualUrl: 'https://ffmpeg.org/download.html#build-windows'
      }
    case 'linux':
      return {
        platform: 'Linux',
        method: 'Package manager',
        command: 'sudo apt install ffmpeg  # or equivalent for your distro',
        manualUrl: 'https://ffmpeg.org/download.html#build-linux'
      }
    default:
      return {
        platform: process.platform,
        method: 'Manual installation',
        manualUrl: 'https://ffmpeg.org/download.html'
      }
  }
}

/**
 * Check if Homebrew is installed (macOS)
 */
async function checkHomebrew(): Promise<boolean> {
  try {
    await execAsync('which brew')
    return true
  } catch {
    return false
  }
}

/**
 * Check if winget is available (Windows)
 */
async function checkWinget(): Promise<boolean> {
  try {
    await execAsync('winget --version')
    return true
  } catch {
    return false
  }
}

/**
 * Download a file with progress callback
 */
function downloadFile(
  url: string,
  destPath: string,
  onProgress?: (percent: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const file = createWriteStream(destPath)

    const request = (currentUrl: string) => {
      https.get(currentUrl, (response) => {
        // Handle redirects
        if (response.statusCode === 302 || response.statusCode === 301) {
          const redirectUrl = response.headers.location
          if (redirectUrl) {
            request(redirectUrl)
            return
          }
        }

        if (response.statusCode !== 200) {
          file.close()
          reject(new Error(`Download failed: ${response.statusCode}`))
          return
        }

        const totalSize = parseInt(response.headers['content-length'] || '0', 10)
        let downloadedSize = 0

        response.on('data', (chunk) => {
          downloadedSize += chunk.length
          if (totalSize > 0 && onProgress) {
            onProgress((downloadedSize / totalSize) * 100)
          }
        })

        response.pipe(file)

        file.on('finish', () => {
          file.close()
          resolve()
        })
      }).on('error', (err) => {
        file.close()
        reject(err)
      })
    }

    request(url)
  })
}

/**
 * Extract ZIP file (Windows/macOS)
 */
async function extractZip(zipPath: string, destDir: string, binaryPath: string): Promise<string> {
  const AdmZip = require('adm-zip')
  const zip = new AdmZip(zipPath)

  // Extract the ffmpeg binary
  const entries = zip.getEntries()
  const ffmpegEntry = entries.find((e: { entryName: string }) =>
    e.entryName === binaryPath || e.entryName.endsWith('/ffmpeg.exe') || e.entryName.endsWith('/ffmpeg')
  )

  if (!ffmpegEntry) {
    throw new Error(`FFmpeg binary not found in archive at path: ${binaryPath}`)
  }

  // Extract just the ffmpeg binary to destDir
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const outputPath = join(destDir, binaryName)

  zip.extractEntryTo(ffmpegEntry, destDir, false, true, false, binaryName)

  return outputPath
}

/**
 * Extract tar.xz file (Linux)
 */
async function extractTarXz(tarPath: string, destDir: string, binaryPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Extract with tar, then find and move the ffmpeg binary
    const proc = spawn('tar', ['-xJf', tarPath, '-C', destDir, '--strip-components=2', binaryPath], {
      stdio: ['ignore', 'pipe', 'pipe']
    })

    proc.on('close', (code) => {
      if (code === 0) {
        resolve(join(destDir, 'ffmpeg'))
      } else {
        reject(new Error(`tar extraction failed with code ${code}`))
      }
    })

    proc.on('error', reject)
  })
}

/**
 * Download and install FFmpeg to userData directory
 */
export async function downloadFFmpeg(
  onProgress?: (message: string, percent?: number) => void
): Promise<{ success: boolean; path?: string; error?: string }> {
  const downloadInfo = FFMPEG_DOWNLOADS[process.platform]
  if (!downloadInfo) {
    return { success: false, error: `Unsupported platform: ${process.platform}` }
  }

  const ffmpegDir = join(app.getPath('userData'), 'ffmpeg')
  const binaryName = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg'
  const finalPath = join(ffmpegDir, binaryName)

  try {
    // Create directory
    if (!existsSync(ffmpegDir)) {
      mkdirSync(ffmpegDir, { recursive: true })
    }

    // Determine archive extension and path
    const isZip = downloadInfo.url.endsWith('.zip')
    const archiveExt = isZip ? '.zip' : '.tar.xz'
    const archivePath = join(ffmpegDir, `ffmpeg-download${archiveExt}`)

    // Download
    onProgress?.('Downloading FFmpeg...', 0)
    console.log('[FFmpeg] Downloading from:', downloadInfo.url)

    await downloadFile(downloadInfo.url, archivePath, (percent) => {
      onProgress?.(`Downloading FFmpeg... ${Math.round(percent)}%`, percent)
    })

    // Extract
    onProgress?.('Extracting FFmpeg...', 100)
    console.log('[FFmpeg] Extracting to:', ffmpegDir)

    if (isZip) {
      await extractZip(archivePath, ffmpegDir, downloadInfo.binaryPath)
    } else {
      await extractTarXz(archivePath, ffmpegDir, downloadInfo.binaryPath)
    }

    // Make executable on Unix
    if (process.platform !== 'win32' && existsSync(finalPath)) {
      chmodSync(finalPath, 0o755)
    }

    // Clean up archive
    await rm(archivePath, { force: true })

    // Verify it works
    const verified = await verifyFFmpeg(finalPath)
    if (!verified) {
      return { success: false, error: 'Downloaded FFmpeg failed verification' }
    }

    onProgress?.('FFmpeg installed successfully!', 100)
    console.log('[FFmpeg] Successfully installed to:', finalPath)

    // Clear cache so next check finds the downloaded version
    clearFFmpegCache()

    return { success: true, path: finalPath }
  } catch (error) {
    console.error('[FFmpeg] Download failed:', error)
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Install ffmpeg using the appropriate package manager
 * Returns a promise that resolves when installation is complete
 */
export async function installFFmpeg(
  mainWindow: BrowserWindow | null,
  onProgress?: (message: string) => void
): Promise<{ success: boolean; error?: string }> {
  const platform = process.platform

  try {
    if (platform === 'darwin') {
      // macOS - use Homebrew
      const hasHomebrew = await checkHomebrew()

      if (!hasHomebrew) {
        // Prompt user to install Homebrew first
        const result = await dialog.showMessageBox(mainWindow!, {
          type: 'question',
          buttons: ['Install Homebrew', 'Cancel'],
          defaultId: 0,
          title: 'Homebrew Required',
          message: 'Homebrew is needed to install ffmpeg',
          detail:
            'Homebrew is the easiest way to install ffmpeg on macOS. Would you like to install Homebrew first?\n\n' +
            'This will open Terminal and run the official Homebrew installer.'
        })

        if (result.response === 1) {
          return { success: false, error: 'Installation cancelled' }
        }

        // Install Homebrew
        onProgress?.('Installing Homebrew...')
        const homebrewInstallScript =
          '/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'

        // Open Terminal with the install command
        await execAsync(`osascript -e 'tell app "Terminal" to do script "${homebrewInstallScript}"'`)

        await dialog.showMessageBox(mainWindow!, {
          type: 'info',
          buttons: ['OK'],
          title: 'Homebrew Installation',
          message: 'Please complete Homebrew installation in Terminal',
          detail:
            'A Terminal window has opened with the Homebrew installer.\n\n' +
            'After Homebrew installation completes, click "OK" and try transcribing again.\n\n' +
            "If you've already installed Homebrew, you may need to restart XScribe."
        })

        return { success: false, error: 'Please complete Homebrew installation and try again' }
      }

      // Homebrew is installed, install ffmpeg
      onProgress?.('Installing ffmpeg via Homebrew...')

      return new Promise((resolve) => {
        const child = spawn('brew', ['install', 'ffmpeg'], {
          stdio: ['ignore', 'pipe', 'pipe']
        })

        let output = ''
        let errorOutput = ''

        child.stdout?.on('data', (data) => {
          output += data.toString()
          const lines = data.toString().split('\n')
          const lastLine = lines.filter((l: string) => l.trim()).pop()
          if (lastLine) {
            onProgress?.(lastLine.trim())
          }
        })

        child.stderr?.on('data', (data) => {
          errorOutput += data.toString()
        })

        child.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true })
          } else {
            resolve({
              success: false,
              error: `Installation failed with code ${code}: ${errorOutput || output}`
            })
          }
        })

        child.on('error', (err) => {
          resolve({ success: false, error: err.message })
        })
      })
    } else if (platform === 'win32') {
      // Windows - download FFmpeg directly (no winget dependency)
      onProgress?.('Downloading FFmpeg...')

      const result = await downloadFFmpeg((message) => {
        onProgress?.(message)
      })

      if (result.success) {
        return { success: true }
      } else {
        // Download failed, offer manual fallback
        const dialogResult = await dialog.showMessageBox(mainWindow!, {
          type: 'error',
          buttons: ['Open Download Page', 'Try Again', 'Cancel'],
          defaultId: 1,
          title: 'FFmpeg Download Failed',
          message: 'Failed to download FFmpeg automatically',
          detail:
            `Error: ${result.error}\n\n` +
            'You can try again or download FFmpeg manually from the official website.'
        })

        if (dialogResult.response === 0) {
          const { shell } = await import('electron')
          shell.openExternal('https://ffmpeg.org/download.html#build-windows')
        } else if (dialogResult.response === 1) {
          // Try again
          return installFFmpeg(mainWindow, onProgress)
        }

        return { success: false, error: result.error }
      }
    } else if (platform === 'linux') {
      // Linux - show instructions for manual installation
      // We can't easily auto-install because of sudo requirements and different distros

      const result = await dialog.showMessageBox(mainWindow!, {
        type: 'info',
        buttons: ['Copy Command', 'Cancel'],
        defaultId: 0,
        title: 'Install ffmpeg',
        message: 'Please install ffmpeg using your package manager',
        detail:
          'Run one of these commands in your terminal:\n\n' +
          '• Ubuntu/Debian: sudo apt install ffmpeg\n' +
          '• Fedora: sudo dnf install ffmpeg\n' +
          '• Arch: sudo pacman -S ffmpeg\n\n' +
          'After installation, restart XScribe.'
      })

      if (result.response === 0) {
        const { clipboard } = await import('electron')
        clipboard.writeText('sudo apt install ffmpeg')

        await dialog.showMessageBox(mainWindow!, {
          type: 'info',
          buttons: ['OK'],
          title: 'Command Copied',
          message: 'Command copied to clipboard',
          detail: 'The command "sudo apt install ffmpeg" has been copied. Paste it in your terminal.'
        })
      }

      return { success: false, error: 'Manual installation required on Linux' }
    }

    return { success: false, error: 'Unsupported platform' }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * Show a dialog prompting the user to install ffmpeg
 */
export async function promptFFmpegInstall(
  mainWindow: BrowserWindow | null
): Promise<'install' | 'cancel' | 'manual'> {
  const instructions = getInstallInstructions()

  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'warning',
    buttons: ['Install Automatically', 'Manual Installation', 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'FFmpeg Required',
    message: 'FFmpeg is required to process audio files',
    detail:
      `FFmpeg is needed to convert audio files (MP3, M4A, etc.) to a format that can be transcribed.\n\n` +
      `Platform: ${instructions.platform}\n` +
      `Recommended method: ${instructions.method}\n\n` +
      `Would you like to install it automatically?`
  })

  switch (result.response) {
    case 0:
      return 'install'
    case 1:
      return 'manual'
    default:
      return 'cancel'
  }
}

/**
 * Show manual installation instructions
 */
export async function showManualInstructions(mainWindow: BrowserWindow | null): Promise<void> {
  const instructions = getInstallInstructions()

  const result = await dialog.showMessageBox(mainWindow!, {
    type: 'info',
    buttons: ['Open Download Page', 'Copy Command', 'Close'],
    defaultId: 0,
    title: 'FFmpeg Installation Instructions',
    message: `Install FFmpeg on ${instructions.platform}`,
    detail:
      `Method: ${instructions.method}\n\n` +
      (instructions.command ? `Command: ${instructions.command}\n\n` : '') +
      `After installation, restart XScribe to use the new ffmpeg installation.`
  })

  if (result.response === 0 && instructions.manualUrl) {
    const { shell } = await import('electron')
    shell.openExternal(instructions.manualUrl)
  } else if (result.response === 1 && instructions.command) {
    const { clipboard } = await import('electron')
    clipboard.writeText(instructions.command)
  }
}

// Singleton for caching ffmpeg status
let cachedStatus: FFmpegStatus | null = null

export async function getFFmpegStatus(forceCheck = false): Promise<FFmpegStatus> {
  if (!forceCheck && cachedStatus !== null) {
    return cachedStatus
  }
  cachedStatus = await checkFFmpeg()
  return cachedStatus
}

export function clearFFmpegCache(): void {
  cachedStatus = null
}
