/**
 * Setup Service - handles Python environment setup
 *
 * Supports three build types:
 *
 * 1. BUNDLED (production, default):
 *    - Python is bundled with the app (pre-built in CI)
 *    - No download or installation needed
 *    - App is ready immediately on first launch
 *
 * 2. LITE (production, -lite builds):
 *    - App is packaged without Python (~50MB vs ~750MB)
 *    - Python is downloaded at runtime on first use
 *    - Stores Python in user data directory
 *
 * 3. DEVELOPMENT:
 *    - Downloads portable Python if not present
 *    - Installs WhisperX and dependencies
 *    - Stores in user data directory
 */

import { app } from 'electron'
import { spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync, chmodSync, readFileSync } from 'fs'
import { writeFile, rm } from 'fs/promises'
import { join } from 'path'
import https from 'https'

export type BuildType = 'bundled' | 'lite' | 'development'

// Portable Python download URLs by platform (for development only)
const PYTHON_DOWNLOADS: Record<string, { url: string; extractedDir: string }> = {
  darwin: {
    url: 'https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-3.11.9+20240415-aarch64-apple-darwin-install_only.tar.gz',
    extractedDir: 'python'
  },
  'darwin-x64': {
    url: 'https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-3.11.9+20240415-x86_64-apple-darwin-install_only.tar.gz',
    extractedDir: 'python'
  },
  win32: {
    url: 'https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-3.11.9+20240415-x86_64-pc-windows-msvc-install_only.tar.gz',
    extractedDir: 'python'
  },
  linux: {
    url: 'https://github.com/indygreg/python-build-standalone/releases/download/20240415/cpython-3.11.9+20240415-x86_64-unknown-linux-gnu-install_only.tar.gz',
    extractedDir: 'python'
  }
}

export interface SetupProgress {
  stage: 'checking' | 'downloading-python' | 'extracting' | 'installing-deps' | 'complete' | 'error'
  percent: number
  message: string
  error?: string
}

type ProgressCallback = (progress: SetupProgress) => void

export class SetupService {
  private runtimeDir: string
  private runtimePythonDir: string
  private setupCompleteFile: string
  private buildType: BuildType | null = null

  constructor() {
    // Runtime setup directory (used for lite builds and development)
    this.runtimeDir = join(app.getPath('userData'), 'runtime')
    this.runtimePythonDir = join(this.runtimeDir, 'python')
    this.setupCompleteFile = join(this.runtimeDir, '.setup-complete')
  }

  /**
   * Detect the build type: bundled, lite, or development
   */
  getBuildType(): BuildType {
    // Cache the result
    if (this.buildType !== null) {
      return this.buildType
    }

    // Development mode
    if (!app.isPackaged) {
      this.buildType = 'development'
      console.log('[SetupService] Build type: development')
      return this.buildType
    }

    // Production mode - check for lite build marker
    const markerPath = join(process.resourcesPath, 'build-markers', 'build-type.txt')
    if (existsSync(markerPath)) {
      try {
        const content = readFileSync(markerPath, 'utf-8').trim()
        if (content === 'lite') {
          this.buildType = 'lite'
          console.log('[SetupService] Build type: lite (marker found)')
          return this.buildType
        }
      } catch (err) {
        console.warn('[SetupService] Failed to read build type marker:', err)
      }
    }

    // Default: bundled (production without lite marker)
    this.buildType = 'bundled'
    console.log('[SetupService] Build type: bundled')
    return this.buildType
  }

  /**
   * Check if setup is complete
   */
  async isSetupComplete(): Promise<boolean> {
    const buildType = this.getBuildType()
    const pythonPath = this.getPythonPath()

    // Check if Python exists at the expected location
    if (!existsSync(pythonPath)) {
      console.log('[SetupService] Python not found at:', pythonPath)
      return false
    }

    // Bundled builds: Python presence is sufficient
    if (buildType === 'bundled') {
      console.log('[SetupService] Bundled build - Python found, ready')
      return true
    }

    // Lite and development builds: check for setup complete marker
    if (!existsSync(this.setupCompleteFile)) {
      console.log(`[SetupService] ${buildType} build - setup not complete (no marker)`)
      return false
    }

    // Verify Python actually works
    try {
      await this.runPythonCommand(['-c', 'import whisperx; print("ok")'], () => {})
      return true
    } catch {
      console.log('[SetupService] Python verification failed')
      return false
    }
  }

  /**
   * Get the path to the Python executable
   */
  getPythonPath(): string {
    const buildType = this.getBuildType()

    // Bundled builds: Python is in resources
    if (buildType === 'bundled') {
      const resourcesPath = process.resourcesPath
      if (process.platform === 'win32') {
        return join(resourcesPath, 'python', 'python.exe')
      }
      return join(resourcesPath, 'python', 'bin', 'python3')
    }

    // Development: use local venv if it exists
    if (buildType === 'development') {
      const localVenvPython = process.platform === 'win32'
        ? join(process.cwd(), 'python', 'venv', 'Scripts', 'python.exe')
        : join(process.cwd(), 'python', 'venv', 'bin', 'python3')

      if (existsSync(localVenvPython)) {
        return localVenvPython
      }
    }

    // Lite builds and development fallback: use runtime directory
    if (process.platform === 'win32') {
      return join(this.runtimePythonDir, 'python.exe')
    }
    return join(this.runtimePythonDir, 'bin', 'python3')
  }

  /**
   * Get the directory containing Python (for PATH setup)
   */
  getPythonDir(): string {
    const buildType = this.getBuildType()

    // Bundled builds: Python is in resources
    if (buildType === 'bundled') {
      return join(process.resourcesPath, 'python')
    }

    // Development: use local venv if it exists
    if (buildType === 'development') {
      const localVenv = join(process.cwd(), 'python', 'venv')
      if (existsSync(localVenv)) {
        return localVenv
      }
    }

    // Lite builds and development fallback: use runtime directory
    return this.runtimePythonDir
  }

  /**
   * Get the path to pip
   */
  private getPipPath(): string {
    const pythonDir = this.getPythonDir()
    if (process.platform === 'win32') {
      return join(pythonDir, 'Scripts', 'pip.exe')
    }
    return join(pythonDir, 'bin', 'pip3')
  }

  /**
   * Run the setup process
   * - Bundled: No-op, Python is bundled
   * - Lite: Downloads and installs Python at runtime
   * - Development: Downloads and installs Python if needed
   */
  async runSetup(onProgress: ProgressCallback): Promise<void> {
    const buildType = this.getBuildType()

    // Bundled builds: Python is pre-packaged, no setup needed
    if (buildType === 'bundled') {
      console.log('[SetupService] Bundled build - skipping setup (Python is bundled)')
      onProgress({
        stage: 'complete',
        percent: 100,
        message: 'Ready!'
      })
      return
    }

    // Lite and development builds: run full setup
    console.log(`[SetupService] ${buildType} build - running setup`)

    try {
      // Create setup directory
      if (!existsSync(this.runtimeDir)) {
        mkdirSync(this.runtimeDir, { recursive: true })
      }

      // Step 1: Download Python if needed
      if (!existsSync(this.getPythonPath())) {
        onProgress({
          stage: 'downloading-python',
          percent: 0,
          message: 'Downloading Python runtime...'
        })

        await this.downloadAndExtractPython(onProgress)
      }

      // Step 2: Install Python dependencies
      onProgress({
        stage: 'installing-deps',
        percent: 50,
        message: 'Installing transcription engine (this may take a few minutes)...'
      })

      await this.installDependencies(onProgress)

      // Step 3: Mark setup as complete
      await writeFile(this.setupCompleteFile, new Date().toISOString())

      onProgress({
        stage: 'complete',
        percent: 100,
        message: 'Setup complete!'
      })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      onProgress({
        stage: 'error',
        percent: 0,
        message: 'Setup failed',
        error: errorMessage
      })
      throw error
    }
  }

  /**
   * Download and extract portable Python (lite and development builds)
   */
  private async downloadAndExtractPython(onProgress: ProgressCallback): Promise<void> {
    // Determine platform-specific download
    let platformKey = process.platform as string
    if (process.platform === 'darwin' && process.arch === 'x64') {
      platformKey = 'darwin-x64'
    }

    const downloadInfo = PYTHON_DOWNLOADS[platformKey]
    if (!downloadInfo) {
      throw new Error(`Unsupported platform: ${process.platform} ${process.arch}`)
    }

    const tarPath = join(this.runtimeDir, 'python.tar.gz')

    // Download
    await this.downloadFile(downloadInfo.url, tarPath, (percent) => {
      onProgress({
        stage: 'downloading-python',
        percent: percent * 0.3, // 0-30%
        message: `Downloading Python runtime... ${Math.round(percent)}%`
      })
    })

    // Extract
    onProgress({
      stage: 'extracting',
      percent: 30,
      message: 'Extracting Python runtime...'
    })

    await this.extractTarGz(tarPath, this.runtimeDir)

    // Clean up tar file
    await rm(tarPath, { force: true })

    // Make Python executable on Unix
    if (process.platform !== 'win32') {
      const pythonPath = join(this.runtimePythonDir, 'bin', 'python3')
      if (existsSync(pythonPath)) {
        chmodSync(pythonPath, 0o755)
      }
    }
  }

  /**
   * Install Python dependencies (lite and development builds)
   */
  private async installDependencies(onProgress: ProgressCallback): Promise<void> {
    // Upgrade pip first
    onProgress({
      stage: 'installing-deps',
      percent: 55,
      message: 'Upgrading pip...'
    })

    await this.runPythonCommand(['-m', 'pip', 'install', '--upgrade', 'pip'], () => {})

    // Install PyTorch (CPU only for smaller size)
    onProgress({
      stage: 'installing-deps',
      percent: 60,
      message: 'Installing PyTorch (CPU)...'
    })

    await this.runPipCommand([
      'install',
      '--extra-index-url', 'https://download.pytorch.org/whl/cpu',
      'torch>=2.0.0,<2.6.0',
      'torchaudio>=2.0.0,<2.6.0'
    ], (line) => {
      if (line.includes('Downloading') || line.includes('Installing')) {
        onProgress({
          stage: 'installing-deps',
          percent: 65,
          message: line.slice(0, 60) + '...'
        })
      }
    })

    // Install WhisperX from GitHub
    onProgress({
      stage: 'installing-deps',
      percent: 75,
      message: 'Installing WhisperX transcription engine...'
    })

    await this.runPipCommand([
      'install',
      'git+https://github.com/m-bain/whisperX.git',
      'pyannote.audio>=3.1,<4.0'
    ], (line) => {
      if (line.includes('Downloading') || line.includes('Installing')) {
        onProgress({
          stage: 'installing-deps',
          percent: 80,
          message: line.slice(0, 60) + '...'
        })
      }
    })

    // Install sherpa-onnx for diarization
    onProgress({
      stage: 'installing-deps',
      percent: 90,
      message: 'Installing speaker identification...'
    })

    await this.runPipCommand([
      'install',
      'sherpa-onnx>=1.10.0',
      'soundfile',
      'av'
    ], () => {})

    onProgress({
      stage: 'installing-deps',
      percent: 95,
      message: 'Finalizing installation...'
    })
  }

  /**
   * Run a Python command
   */
  private runPythonCommand(args: string[], onOutput: (line: string) => void): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonPath = this.getPythonPath()
      const pythonDir = this.getPythonDir()

      const proc = spawn(pythonPath, args, {
        cwd: this.getBuildType() === 'bundled' ? process.resourcesPath : this.runtimeDir,
        env: {
          ...process.env,
          PYTHONPATH: pythonDir,
          PATH: process.platform === 'win32'
            ? `${pythonDir};${pythonDir}\\Scripts;${process.env.PATH}`
            : `${join(pythonDir, 'bin')}:${process.env.PATH}`
        }
      })

      proc.stdout?.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l: string) => l.trim())
        lines.forEach((line: string) => onOutput(line))
      })

      proc.stderr?.on('data', (data) => {
        const lines = data.toString().split('\n').filter((l: string) => l.trim())
        lines.forEach((line: string) => onOutput(line))
      })

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Python command failed with code ${code}`))
        }
      })

      proc.on('error', reject)
    })
  }

  /**
   * Run a pip command
   */
  private runPipCommand(args: string[], onOutput: (line: string) => void): Promise<void> {
    return this.runPythonCommand(['-m', 'pip', ...args], onOutput)
  }

  /**
   * Download a file with progress
   */
  private downloadFile(
    url: string,
    destPath: string,
    onProgress: (percent: number) => void
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
            reject(new Error(`Download failed: ${response.statusCode}`))
            return
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10)
          let downloadedSize = 0

          response.on('data', (chunk) => {
            downloadedSize += chunk.length
            if (totalSize > 0) {
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
   * Extract a tar.gz file
   */
  private extractTarGz(tarPath: string, destDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('tar', ['-xzf', tarPath, '-C', destDir])

      proc.on('close', (code) => {
        if (code === 0) {
          resolve()
        } else {
          reject(new Error(`Extraction failed with code ${code}`))
        }
      })

      proc.on('error', reject)
    })
  }

  /**
   * Reset setup (for debugging/reinstall - lite and development builds only)
   */
  async resetSetup(): Promise<void> {
    const buildType = this.getBuildType()

    if (buildType === 'bundled') {
      console.log('[SetupService] Cannot reset bundled Python in production')
      return
    }

    console.log(`[SetupService] Resetting ${buildType} build setup`)
    if (existsSync(this.runtimeDir)) {
      await rm(this.runtimeDir, { recursive: true, force: true })
    }

    // Clear cached build type to allow re-detection
    this.buildType = null
  }
}

// Singleton instance
let setupServiceInstance: SetupService | null = null

export function getSetupService(): SetupService {
  if (!setupServiceInstance) {
    setupServiceInstance = new SetupService()
  }
  return setupServiceInstance
}
