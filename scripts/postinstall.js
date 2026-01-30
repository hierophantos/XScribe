#!/usr/bin/env node
/**
 * Postinstall script to fix platform-specific issues
 * - Rebuilds native modules for Electron
 * - Creates symlinks for whisper-node-addon platform directories
 */

const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')
const os = require('os')

// ============ Rebuild Native Modules for Electron ============

function rebuildNativeModules() {
  console.log('[postinstall] Rebuilding native modules for Electron...')

  try {
    // Check if better-sqlite3 is installed
    const betterSqlitePath = path.join(__dirname, '..', 'node_modules', 'better-sqlite3')
    if (!fs.existsSync(betterSqlitePath)) {
      console.log('[postinstall] better-sqlite3 not found, skipping rebuild')
      return
    }

    // Use @electron/rebuild to rebuild native modules
    execSync('npx @electron/rebuild -f -w better-sqlite3', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
      env: { ...process.env, npm_config_yes: 'true' }
    })

    console.log('[postinstall] Native modules rebuilt successfully')
  } catch (error) {
    console.error('[postinstall] Failed to rebuild native modules:', error.message)
    console.log('[postinstall] You may need to run: npx @electron/rebuild -f -w better-sqlite3')
    // Don't exit - let the rest of postinstall continue
  }
}

// Run native module rebuild
rebuildNativeModules()

const whisperAddonPath = path.join(
  __dirname,
  '..',
  'node_modules',
  '@kutalia',
  'whisper-node-addon',
  'dist'
)

// Map of expected names to actual folder names
const platformMappings = {
  'darwin-arm64': 'mac-arm64',
  'darwin-x64': 'mac-x64'
}

function createSymlinks() {
  if (!fs.existsSync(whisperAddonPath)) {
    console.log('[postinstall] whisper-node-addon not found, skipping symlink creation')
    return
  }

  for (const [expected, actual] of Object.entries(platformMappings)) {
    const expectedPath = path.join(whisperAddonPath, expected)
    const actualPath = path.join(whisperAddonPath, actual)

    // Only create symlink if actual exists and expected doesn't
    if (fs.existsSync(actualPath) && !fs.existsSync(expectedPath)) {
      try {
        fs.symlinkSync(actual, expectedPath)
        console.log(`[postinstall] Created symlink: ${expected} -> ${actual}`)
      } catch (err) {
        // On Windows, symlinks may require admin privileges
        // Fall back to copying the directory
        if (err.code === 'EPERM' || err.code === 'ENOENT') {
          console.log(`[postinstall] Symlink failed, trying copy: ${expected}`)
          try {
            fs.cpSync(actualPath, expectedPath, { recursive: true })
            console.log(`[postinstall] Copied: ${actual} -> ${expected}`)
          } catch (copyErr) {
            console.error(`[postinstall] Failed to copy: ${copyErr.message}`)
          }
        } else {
          console.error(`[postinstall] Symlink error: ${err.message}`)
        }
      }
    }
  }
}

// Run
createSymlinks()
console.log('[postinstall] Complete')
