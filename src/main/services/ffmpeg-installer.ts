/**
 * FFmpeg Installer Service
 *
 * Handles detection and installation of ffmpeg for different platforms.
 * Prefers bundled ffmpeg-static, falls back to system ffmpeg.
 */

import { exec, execSync, spawn } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { app, dialog, BrowserWindow } from 'electron'

const execAsync = promisify(exec)

interface FFmpegStatus {
  installed: boolean
  path?: string
  version?: string
  bundled?: boolean
}

/**
 * Get the path to the bundled ffmpeg binary from ffmpeg-static
 */
function getBundledFFmpegPath(): string | null {
  try {
    // Try to require ffmpeg-static which returns the path to the binary
    const ffmpegStatic = require('ffmpeg-static')
    if (ffmpegStatic && existsSync(ffmpegStatic)) {
      return ffmpegStatic
    }
  } catch {
    // ffmpeg-static not available
  }
  return null
}

/**
 * Check if ffmpeg is installed and available
 * Prefers bundled ffmpeg-static, falls back to system ffmpeg
 */
export async function checkFFmpeg(): Promise<FFmpegStatus> {
  // First check for bundled ffmpeg
  const bundledPath = getBundledFFmpegPath()
  if (bundledPath) {
    try {
      const { stdout } = await execAsync(`"${bundledPath}" -version`)
      const versionMatch = stdout.match(/ffmpeg version (\S+)/)
      const version = versionMatch ? versionMatch[1] : 'unknown'
      return {
        installed: true,
        path: bundledPath,
        version,
        bundled: true
      }
    } catch {
      // Bundled ffmpeg failed, try system ffmpeg
    }
  }

  // Fall back to system ffmpeg
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
        method: 'winget or manual download',
        command: 'winget install ffmpeg',
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
      // Windows - use winget
      const hasWinget = await checkWinget()

      if (!hasWinget) {
        // Winget not available, show manual instructions
        const result = await dialog.showMessageBox(mainWindow!, {
          type: 'info',
          buttons: ['Open Download Page', 'Cancel'],
          defaultId: 0,
          title: 'Manual Installation Required',
          message: 'Please install ffmpeg manually',
          detail:
            'Windows Package Manager (winget) is not available.\n\n' +
            'Please download ffmpeg from the official website and add it to your PATH.\n\n' +
            'After installation, restart XScribe.'
        })

        if (result.response === 0) {
          const { shell } = await import('electron')
          shell.openExternal('https://ffmpeg.org/download.html#build-windows')
        }

        return { success: false, error: 'Manual installation required' }
      }

      // Use winget to install
      onProgress?.('Installing ffmpeg via winget...')

      return new Promise((resolve) => {
        const child = spawn('winget', ['install', 'ffmpeg', '--silent'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: true
        })

        child.stdout?.on('data', (data) => {
          const lines = data.toString().split('\n')
          const lastLine = lines.filter((l: string) => l.trim()).pop()
          if (lastLine) {
            onProgress?.(lastLine.trim())
          }
        })

        child.on('close', (code) => {
          if (code === 0) {
            resolve({ success: true })
          } else {
            resolve({ success: false, error: `winget install failed with code ${code}` })
          }
        })

        child.on('error', (err) => {
          resolve({ success: false, error: err.message })
        })
      })
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
