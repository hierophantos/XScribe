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
import { logger } from './logger'

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
      logger.log('Setup', 'Build type detected: development')
      return this.buildType
    }

    // Production mode - check for lite build marker
    const markerPath = join(process.resourcesPath, 'build-markers', 'build-type.txt')
    if (existsSync(markerPath)) {
      try {
        const content = readFileSync(markerPath, 'utf-8').trim()
        if (content === 'lite') {
          this.buildType = 'lite'
          logger.log('Setup', 'Build type detected: lite (marker found)', { markerPath })
          return this.buildType
        }
      } catch (err) {
        logger.error('Setup', 'Failed to read build type marker', err)
      }
    }

    // Default: bundled (production without lite marker)
    this.buildType = 'bundled'
    logger.log('Setup', 'Build type detected: bundled')
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
      logger.log('Setup', 'Python not found', { pythonPath })
      return false
    }

    // Bundled builds: Python presence is sufficient
    if (buildType === 'bundled') {
      logger.log('Setup', 'Bundled build - Python found, ready')
      return true
    }

    // Lite and development builds: check for setup complete marker
    if (!existsSync(this.setupCompleteFile)) {
      logger.log('Setup', `${buildType} build - setup not complete (no marker)`, { markerFile: this.setupCompleteFile })
      return false
    }

    // Verify Python actually works
    try {
      await this.runPythonCommand(['-c', 'import whisperx; print("ok")'], () => {}, 'Verify WhisperX import')
      logger.log('Setup', 'Python verification successful')
      return true
    } catch (err) {
      logger.error('Setup', 'Python verification failed', err)
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

    logger.log('Setup', 'Starting setup', {
      buildType,
      platform: process.platform,
      arch: process.arch,
      runtimeDir: this.runtimeDir
    })

    // Bundled builds: Python is pre-packaged, no setup needed
    if (buildType === 'bundled') {
      logger.log('Setup', 'Bundled build - skipping setup (Python is bundled)')
      onProgress({
        stage: 'complete',
        percent: 100,
        message: 'Ready!'
      })
      return
    }

    // Lite and development builds: run full setup
    logger.log('Setup', `${buildType} build - running full setup`)

    try {
      // Create setup directory
      if (!existsSync(this.runtimeDir)) {
        logger.log('Setup', 'Creating runtime directory', { runtimeDir: this.runtimeDir })
        mkdirSync(this.runtimeDir, { recursive: true })
      }

      // Step 1: Download Python if needed
      const pythonPath = this.getPythonPath()
      if (!existsSync(pythonPath)) {
        logger.log('Setup', 'Python not found, starting download', { pythonPath })
        onProgress({
          stage: 'downloading-python',
          percent: 0,
          message: 'Downloading Python runtime...'
        })

        await this.downloadAndExtractPython(onProgress)
        logger.log('Setup', 'Python download and extraction complete')
      } else {
        logger.log('Setup', 'Python already exists, skipping download', { pythonPath })
      }

      // Step 2: Install Python dependencies
      logger.log('Setup', 'Starting dependency installation')
      onProgress({
        stage: 'installing-deps',
        percent: 50,
        message: 'Installing transcription engine (this may take a few minutes)...'
      })

      await this.installDependencies(onProgress)
      logger.log('Setup', 'Dependency installation complete')

      // Step 3: Mark setup as complete
      await writeFile(this.setupCompleteFile, new Date().toISOString())
      logger.log('Setup', 'Setup complete marker written', { markerFile: this.setupCompleteFile })

      onProgress({
        stage: 'complete',
        percent: 100,
        message: 'Setup complete!'
      })

      logger.log('Setup', 'Setup completed successfully')
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error'
      logger.error('Setup', 'Setup failed', error)
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
      const errorMsg = `Unsupported platform: ${process.platform} ${process.arch}`
      logger.error('Setup', errorMsg)
      throw new Error(errorMsg)
    }

    logger.log('Setup', 'Starting Python download', {
      platformKey,
      url: downloadInfo.url,
      extractedDir: downloadInfo.extractedDir
    })

    const tarPath = join(this.runtimeDir, 'python.tar.gz')

    // Download
    await this.downloadFile(downloadInfo.url, tarPath, (percent) => {
      onProgress({
        stage: 'downloading-python',
        percent: percent * 0.3, // 0-30%
        message: `Downloading Python runtime... ${Math.round(percent)}%`
      })
    })

    logger.log('Setup', 'Python download complete', { tarPath })

    // Extract
    onProgress({
      stage: 'extracting',
      percent: 30,
      message: 'Extracting Python runtime...'
    })

    logger.log('Setup', 'Extracting Python archive', { tarPath, destDir: this.runtimeDir })
    await this.extractTarGz(tarPath, this.runtimeDir)
    logger.log('Setup', 'Python extraction complete')

    // Clean up tar file
    await rm(tarPath, { force: true })
    logger.log('Setup', 'Cleaned up tar file')

    // Make Python executable on Unix
    if (process.platform !== 'win32') {
      const pythonPath = join(this.runtimePythonDir, 'bin', 'python3')
      if (existsSync(pythonPath)) {
        chmodSync(pythonPath, 0o755)
        logger.log('Setup', 'Made Python executable', { pythonPath })
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

    await this.runPythonCommand(['-m', 'pip', 'install', '--upgrade', 'pip'], () => {}, 'Upgrade pip')

    // Install PyTorch (CPU only for smaller size)
    onProgress({
      stage: 'installing-deps',
      percent: 60,
      message: 'Installing PyTorch (CPU)...'
    })

    await this.runPipCommand([
      'install',
      '--extra-index-url', 'https://download.pytorch.org/whl/cpu',
      'torch>=2.0.0',
      'torchaudio>=2.0.0'
    ], (line) => {
      if (line.includes('Downloading') || line.includes('Installing')) {
        onProgress({
          stage: 'installing-deps',
          percent: 65,
          message: line.slice(0, 60) + '...'
        })
      }
    }, 'Install PyTorch')

    // Install av (PyAV) using pre-built binary wheels only
    // This avoids the need for pkg-config and ffmpeg dev headers
    onProgress({
      stage: 'installing-deps',
      percent: 70,
      message: 'Installing audio/video libraries...'
    })

    await this.runPipCommand([
      'install',
      '--only-binary', ':all:',
      'av>=11'
    ], () => {}, 'Install PyAV')

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
    }, 'Install WhisperX')

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
    ], () => {}, 'Install sherpa-onnx')

    onProgress({
      stage: 'installing-deps',
      percent: 95,
      message: 'Finalizing installation...'
    })
  }

  /**
   * Run a Python command
   */
  private runPythonCommand(args: string[], onOutput: (line: string) => void, stepName: string = 'Python command'): Promise<void> {
    return new Promise((resolve, reject) => {
      const pythonPath = this.getPythonPath()
      const pythonDir = this.getPythonDir()

      logger.log('Setup', `[${stepName}] Starting`, { pythonPath, args })

      const env = {
        ...process.env,
        PYTHONPATH: pythonDir,
        PATH: process.platform === 'win32'
          ? `${pythonDir};${pythonDir}\\Scripts;${process.env.PATH}`
          : `${join(pythonDir, 'bin')}:${process.env.PATH}`
      }

      const proc = spawn(pythonPath, args, {
        cwd: this.getBuildType() === 'bundled' ? process.resourcesPath : this.runtimeDir,
        env
      })

      let stdout = ''
      let stderr = ''

      proc.stdout?.on('data', (data) => {
        const text = data.toString()
        stdout += text
        const lines = text.split('\n').filter((l: string) => l.trim())
        lines.forEach((line: string) => {
          logger.log('Setup', `[${stepName}] stdout: ${line.slice(0, 200)}`)
          onOutput(line)
        })
      })

      proc.stderr?.on('data', (data) => {
        const text = data.toString()
        stderr += text
        const lines = text.split('\n').filter((l: string) => l.trim())
        lines.forEach((line: string) => {
          logger.log('Setup', `[${stepName}] stderr: ${line.slice(0, 200)}`)
          onOutput(line)
        })
      })

      proc.on('close', (code) => {
        if (code === 0) {
          logger.log('Setup', `[${stepName}] Completed successfully`)
          resolve()
        } else {
          const errorMsg = `${stepName} failed with exit code ${code}`
          // Log the last portion of output for debugging
          logger.error('Setup', errorMsg, {
            exitCode: code,
            lastStdout: stdout.slice(-2000),
            lastStderr: stderr.slice(-2000)
          })
          // Include helpful error context in the rejection
          const lastOutput = stderr.slice(-500) || stdout.slice(-500)
          reject(new Error(`${errorMsg}\n\nLast output:\n${lastOutput}`))
        }
      })

      proc.on('error', (err) => {
        logger.error('Setup', `[${stepName}] Process error`, err)
        reject(err)
      })
    })
  }

  /**
   * Run a pip command
   */
  private runPipCommand(args: string[], onOutput: (line: string) => void, stepName: string = 'pip command'): Promise<void> {
    return this.runPythonCommand(['-m', 'pip', ...args], onOutput, stepName)
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
      logger.log('Setup', 'Starting download', { url, destPath })
      const file = createWriteStream(destPath)

      const request = (currentUrl: string) => {
        https.get(currentUrl, (response) => {
          // Handle redirects
          if (response.statusCode === 302 || response.statusCode === 301) {
            const redirectUrl = response.headers.location
            if (redirectUrl) {
              logger.log('Setup', 'Following redirect', { from: currentUrl, to: redirectUrl })
              request(redirectUrl)
              return
            }
          }

          if (response.statusCode !== 200) {
            const errorMsg = `Download failed with HTTP ${response.statusCode}`
            logger.error('Setup', errorMsg, { url: currentUrl, statusCode: response.statusCode })
            reject(new Error(errorMsg))
            return
          }

          const totalSize = parseInt(response.headers['content-length'] || '0', 10)
          let downloadedSize = 0
          logger.log('Setup', 'Download started', { totalSize, url: currentUrl })

          response.on('data', (chunk) => {
            downloadedSize += chunk.length
            if (totalSize > 0) {
              onProgress((downloadedSize / totalSize) * 100)
            }
          })

          response.pipe(file)

          file.on('finish', () => {
            file.close()
            logger.log('Setup', 'Download complete', { destPath, totalSize: downloadedSize })
            resolve()
          })
        }).on('error', (err) => {
          logger.error('Setup', 'Download error', err)
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
      logger.log('Setup', 'Starting tar extraction', { tarPath, destDir })

      const proc = spawn('tar', ['-xzf', tarPath, '-C', destDir])

      let stderr = ''

      proc.stderr?.on('data', (data) => {
        stderr += data.toString()
      })

      proc.on('close', (code) => {
        if (code === 0) {
          logger.log('Setup', 'Tar extraction completed successfully')
          resolve()
        } else {
          const errorMsg = `Tar extraction failed with exit code ${code}`
          logger.error('Setup', errorMsg, { stderr, tarPath, destDir })
          reject(new Error(`${errorMsg}\n${stderr}`))
        }
      })

      proc.on('error', (err) => {
        // This can happen if tar command is not found
        logger.error('Setup', 'Tar command error (is tar installed?)', err)
        reject(new Error(`Failed to run tar command: ${err.message}. Is tar installed on your system?`))
      })
    })
  }

  /**
   * Reset setup (for debugging/reinstall - lite and development builds only)
   */
  async resetSetup(): Promise<void> {
    const buildType = this.getBuildType()

    if (buildType === 'bundled') {
      logger.log('Setup', 'Cannot reset bundled Python in production')
      return
    }

    logger.log('Setup', `Resetting ${buildType} build setup`, { runtimeDir: this.runtimeDir })
    if (existsSync(this.runtimeDir)) {
      await rm(this.runtimeDir, { recursive: true, force: true })
      logger.log('Setup', 'Runtime directory removed')
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
