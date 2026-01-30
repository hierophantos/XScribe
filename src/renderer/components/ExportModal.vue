<script setup lang="ts">
import { ref } from 'vue'
import { useUIStore } from '../stores/ui'

type ExportFormat = 'srt' | 'vtt' | 'txt' | 'json' | 'docx'

const uiStore = useUIStore()

const selectedFormat = ref<ExportFormat>('txt')
const isExporting = ref(false)

const formats: Array<{ value: ExportFormat; label: string; description: string }> = [
  { value: 'txt', label: 'Plain Text', description: 'Simple text with speaker labels' },
  { value: 'srt', label: 'SRT Subtitles', description: 'Standard subtitle format' },
  { value: 'vtt', label: 'WebVTT', description: 'Web-compatible subtitles' },
  { value: 'json', label: 'JSON', description: 'Structured data with metadata' },
  { value: 'docx', label: 'Word Document', description: 'Microsoft Word format' }
]

async function handleExport() {
  const transcriptionId = uiStore.modalData.transcriptionId
  if (!transcriptionId) {
    uiStore.showError('No transcription selected')
    return
  }

  isExporting.value = true

  try {
    const filePath = await window.electronAPI.export.save(transcriptionId, selectedFormat.value)

    if (filePath) {
      uiStore.showSuccess(`Exported to ${filePath.split('/').pop()}`)
      uiStore.closeModal()
    }
  } catch (error) {
    console.error('[ExportModal] Export failed:', error)
    uiStore.showError(error instanceof Error ? error.message : 'Export failed')
  } finally {
    isExporting.value = false
  }
}

function close() {
  uiStore.closeModal()
}
</script>

<template>
  <Teleport to="body">
    <div class="modal-overlay" @click.self="close">
      <div class="modal">
        <div class="modal-header">
          <h3>Export Transcription</h3>
          <button class="close-btn" @click="close">✕</button>
        </div>

        <div class="modal-body">
          <p class="description">Choose an export format:</p>

          <div class="format-list">
            <label
              v-for="format in formats"
              :key="format.value"
              class="format-option"
              :class="{ selected: selectedFormat === format.value }"
            >
              <input
                v-model="selectedFormat"
                type="radio"
                :value="format.value"
                name="format"
              />
              <div class="format-info">
                <span class="format-label">{{ format.label }}</span>
                <span class="format-description">{{ format.description }}</span>
              </div>
              <span class="format-ext">.{{ format.value }}</span>
            </label>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn-secondary" @click="close">Cancel</button>
          <button class="btn-primary" :disabled="isExporting" @click="handleExport">
            {{ isExporting ? 'Exporting...' : 'Export' }}
          </button>
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
  z-index: 1000;
}

.modal {
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 12px;
  width: 90%;
  max-width: 420px;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h3 {
  margin: 0;
  font-size: 1rem;
  font-weight: 600;
}

.close-btn {
  background: none;
  border: none;
  color: var(--text-tertiary);
  cursor: pointer;
  padding: 0.25rem;
  font-size: 1rem;
}

.close-btn:hover {
  color: var(--text-primary);
}

.modal-body {
  padding: 1.25rem;
}

.description {
  margin: 0 0 1rem;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.format-list {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.format-option {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s;
}

.format-option:hover {
  border-color: var(--accent-color);
}

.format-option.selected {
  border-color: var(--accent-color);
  background: rgba(59, 130, 246, 0.1);
}

.format-option input {
  accent-color: var(--accent-color);
}

.format-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
}

.format-label {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.format-description {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.format-ext {
  font-family: var(--font-mono);
  font-size: 0.75rem;
  color: var(--text-tertiary);
  background: var(--bg-primary);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 0.75rem;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border-color);
}

.btn-secondary,
.btn-primary {
  padding: 0.5rem 1rem;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s;
}

.btn-secondary {
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  color: var(--text-primary);
}

.btn-secondary:hover {
  background: var(--bg-hover);
}

.btn-primary {
  background: var(--accent-color);
  border: none;
  color: white;
}

.btn-primary:hover:not(:disabled) {
  background: var(--accent-hover);
}

.btn-primary:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}
</style>
