import { createApp } from 'vue'
import App from './App.vue'
import { pinia } from './stores'
import { useLibraryStore } from './stores/library'
import { useTranscriptionStore } from './stores/transcription'
import './assets/main.css'

const app = createApp(App)

// Install Pinia
app.use(pinia)

// Mount the app
app.mount('#app')

// Set up IPC event listeners after app is mounted
const libraryStore = useLibraryStore()
const transcriptionStore = useTranscriptionStore()

// Load library data
libraryStore.loadLibrary()

// Listen for transcription events
window.electronAPI.onTranscriptionCreated((data) => {
  transcriptionStore.onTranscriptionCreated(data)
  // Also add to library's local state
  libraryStore.addTranscriptionLocally({
    id: data.id,
    fileName: data.fileName,
    filePath: '',
    projectId: null,
    fileSize: null,
    duration: null,
    language: null,
    modelUsed: null,
    status: 'pending',
    error: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null
  })
})

window.electronAPI.onTranscriptionProgress((data) => {
  transcriptionStore.onTranscriptionProgress(data)
})

window.electronAPI.onTranscriptionCompleted((data) => {
  transcriptionStore.onTranscriptionCompleted(data)
  // Refresh library to get updated transcription
  libraryStore.refreshTranscriptions()
})

window.electronAPI.onTranscriptionFailed((data) => {
  transcriptionStore.onTranscriptionFailed(data)
  // Update local state
  libraryStore.updateTranscriptionLocally(data.id, {
    status: 'failed',
    error: data.error
  })
})

window.electronAPI.onTranscriptionCancelled((data) => {
  transcriptionStore.onTranscriptionCancelled(data)
  // Update local state
  libraryStore.updateTranscriptionLocally(data.id, {
    status: 'cancelled'
  })
})
