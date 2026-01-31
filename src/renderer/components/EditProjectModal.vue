<script setup lang="ts">
import { ref, onMounted, computed, watch } from 'vue'
import { useUIStore } from '../stores/ui'
import { useLibraryStore } from '../stores/library'
import { useTranscriptionStore } from '../stores/transcription'

const uiStore = useUIStore()
const libraryStore = useLibraryStore()
const transcriptionStore = useTranscriptionStore()

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

// Get project ID from modal data
const projectId = computed(() => uiStore.modalData?.projectId as string | undefined)

// Form state
const projectName = ref('')
const projectDescription = ref('')
const projectColor = ref('#6366f1')
const isLoading = ref(true)
const isSaving = ref(false)
const isDeleting = ref(false)
const showDeleteConfirm = ref(false)

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

// Add files section
const showAddFiles = ref(false)
const isScanning = ref(false)
const scanError = ref<string | null>(null)
const includeSubdirectories = ref(false)
const files = ref<ScannedFile[]>([])
const models = ref<ModelInfo[]>([])
const selectedModel = ref('base.en')
const useDiarization = ref(true)
const isLoadingModels = ref(false)
const isQueueing = ref(false)

const canSave = computed(() => {
  return projectName.value.trim() && !isSaving.value && !isDeleting.value
})

const selectedFiles = computed(() => files.value.filter(f => f.selected))
const selectedCount = computed(() => selectedFiles.value.length)
const selectedDuration = computed(() => {
  return selectedFiles.value.reduce((sum, f) => sum + (f.duration || 0), 0)
})
const totalEstimatedTime = computed(() => {
  return selectedFiles.value.reduce((sum, f) => sum + (f.estimatedTime || 0), 0)
})

// Load project data
onMounted(async () => {
  if (!projectId.value) {
    close()
    return
  }

  try {
    const project = await window.electronAPI.db.projects.get(projectId.value)
    if (project) {
      projectName.value = project.name
      projectDescription.value = project.description || ''
      projectColor.value = project.color || '#6366f1'
    } else {
      uiStore.showError('Project not found')
      close()
    }
  } catch (err) {
    console.error('Failed to load project:', err)
    uiStore.showError('Failed to load project')
    close()
  } finally {
    isLoading.value = false
  }
})

async function saveProject() {
  if (!canSave.value || !projectId.value) return

  isSaving.value = true

  try {
    await libraryStore.updateProject(projectId.value, {
      name: projectName.value.trim(),
      description: projectDescription.value.trim() || null,
      color: projectColor.value
    })

    uiStore.showSuccess('Project updated')
    close()
  } catch (err) {
    uiStore.showError(err instanceof Error ? err.message : 'Failed to update project')
  } finally {
    isSaving.value = false
  }
}

async function deleteProject() {
  if (!projectId.value || isDeleting.value) return

  isDeleting.value = true

  try {
    await libraryStore.deleteProject(projectId.value)
    uiStore.showSuccess('Project deleted')
    close()
  } catch (err) {
    uiStore.showError(err instanceof Error ? err.message : 'Failed to delete project')
  } finally {
    isDeleting.value = false
    showDeleteConfirm.value = false
  }
}

function close() {
  uiStore.closeModal()
}

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
    const savedDefault = await window.electronAPI.db.settings.get('defaultModel')
    if (savedDefault) {
      selectedModel.value = savedDefault
    }
  } catch (err) {
    console.error('Failed to load models:', err)
    models.value = [
      { name: 'tiny', description: 'Fastest', size: '~75MB', downloaded: false },
      { name: 'base.en', description: 'Fast, English', size: '~145MB', downloaded: false },
      { name: 'small.en', description: 'Balanced', size: '~470MB', downloaded: false }
    ]
  } finally {
    isLoadingModels.value = false
  }
}

// Directory selection and scanning
async function selectDirectory() {
  const dirPath = await window.electronAPI.openDirectoryDialog()
  if (dirPath) {
    await scanDirectory(dirPath)
  }
}

async function scanDirectory(dirPath: string) {
  isScanning.value = true
  scanError.value = null
  files.value = []

  try {
    const result = await window.electronAPI.media.scanDirectory(dirPath, includeSubdirectories.value)

    if (result.errors.length > 0) {
      console.warn('Scan errors:', result.errors)
    }

    files.value = result.files.map(f => ({
      ...f,
      selected: !f.alreadyTranscribed,
      estimatedTime: null
    }))

    await updateEstimates()
    showAddFiles.value = true
  } catch (err) {
    scanError.value = err instanceof Error ? err.message : 'Failed to scan directory'
  } finally {
    isScanning.value = false
  }
}

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

function toggleFile(file: ScannedFile) {
  file.selected = !file.selected
}

function selectAll() {
  files.value.forEach(f => f.selected = true)
}

function deselectAll() {
  files.value.forEach(f => f.selected = false)
}

async function queueFiles() {
  if (!projectId.value || selectedFiles.value.length === 0) return

  isQueueing.value = true

  try {
    for (const file of selectedFiles.value) {
      await transcriptionStore.queueTranscription(file.path, file.name, {
        projectId: projectId.value,
        model: selectedModel.value,
        useDiarization: useDiarization.value,
        fileSize: file.size,
        duration: file.duration || undefined
      })
    }

    transcriptionStore.processQueue()
    uiStore.showSuccess(`${selectedFiles.value.length} files queued for transcription`)

    // Reset add files section
    showAddFiles.value = false
    files.value = []
  } catch (err) {
    uiStore.showError(err instanceof Error ? err.message : 'Failed to queue files')
  } finally {
    isQueueing.value = false
  }
}

function cancelAddFiles() {
  showAddFiles.value = false
  files.value = []
  scanError.value = null
}

// Watch for model/diarization changes to update estimates
watch([selectedModel, useDiarization], () => {
  if (files.value.length > 0) {
    updateEstimates()
  }
})
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div class="modal" :class="{ 'modal-wide': showAddFiles }">
        <header class="modal-header">
          <h2>Edit Project</h2>
          <button class="close-btn" @click="close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div v-if="isLoading" class="modal-body loading">
          <div class="spinner"></div>
          <span>Loading project...</span>
        </div>

        <div v-else class="modal-body">
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

          <!-- Add Files Section -->
          <div class="add-files-section">
            <div class="section-header-row">
              <label class="form-label">Add Files</label>
            </div>

            <div v-if="!showAddFiles" class="add-files-trigger">
              <div class="folder-select-row">
                <button class="select-folder-btn" @click="selectDirectory(); loadModels()" :disabled="isScanning">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                    <line x1="12" y1="11" x2="12" y2="17" />
                    <line x1="9" y1="14" x2="15" y2="14" />
                  </svg>
                  {{ isScanning ? 'Scanning...' : 'Select Folder to Add Files' }}
                </button>
                <label class="checkbox-option subdirectory-option">
                  <input v-model="includeSubdirectories" type="checkbox" />
                  <span>Include subdirectories</span>
                </label>
              </div>
              <p v-if="scanError" class="error-text">{{ scanError }}</p>
            </div>

            <div v-else class="add-files-content">
              <!-- Model selection row -->
              <div class="model-row">
                <div class="model-select-group">
                  <label class="form-label-inline">Model:</label>
                  <select v-model="selectedModel" class="model-select">
                    <option v-for="model in models" :key="model.name" :value="model.name">
                      {{ model.downloaded ? '✓' : '↓' }} {{ model.name }}
                    </option>
                  </select>
                </div>

                <label class="checkbox-option">
                  <input v-model="useDiarization" type="checkbox" />
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
                <div class="file-actions">
                  <button class="btn-secondary-sm" @click="cancelAddFiles">Cancel</button>
                  <button
                    class="btn-primary-sm"
                    :disabled="selectedCount === 0 || isQueueing"
                    @click="queueFiles"
                  >
                    {{ isQueueing ? 'Queuing...' : `Add ${selectedCount} Files` }}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <!-- Delete Section -->
          <div class="danger-zone">
            <div class="danger-header">
              <span class="danger-label">Danger Zone</span>
            </div>
            <div v-if="!showDeleteConfirm" class="danger-content">
              <p>Delete this project. Transcriptions will be kept but unassigned.</p>
              <button class="delete-btn" @click="showDeleteConfirm = true">
                Delete Project
              </button>
            </div>
            <div v-else class="danger-content confirm">
              <p>Are you sure? This cannot be undone.</p>
              <div class="confirm-buttons">
                <button class="cancel-delete-btn" @click="showDeleteConfirm = false" :disabled="isDeleting">
                  Cancel
                </button>
                <button class="confirm-delete-btn" @click="deleteProject" :disabled="isDeleting">
                  {{ isDeleting ? 'Deleting...' : 'Yes, Delete' }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <footer class="modal-footer">
          <button class="btn-secondary" @click="close">
            Cancel
          </button>
          <button
            class="btn-primary"
            :disabled="!canSave"
            @click="saveProject"
          >
            {{ isSaving ? 'Saving...' : 'Save Changes' }}
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
  z-index: 10001;
}

.modal {
  background: var(--bg-secondary);
  border-radius: 12px;
  width: 90%;
  max-width: 440px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0, 0, 0, 0.3);
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

.modal-body.loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 1rem;
  min-height: 200px;
  color: var(--text-secondary);
}

.spinner {
  width: 32px;
  height: 32px;
  border: 3px solid var(--border-color);
  border-top-color: var(--accent-color);
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
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

/* Danger Zone */
.danger-zone {
  margin-top: 1.5rem;
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
  overflow: hidden;
}

.danger-header {
  padding: 0.5rem 0.75rem;
  background: rgba(239, 68, 68, 0.1);
}

.danger-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: #ef4444;
}

.danger-content {
  padding: 0.75rem;
}

.danger-content p {
  margin: 0 0 0.75rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.danger-content.confirm p {
  color: #ef4444;
  font-weight: 500;
}

.delete-btn {
  padding: 0.5rem 1rem;
  background: transparent;
  color: #ef4444;
  border: 1px solid rgba(239, 68, 68, 0.4);
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s, border-color 0.2s;
}

.delete-btn:hover {
  background: rgba(239, 68, 68, 0.1);
  border-color: #ef4444;
}

.confirm-buttons {
  display: flex;
  gap: 0.5rem;
}

.cancel-delete-btn {
  padding: 0.5rem 1rem;
  background: var(--bg-tertiary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  font-size: 0.8125rem;
  cursor: pointer;
}

.cancel-delete-btn:hover:not(:disabled) {
  background: var(--bg-primary);
}

.confirm-delete-btn {
  padding: 0.5rem 1rem;
  background: #ef4444;
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}

.confirm-delete-btn:hover:not(:disabled) {
  background: #dc2626;
}

.confirm-delete-btn:disabled,
.cancel-delete-btn:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

/* Modal footer */
.modal-footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border-color);
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

.modal-wide {
  max-width: 640px;
}

/* Add Files Section */
.add-files-section {
  margin-top: 1rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.section-header-row {
  margin-bottom: 0.5rem;
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

.add-files-content {
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.model-row {
  display: flex;
  align-items: center;
  gap: 1rem;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border-bottom: 1px solid var(--border-color);
  flex-wrap: wrap;
}

.model-select-group {
  display: flex;
  align-items: center;
}

.form-label-inline {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin-right: 0.5rem;
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

.file-list {
  max-height: 200px;
  overflow-y: auto;
}

.file-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--border-color);
  cursor: pointer;
  transition: background 0.15s;
}

.file-item:last-child {
  border-bottom: none;
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
  font-size: 0.8125rem;
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
  padding: 1.5rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.summary-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border-top: 1px solid var(--border-color);
}

.summary-stats {
  display: flex;
  gap: 1rem;
  font-size: 0.8125rem;
  color: var(--text-secondary);
}

.file-actions {
  display: flex;
  gap: 0.5rem;
}

.btn-primary-sm,
.btn-secondary-sm {
  padding: 0.375rem 0.75rem;
  border-radius: 5px;
  font-size: 0.8125rem;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary-sm {
  background: var(--accent-color);
  color: white;
  border: none;
}

.btn-primary-sm:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary-sm:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.btn-secondary-sm {
  background: var(--bg-primary);
  color: var(--text-primary);
  border: 1px solid var(--border-color);
}

.btn-secondary-sm:hover {
  background: var(--bg-secondary);
}
</style>
