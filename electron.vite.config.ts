import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { copyFileSync, mkdirSync, existsSync } from 'fs'

// Plugin to copy worker files to output
function copyWorkerPlugin() {
  return {
    name: 'copy-worker',
    writeBundle() {
      const srcWorker = resolve(__dirname, 'src/main/services/transcription-worker.js')
      const destDir = resolve(__dirname, 'out/main/services')
      const destWorker = resolve(destDir, 'transcription-worker.js')

      // Create directory if it doesn't exist
      if (!existsSync(destDir)) {
        mkdirSync(destDir, { recursive: true })
      }

      // Copy the worker file
      if (existsSync(srcWorker)) {
        copyFileSync(srcWorker, destWorker)
        console.log('Copied transcription-worker.js to out/main/services/')
      }
    }
  }
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copyWorkerPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts')
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts')
        }
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html')
        }
      }
    },
    plugins: [vue()],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src/renderer')
      }
    }
  }
})
