<script setup lang="ts">
import { computed, ref } from 'vue'
import { useUIStore } from '../stores/ui'
import { useTranscriptionStore } from '../stores/transcription'
import { useLibraryStore } from '../stores/library'

const uiStore = useUIStore()
const transcriptionStore = useTranscriptionStore()
const libraryStore = useLibraryStore()

const transcription = computed(() => transcriptionStore.activeTranscription)
const selectedFormat = ref('txt')

const exportFormats = [
  { value: 'txt', label: 'Plain Text (.txt)' },
  { value: 'srt', label: 'SRT Subtitles (.srt)' },
  { value: 'vtt', label: 'WebVTT (.vtt)' },
  { value: 'json', label: 'JSON (.json)' },
  { value: 'docx', label: 'Word Document (.docx)' }
]

// Get project name if transcription belongs to a project
const projectName = computed(() => {
  if (!transcription.value?.projectId) return null
  const project = libraryStore.projects.find(p => p.id === transcription.value?.projectId)
  return project?.name || null
})

function formatBytes(bytes: number | null): string {
  if (bytes === null || bytes === 0) return 'Unknown'
  const units = ['B', 'KB', 'MB', 'GB']
  let i = 0
  let size = bytes
  while (size >= 1024 && i < units.length - 1) {
    size /= 1024
    i++
  }
  return `${size.toFixed(1)} ${units[i]}`
}

function formatDuration(seconds: number | null): string {
  if (seconds === null) return 'Unknown'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  if (mins >= 60) {
    const hours = Math.floor(mins / 60)
    const remainingMins = mins % 60
    return `${hours}h ${remainingMins}m ${secs}s`
  }
  return `${mins}m ${secs}s`
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return 'Unknown'
  return new Date(dateStr).toLocaleString()
}

async function exportTranscript() {
  const transcriptionId = transcriptionStore.activeTranscriptionId
  if (!transcriptionId) return

  try {
    const filePath = await window.electronAPI.export.save(transcriptionId, selectedFormat.value)
    if (filePath) {
      uiStore.showSuccess(`Exported to ${filePath.split('/').pop()}`)
    }
  } catch (err) {
    uiStore.showError('Export failed')
  }
}

function close() {
  uiStore.closeModal()
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div class="modal details-modal">
        <header class="modal-header">
          <h2>Transcript Details</h2>
          <button class="close-btn" @click="close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </header>

        <div class="modal-body">
          <div v-if="transcription" class="details-grid">
            <div class="detail-row">
              <span class="detail-label">File Name</span>
              <span class="detail-value">{{ transcription.fileName }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">File Path</span>
              <span class="detail-value file-path">{{ transcription.filePath }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">File Size</span>
              <span class="detail-value">{{ formatBytes(transcription.fileSize) }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Duration</span>
              <span class="detail-value">{{ formatDuration(transcription.duration) }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Model Used</span>
              <span class="detail-value">{{ transcription.modelUsed || 'Unknown' }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Language</span>
              <span class="detail-value">{{ transcription.language || 'Auto-detected' }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Status</span>
              <span class="detail-value status" :class="transcription.status">
                {{ transcription.status }}
              </span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Segments</span>
              <span class="detail-value">{{ transcriptionStore.segments.length }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Speakers</span>
              <span class="detail-value">{{ transcriptionStore.uniqueSpeakers.length }}</span>
            </div>

            <div v-if="projectName" class="detail-row">
              <span class="detail-label">Project</span>
              <span class="detail-value">{{ projectName }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Created</span>
              <span class="detail-value">{{ formatDate(transcription.createdAt) }}</span>
            </div>

            <div class="detail-row">
              <span class="detail-label">Completed</span>
              <span class="detail-value">{{ formatDate(transcription.completedAt) }}</span>
            </div>
          </div>

          <div v-else class="no-data">
            <p>No transcription data available</p>
          </div>

          <div class="export-section">
            <div class="export-row">
              <label class="export-label">Export As</label>
              <select v-model="selectedFormat" class="export-select">
                <option v-for="format in exportFormats" :key="format.value" :value="format.value">
                  {{ format.label }}
                </option>
              </select>
              <button class="export-btn" @click="exportTranscript">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                Export
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
.modal-overlay {
  position: fixed;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10000;
}

.details-modal {
  background: var(--bg-primary);
  border-radius: 12px;
  width: 90%;
  max-width: 500px;
  max-height: 80vh;
  display: flex;
  flex-direction: column;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  margin: 0;
  font-size: 1.1rem;
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

.details-grid {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.detail-row {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 1rem;
}

.detail-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  flex-shrink: 0;
}

.detail-value {
  font-size: 0.875rem;
  color: var(--text-primary);
  text-align: right;
  word-break: break-word;
}

.detail-value.file-path {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  max-width: 280px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.detail-value.status {
  text-transform: capitalize;
  padding: 0.125rem 0.5rem;
  border-radius: 4px;
  font-size: 0.75rem;
  font-weight: 500;
}

.detail-value.status.completed {
  background: rgba(34, 197, 94, 0.2);
  color: #22c55e;
}

.detail-value.status.processing {
  background: rgba(59, 130, 246, 0.2);
  color: #3b82f6;
}

.detail-value.status.pending {
  background: rgba(245, 158, 11, 0.2);
  color: #f59e0b;
}

.detail-value.status.failed {
  background: rgba(239, 68, 68, 0.2);
  color: #ef4444;
}

.no-data {
  text-align: center;
  color: var(--text-secondary);
  padding: 2rem;
}

.export-section {
  margin-top: 1.5rem;
  padding-top: 1rem;
  border-top: 1px solid var(--border-color);
}

.export-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.export-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.export-select {
  flex: 1;
  padding: 0.5rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.export-btn {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 1rem;
  background: var(--accent-color);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: opacity 0.2s;
}

.export-btn:hover {
  opacity: 0.9;
}
</style>
