<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useUIStore } from '../stores/ui'
import { useLibraryStore } from '../stores/library'
import { useTranscriptionStore } from '../stores/transcription'

interface ScannedFile {
  path: string
  name: string
  size: number
  duration: number | null
  isVideo: boolean
  alreadyTranscribed: boolean
  selected: boolean
  estimatedTime: number | null
}

interface ModelInfo {
  name: string
  description: string
  size: string
  downloaded: boolean
}

const uiStore = useUIStore()
const libraryStore = useLibraryStore()
const transcriptionStore = useTranscriptionStore()

// Wizard step
const step = ref<'info' | 'scan' | 'preview'>('info')

// Step 1: Project info
const projectName = ref('')
const projectDescription = ref('')
const projectColor = ref('#6366f1') // Default indigo

// Step 2: Scanning
const selectedDirectory = ref<string | null>(null)
const isScanning = ref(false)
const scanError = ref<string | null>(null)
const includeSubdirectories = ref(false)

// Step 3: File list
const files = ref<ScannedFile[]>([])
const totalDuration = ref(0)

// Model selection
const models = ref<ModelInfo[]>([])
const selectedModel = ref('base.en')
const useDiarization = ref(true)
const isLoadingModels = ref(true)

// Processing state
const isCreating = ref(false)

// Colors for project
const colorOptions = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#3b82f6', // Blue
  '#6b7280'  // Gray
]

// Computed
const selectedFiles = computed(() => files.value.filter(f => f.selected))

const selectedCount = computed(() => selectedFiles.value.length)

const selectedDuration = computed(() => {
  return selectedFiles.value.reduce((sum, f) => sum + (f.duration || 0), 0)
})

const totalEstimatedTime = computed(() => {
  return selectedFiles.value.reduce((sum, f) => sum + (f.estimatedTime || 0), 0)
})

const canCreate = computed(() => {
  return projectName.value.trim() && selectedFiles.value.length > 0 && !isCreating.value
})

// Format helpers
function formatDuration(seconds: number): string {
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

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}

// Load models
async function loadModels() {
  isLoadingModels.value = true
  try {
    models.value = await window.electronAPI.whisperx.getModels()
    // Load default model from settings
    const savedDefault = await window.electronAPI.db.settings.get('defaultModel')
    if (savedDefault) {
      selectedModel.value = savedDefault
    }
  } catch (err) {
    console.error('Failed to load models:', err)
    // Fallback
    models.value = [
      { name: 'tiny', description: 'Fastest', size: '~75MB', downloaded: false },
      { name: 'base.en', description: 'Fast, English', size: '~145MB', downloaded: false },
      { name: 'small.en', description: 'Balanced', size: '~470MB', downloaded: false }
    ]
  } finally {
    isLoadingModels.value = false
  }
}

// Directory selection
async function selectDirectory() {
  const dirPath = await window.electronAPI.openDirectoryDialog()
  if (dirPath) {
    selectedDirectory.value = dirPath
    await scanDirectory(dirPath)
  }
}

// Scan directory
async function scanDirectory(dirPath: string) {
  isScanning.value = true
  scanError.value = null
  files.value = []

  try {
    const result = await window.electronAPI.media.scanDirectory(dirPath, includeSubdirectories.value)

    if (result.errors.length > 0) {
      console.warn('Scan errors:', result.errors)
    }

    // Convert to our format with selection state
    files.value = result.files.map(f => ({
      ...f,
      selected: !f.alreadyTranscribed, // Pre-select non-transcribed files
      estimatedTime: null
    }))

    totalDuration.value = result.totalDuration

    // Update time estimates
    await updateEstimates()

    // Move to preview step
    step.value = 'preview'
  } catch (err) {
    scanError.value = err instanceof Error ? err.message : 'Failed to scan directory'
  } finally {
    isScanning.value = false
  }
}

// Update time estimates when model changes
async function updateEstimates() {
  for (const file of files.value) {
    if (file.duration) {
      file.estimatedTime = await window.electronAPI.media.estimateTime(
        file.duration,
        selectedModel.value,
        useDiarization.value
      )
    }
  }
}

// Toggle file selection
function toggleFile(file: ScannedFile) {
  file.selected = !file.selected
}

// Select/deselect all
function selectAll() {
  files.value.forEach(f => f.selected = true)
}

function deselectAll() {
  files.value.forEach(f => f.selected = false)
}

// Create project and start processing
async function createAndProcess() {
  if (!canCreate.value) return

  isCreating.value = true

  try {
    // Create project
    const project = await libraryStore.createProject(
      projectName.value.trim(),
      projectDescription.value.trim() || undefined,
      projectColor.value
    )

    // Queue selected files for transcription
    for (const file of selectedFiles.value) {
      await transcriptionStore.queueTranscription(file.path, file.name, {
        projectId: project.id,
        model: selectedModel.value,
        useDiarization: useDiarization.value,
        fileSize: file.size,
        duration: file.duration || undefined
      })
    }

    // Start processing the queue
    transcriptionStore.processQueue()

    // Close modal
    close()

    // Show success message
    uiStore.showSuccess(`Project "${project.name}" created with ${selectedFiles.value.length} files queued`)
  } catch (err) {
    uiStore.showError(err instanceof Error ? err.message : 'Failed to create project')
  } finally {
    isCreating.value = false
  }
}

function close() {
  uiStore.closeModal()
}

function goBack() {
  if (step.value === 'preview') {
    step.value = 'info'
    files.value = []
    selectedDirectory.value = null
  }
}

// Watch for model/diarization changes to update estimates
watch([selectedModel, useDiarization], () => {
  if (files.value.length > 0) {
    updateEstimates()
  }
})

// Load models on mount
loadModels()
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div class="modal" :class="{ 'modal-wide': step === 'preview' }">
      <header class="modal-header">
        <h2>{{ step === 'preview' ? 'Review Files' : 'Add Project' }}</h2>
        <button class="close-btn" @click="close">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </header>

      <!-- Step 1: Project Info -->
      <div v-if="step === 'info'" class="modal-body">
        <div class="form-group">
          <label class="form-label">Project Name *</label>
          <input
            v-model="projectName"
            type="text"
            class="form-input"
            placeholder="My Project"
            autofocus
          />
        </div>

        <div class="form-group">
          <label class="form-label">Description</label>
          <textarea
            v-model="projectDescription"
            class="form-textarea"
            placeholder="Optional description..."
            rows="2"
          ></textarea>
        </div>

        <div class="form-group">
          <label class="form-label">Color</label>
          <div class="color-picker">
            <button
              v-for="color in colorOptions"
              :key="color"
              class="color-option"
              :class="{ selected: projectColor === color }"
              :style="{ backgroundColor: color }"
              @click="projectColor = color"
            ></button>
          </div>
        </div>

        <div class="form-group">
          <label class="form-label">Import Files</label>
          <div class="folder-select-row">
            <button class="select-folder-btn" @click="selectDirectory" :disabled="isScanning">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
              </svg>
              {{ isScanning ? 'Scanning...' : 'Select Folder' }}
            </button>
            <label class="checkbox-option subdirectory-option">
              <input v-model="includeSubdirectories" type="checkbox" />
              <span>Include subdirectories</span>
            </label>
          </div>
          <p v-if="scanError" class="error-text">{{ scanError }}</p>
        </div>
      </div>

      <!-- Step 2: File Preview -->
      <div v-else-if="step === 'preview'" class="modal-body preview-body">
        <!-- Model selection row -->
        <div class="model-row">
          <div class="model-select-group">
            <label class="form-label-inline">Model:</label>
            <select v-model="selectedModel" class="model-select" @change="updateEstimates">
              <option v-for="model in models" :key="model.name" :value="model.name">
                {{ model.downloaded ? '✓' : '↓' }} {{ model.name }}
              </option>
            </select>
          </div>

          <label class="checkbox-option">
            <input v-model="useDiarization" type="checkbox" @change="updateEstimates" />
            <span>Speaker diarization</span>
          </label>

          <div class="selection-actions">
            <button class="text-btn" @click="selectAll">Select all</button>
            <button class="text-btn" @click="deselectAll">Deselect all</button>
          </div>
        </div>

        <!-- File list -->
        <div class="file-list">
          <div
            v-for="file in files"
            :key="file.path"
            class="file-item"
            :class="{ selected: file.selected, transcribed: file.alreadyTranscribed }"
            @click="toggleFile(file)"
          >
            <input
              type="checkbox"
              :checked="file.selected"
              @click.stop
              @change="toggleFile(file)"
            />

            <div class="file-icon">
              <svg v-if="file.isVideo" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18" />
                <line x1="7" y1="2" x2="7" y2="22" />
                <line x1="17" y1="2" x2="17" y2="22" />
                <line x1="2" y1="12" x2="22" y2="12" />
              </svg>
              <svg v-else width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M9 18V5l12-2v13" />
                <circle cx="6" cy="18" r="3" />
                <circle cx="18" cy="16" r="3" />
              </svg>
            </div>

            <div class="file-info">
              <span class="file-name">{{ file.name }}</span>
              <span v-if="file.alreadyTranscribed" class="transcribed-badge">Already transcribed</span>
            </div>

            <div class="file-meta">
              <span v-if="file.duration" class="file-duration">{{ formatDuration(file.duration) }}</span>
              <span class="file-size">{{ formatFileSize(file.size) }}</span>
            </div>

            <div v-if="file.estimatedTime" class="file-estimate">
              ~{{ formatDuration(file.estimatedTime) }}
            </div>
          </div>

          <div v-if="files.length === 0" class="empty-state">
            No media files found in the selected folder
          </div>
        </div>

        <!-- Summary footer -->
        <div class="summary-footer">
          <div class="summary-stats">
            <span><strong>{{ selectedCount }}</strong> of {{ files.length }} files selected</span>
            <span v-if="selectedDuration > 0">
              Total: <strong>{{ formatDuration(selectedDuration) }}</strong>
            </span>
            <span v-if="totalEstimatedTime > 0">
              Est. time: <strong>~{{ formatDuration(totalEstimatedTime) }}</strong>
            </span>
          </div>
        </div>
      </div>

      <footer class="modal-footer">
        <button v-if="step === 'preview'" class="btn-secondary" @click="goBack">
          Back
        </button>
        <div class="spacer"></div>
        <button class="btn-secondary" @click="close">
          Cancel
        </button>
        <button
          v-if="step === 'preview'"
          class="btn-primary"
          :disabled="!canCreate"
          @click="createAndProcess"
        >
          {{ isCreating ? 'Creating...' : `Create Project & Process ${selectedCount} Files` }}
        </button>
      </footer>
    </div>
  </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10001; /* Above DropZone (10000) */
}

.modal {
  background: var(--bg-secondary);
  border-radius: 12px;
  width: 90%;
  max-width: 480px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
}

.modal-wide {
  max-width: 700px;
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.125rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-secondary);
  cursor: pointer;
  padding: 0.25rem;
  border-radius: 4px;
}

.close-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.modal-body {
  padding: 1.25rem;
  overflow-y: auto;
  flex: 1;
}

.preview-body {
  padding: 0;
  display: flex;
  flex-direction: column;
}

.form-group {
  margin-bottom: 1rem;
}

.form-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.form-label-inline {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-right: 0.5rem;
}

.form-input,
.form-textarea {
  width: 100%;
  padding: 0.625rem 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.form-input:focus,
.form-textarea:focus {
  outline: none;
  border-color: var(--accent-color);
}

.form-textarea {
  resize: vertical;
  min-height: 60px;
}

.color-picker {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
}

.color-option {
  width: 28px;
  height: 28px;
  border-radius: 50%;
  border: 2px solid transparent;
  cursor: pointer;
  transition: transform 0.15s, border-color 0.15s;
}

.color-option:hover {
  transform: scale(1.1);
}

.color-option.selected {
  border-color: white;
  box-shadow: 0 0 0 2px var(--accent-color);
}

.folder-select-row {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.subdirectory-option {
  align-self: flex-start;
}

.select-folder-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.75rem 1rem;
  background: var(--bg-tertiary);
  border: 2px dashed var(--border-color);
  border-radius: 8px;
  color: var(--text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  width: 100%;
  justify-content: center;
  transition: border-color 0.2s, color 0.2s;
}

.select-folder-btn:hover:not(:disabled) {
  border-color: var(--accent-color);
  color: var(--accent-color);
}

.select-folder-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.error-text {
  color: #ef4444;
  font-size: 0.75rem;
  margin-top: 0.5rem;
}

/* Model row */
.model-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem 1rem;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap;
}

.model-select-group {
  display: flex;
  align-items: center;
}

.model-select {
  padding: 0.375rem 0.5rem;
  background: var(--bg-primary);
  border: 1px solid var(--border-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.checkbox-option {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
  cursor: pointer;
}

.selection-actions {
  margin-left: auto;
  display: flex;
  gap: 0.5rem;
}

.text-btn {
  background: none;
  border: none;
  color: var(--accent-color);
  font-size: 0.75rem;
  cursor: pointer;
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
}

.text-btn:hover {
  background: rgba(99, 102, 241, 0.1);
}

/* File list */
.file-list {
  flex: 1;
  overflow-y: auto;
  max-height: 350px;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.625rem 1rem;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background 0.15s;
}

.file-item:hover {
  background: var(--bg-tertiary);
}

.file-item.selected {
  background: rgba(99, 102, 241, 0.08);
}

.file-item.transcribed {
  opacity: 0.6;
}

.file-item input[type="checkbox"] {
  width: 16px;
  height: 16px;
  cursor: pointer;
}

.file-icon {
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-info {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.file-name {
  font-size: 0.875rem;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.transcribed-badge {
  font-size: 0.625rem;
  padding: 0.125rem 0.375rem;
  background: rgba(34, 197, 94, 0.15);
  color: #22c55e;
  border-radius: 4px;
  white-space: nowrap;
}

.file-meta {
  display: flex;
  gap: 0.75rem;
  font-size: 0.75rem;
  color: var(--text-muted);
  flex-shrink: 0;
}

.file-estimate {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  flex-shrink: 0;
}

.empty-state {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
}

/* Summary footer */
.summary-footer {
  padding: 0.75rem 1rem;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border-color);
}

.summary-stats {
  display: flex;
  gap: 1.5rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

/* Modal footer */
.modal-footer {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border-color);
}

.spacer {
  flex: 1;
}

.btn-primary,
.btn-secondary {
  padding: 0.625rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.btn-primary {
  background: var(--accent-color);
  color: white;
  border: none;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary {
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary:hover {
  background: var(--bg-primary);
}
</style>
