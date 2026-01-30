<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useLibraryStore } from './stores/library'
import { useTranscriptionStore } from './stores/transcription'
import { useUIStore } from './stores/ui'
import LibrarySidebar from './components/LibrarySidebar.vue'
import TranscriptionView from './components/TranscriptionView.vue'
import DropZone from './components/DropZone.vue'
import ProgressBar from './components/ProgressBar.vue'
import ToastContainer from './components/ToastContainer.vue'
import ExportModal from './components/ExportModal.vue'

const libraryStore = useLibraryStore()
const transcriptionStore = useTranscriptionStore()
const uiStore = useUIStore()

const currentFile = ref<string | null>(null)
const showDropZone = ref(true)
const useDiarization = ref(true)

// Computed
const isProcessing = computed(() => {
  return transcriptionStore.status === 'pending' || transcriptionStore.status === 'processing'
})

const progressPercent = computed(() => {
  return transcriptionStore.progress?.percent || 0
})

const hasResult = computed(() => {
  return transcriptionStore.status === 'completed' && transcriptionStore.segments.length > 0
})

// Methods
async function handleFileSelect() {
  const filePath = await window.electronAPI.openFileDialog()
  if (filePath) {
    currentFile.value = filePath
    showDropZone.value = false
  }
}

function handleFileDrop(filePath: string) {
  currentFile.value = filePath
  showDropZone.value = false
}

async function startTranscription() {
  if (!currentFile.value) return

  try {
    await transcriptionStore.startTranscription(currentFile.value, {
      useDiarization: useDiarization.value
    })
    uiStore.showSuccess('Transcription completed!')
  } catch (error) {
    uiStore.showError(error instanceof Error ? error.message : 'Transcription failed')
  }
}

function handleSelectTranscription(id: string) {
  transcriptionStore.loadTranscription(id)
  showDropZone.value = false
  currentFile.value = null
}

function handleNewTranscription() {
  transcriptionStore.clearTranscription()
  currentFile.value = null
  showDropZone.value = true
}

function clearCurrentFile() {
  currentFile.value = null
  transcriptionStore.clearTranscription()
  showDropZone.value = true
}

// Watch for changes to show transcription view
watch(
  () => transcriptionStore.activeTranscriptionId,
  (id) => {
    if (id) {
      showDropZone.value = false
    }
  }
)

onMounted(() => {
  // If there are recent transcriptions, we could auto-load one here
})
</script>

<template>
  <div class="app-container">
    <!-- Global title bar drag region spanning entire window -->
    <div class="titlebar"></div>

    <LibrarySidebar
      @select-transcription="handleSelectTranscription"
      @new-transcription="handleNewTranscription"
    />

    <main class="main-content">

      <!-- Drop Zone / New Transcription View -->
      <div v-if="showDropZone && !currentFile" class="empty-state">
        <DropZone @file-dropped="handleFileDrop" @click="handleFileSelect" />
      </div>

      <!-- File Selected, Ready to Transcribe -->
      <div v-else-if="currentFile && !hasResult && !isProcessing" class="content-wrapper">
        <header class="file-header">
          <div class="file-info">
            <h2>{{ currentFile.split('/').pop() }}</h2>
            <span class="file-path">{{ currentFile }}</span>
          </div>
          <button class="clear-btn" @click="clearCurrentFile">✕</button>
        </header>

        <div class="ready-state">
          <div class="ready-icon">
            <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <path d="M12 18.5a6.5 6.5 0 1 0 0-13 6.5 6.5 0 0 0 0 13Z" />
              <path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" />
              <path d="M12 2v2M12 20v2M2 12h2M20 12h2" />
            </svg>
          </div>
          <p>Ready to transcribe</p>

          <div class="options">
            <label class="checkbox-option">
              <input v-model="useDiarization" type="checkbox" />
              <span>Identify speakers (diarization)</span>
            </label>
          </div>

          <button class="transcribe-button" @click="startTranscription">
            Start Transcription
          </button>
        </div>
      </div>

      <!-- Processing -->
      <div v-else-if="isProcessing" class="content-wrapper">
        <header class="file-header">
          <div class="file-info">
            <h2>{{ currentFile?.split('/').pop() || 'Processing...' }}</h2>
          </div>
        </header>

        <div class="processing-state">
          <div class="spinner"></div>
          <p>Transcribing audio...</p>
          <ProgressBar :percent="progressPercent" />
        </div>
      </div>

      <!-- Transcription Result -->
      <TranscriptionView v-else-if="hasResult" />

      <!-- Error State -->
      <div v-else-if="transcriptionStore.status === 'failed'" class="content-wrapper">
        <div class="error-state">
          <div class="error-icon">✕</div>
          <p>Transcription failed</p>
          <span class="error-message">{{ transcriptionStore.error }}</span>
          <button class="retry-button" @click="clearCurrentFile">Try Again</button>
        </div>
      </div>
    </main>

    <!-- Toasts -->
    <ToastContainer />

    <!-- Modals -->
    <ExportModal v-if="uiStore.activeModal === 'export'" />
  </div>
</template>

<style scoped>
.app-container {
  display: flex;
  height: 100vh;
  background: var(--bg-primary);
  color: var(--text-primary);
  position: relative;
}

/* Global title bar for window dragging - spans entire width */
.titlebar {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 38px;
  -webkit-app-region: drag;
  z-index: 9999;
}

.main-content {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.empty-state {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
  padding-top: 3rem; /* Account for title bar drag region */
}

.content-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.file-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.5rem;
  padding-top: 2.5rem; /* Account for title bar */
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-secondary);
  position: relative;
  z-index: 10000; /* Above titlebar drag region */
}

.file-info h2 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
}

.file-path {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}

.clear-btn {
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 1rem;
  cursor: pointer;
  padding: 0.5rem;
  border-radius: 4px;
}

.clear-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.transcribe-button {
  padding: 0.75rem 1.5rem;
  background: var(--accent-color);
  color: white;
  border: none;
  border-radius: 8px;
  font-weight: 500;
  font-size: 1rem;
  cursor: pointer;
  transition: background 0.2s;
}

.transcribe-button:hover:not(:disabled) {
  background: var(--accent-hover);
}

.transcribe-button:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.ready-state,
.processing-state,
.error-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  color: var(--text-secondary);
  padding: 2rem;
}

.ready-icon {
  color: var(--accent-color);
  margin-bottom: 0.5rem;
}

.ready-state p,
.processing-state p,
.error-state p {
  font-size: 1.25rem;
  margin: 0;
  font-weight: 500;
}

.options {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
  margin: 1rem 0;
}

.checkbox-option {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.checkbox-option input {
  width: 16px;
  height: 16px;
  accent-color: var(--accent-color);
}

.spinner {
  width: 48px;
  height: 48px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to {
    transform: rotate(360deg);
  }
}

.error-state {
  color: var(--text-primary);
}

.error-icon {
  width: 48px;
  height: 48px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #ef4444;
  color: white;
  border-radius: 50%;
  font-size: 1.5rem;
}

.error-message {
  font-size: 0.875rem;
  color: var(--text-tertiary);
  max-width: 400px;
  text-align: center;
}

.retry-button {
  padding: 0.6rem 1.2rem;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  margin-top: 0.5rem;
}

.retry-button:hover {
  background: var(--bg-secondary);
}
</style>
