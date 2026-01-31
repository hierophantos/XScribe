/**
 * Update Service - checks for new versions on GitHub Releases
 *
 * Compares the current app version against the latest GitHub release
 * and provides update information to the user.
 */

import { app, shell } from 'electron'
import https from 'https'

export interface UpdateInfo {
  currentVersion: string
  latestVersion: string
  hasUpdate: boolean
  releaseUrl: string
  releaseNotes: string
  publishedAt: string
  downloadUrls: {
    mac?: string
    macArm?: string
    win?: string
    linux?: string
    linuxDeb?: string
  }
}

interface GitHubRelease {
  tag_name: string
  html_url: string
  body: string
  published_at: string
  assets: Array<{
    name: string
    browser_download_url: string
  }>
}

export class UpdateService {
  private readonly repoOwner = 'hierophantos'
  private readonly repoName = 'XScribe'
  private cachedUpdateInfo: UpdateInfo | null = null
  private lastCheckTime: number = 0
  private readonly cacheTimeMs = 5 * 60 * 1000 // 5 minutes

  /**
   * Get the current app version
   */
  getCurrentVersion(): string {
    return app.getVersion()
  }

  /**
   * Check for updates from GitHub Releases
   */
  async checkForUpdates(forceCheck: boolean = false): Promise<UpdateInfo> {
    // Return cached result if still valid
    const now = Date.now()
    if (!forceCheck && this.cachedUpdateInfo && (now - this.lastCheckTime) < this.cacheTimeMs) {
      return this.cachedUpdateInfo
    }

    const currentVersion = this.getCurrentVersion()

    try {
      const release = await this.fetchLatestRelease()

      if (!release) {
        return this.createNoUpdateResult(currentVersion)
      }

      const latestVersion = release.tag_name.replace(/^v/, '')
      const hasUpdate = this.isNewerVersion(latestVersion, currentVersion)

      const updateInfo: UpdateInfo = {
        currentVersion,
        latestVersion,
        hasUpdate,
        releaseUrl: release.html_url,
        releaseNotes: release.body || 'No release notes available.',
        publishedAt: release.published_at,
        downloadUrls: this.extractDownloadUrls(release.assets)
      }

      // Cache the result
      this.cachedUpdateInfo = updateInfo
      this.lastCheckTime = now

      return updateInfo
    } catch (error) {
      console.error('[UpdateService] Failed to check for updates:', error)
      return this.createNoUpdateResult(currentVersion)
    }
  }

  /**
   * Open the release page in the default browser
   */
  async openReleasePage(url: string): Promise<void> {
    await shell.openExternal(url)
  }

  /**
   * Open the download URL for the current platform
   */
  async openDownloadPage(updateInfo: UpdateInfo): Promise<void> {
    const platform = process.platform
    const arch = process.arch

    let downloadUrl: string | undefined

    if (platform === 'darwin') {
      downloadUrl = arch === 'arm64' ? updateInfo.downloadUrls.macArm : updateInfo.downloadUrls.mac
    } else if (platform === 'win32') {
      downloadUrl = updateInfo.downloadUrls.win
    } else if (platform === 'linux') {
      downloadUrl = updateInfo.downloadUrls.linux || updateInfo.downloadUrls.linuxDeb
    }

    // Fall back to release page if no direct download URL
    await shell.openExternal(downloadUrl || updateInfo.releaseUrl)
  }

  /**
   * Fetch the latest release from GitHub API
   */
  private fetchLatestRelease(): Promise<GitHubRelease | null> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${this.repoOwner}/${this.repoName}/releases/latest`,
        method: 'GET',
        headers: {
          'User-Agent': `XScribe/${this.getCurrentVersion()}`,
          'Accept': 'application/vnd.github.v3+json'
        }
      }

      const req = https.request(options, (res) => {
        let data = ''

        res.on('data', (chunk) => {
          data += chunk
        })

        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const release = JSON.parse(data) as GitHubRelease
              resolve(release)
            } catch {
              reject(new Error('Failed to parse GitHub response'))
            }
          } else if (res.statusCode === 404) {
            // No releases yet
            resolve(null)
          } else {
            reject(new Error(`GitHub API returned ${res.statusCode}`))
          }
        })
      })

      req.on('error', reject)
      req.setTimeout(10000, () => {
        req.destroy()
        reject(new Error('Request timeout'))
      })
      req.end()
    })
  }

  /**
   * Compare version strings (semver-like)
   * Returns true if latestVersion is newer than currentVersion
   */
  private isNewerVersion(latestVersion: string, currentVersion: string): boolean {
    const latest = this.parseVersion(latestVersion)
    const current = this.parseVersion(currentVersion)

    if (latest.major > current.major) return true
    if (latest.major < current.major) return false

    if (latest.minor > current.minor) return true
    if (latest.minor < current.minor) return false

    if (latest.patch > current.patch) return true
    return false
  }

  /**
   * Parse a version string into components
   */
  private parseVersion(version: string): { major: number; minor: number; patch: number } {
    const parts = version.split('.').map((p) => parseInt(p, 10) || 0)
    return {
      major: parts[0] || 0,
      minor: parts[1] || 0,
      patch: parts[2] || 0
    }
  }

  /**
   * Extract platform-specific download URLs from release assets
   */
  private extractDownloadUrls(assets: GitHubRelease['assets']): UpdateInfo['downloadUrls'] {
    const urls: UpdateInfo['downloadUrls'] = {}

    for (const asset of assets) {
      const name = asset.name.toLowerCase()

      // macOS
      if (name.includes('arm64') && name.endsWith('.dmg')) {
        urls.macArm = asset.browser_download_url
      } else if (name.endsWith('.dmg') && !name.includes('arm64')) {
        urls.mac = asset.browser_download_url
      }
      // Windows
      else if (name.endsWith('.exe')) {
        urls.win = asset.browser_download_url
      }
      // Linux
      else if (name.endsWith('.appimage')) {
        urls.linux = asset.browser_download_url
      } else if (name.endsWith('.deb') && name.includes('amd64')) {
        urls.linuxDeb = asset.browser_download_url
      }
    }

    return urls
  }

  /**
   * Create a result indicating no update available
   */
  private createNoUpdateResult(currentVersion: string): UpdateInfo {
    return {
      currentVersion,
      latestVersion: currentVersion,
      hasUpdate: false,
      releaseUrl: `https://github.com/${this.repoOwner}/${this.repoName}/releases`,
      releaseNotes: '',
      publishedAt: '',
      downloadUrls: {}
    }
  }
}

// Singleton instance
let updateServiceInstance: UpdateService | null = null

export function getUpdateService(): UpdateService {
  if (!updateServiceInstance) {
    updateServiceInstance = new UpdateService()
  }
  return updateServiceInstance
}
