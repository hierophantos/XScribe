<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'

interface ModelInfo {
  name: string
  available: boolean
  size: string
  description: string
}

const emit = defineEmits<{
  modelSelected: [modelName: string]
}>()

const props = defineProps<{
  selectedModel?: string
}>()

const models = ref<ModelInfo[]>([])
const isLoading = ref(true)
const downloadingModel = ref<string | null>(null)
const downloadProgress = ref(0)
const error = ref<string | null>(null)

const selectedModelName = ref<string>('')

// Computed: available models (already downloaded)
const availableModels = computed(() => models.value.filter((m) => m.available))

// Computed: unavailable models (need download)
const unavailableModels = computed(() => models.value.filter((m) => !m.available))

// Track if the selected model needs download
const selectedModelNeedsDownload = computed(() => {
  if (!selectedModelName.value) return false
  const model = models.value.find((m) => m.name === selectedModelName.value)
  return model && !model.available
})

async function loadModels() {
  isLoading.value = true
  error.value = null
  try {
    models.value = await window.electronAPI.models.getAvailable()

    // Auto-select first available model if none selected
    if (!selectedModelName.value) {
      const firstAvailable = models.value.find((m) => m.available)
      if (firstAvailable) {
        selectedModelName.value = firstAvailable.name
        emit('modelSelected', firstAvailable.name)
      }
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load models'
    console.error('Failed to load models:', err)
  } finally {
    isLoading.value = false
  }
}

function handleModelChange() {
  const model = models.value.find((m) => m.name === selectedModelName.value)
  if (model?.available) {
    emit('modelSelected', selectedModelName.value)
  }
}

async function downloadModel(modelName?: string) {
  const targetModel = modelName || selectedModelName.value
  if (!targetModel || downloadingModel.value) return

  downloadingModel.value = targetModel
  downloadProgress.value = 0
  error.value = null

  try {
    await window.electronAPI.models.download(targetModel)
    // Refresh model list after download
    await loadModels()
    // Select the newly downloaded model
    selectedModelName.value = targetModel
    emit('modelSelected', targetModel)
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Download failed'
    console.error('Download failed:', err)
  } finally {
    downloadingModel.value = null
    downloadProgress.value = 0
  }
}

function handleDownloadProgress(data: { modelName: string; percent: number }) {
  if (data.modelName === downloadingModel.value) {
    downloadProgress.value = data.percent
  }
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return bytes + ' B'
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB'
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB'
}

onMounted(() => {
  loadModels()
  window.electronAPI.models.onDownloadProgress(handleDownloadProgress)

  // Use prop if provided
  if (props.selectedModel) {
    selectedModelName.value = props.selectedModel
  }
})

onUnmounted(() => {
  window.electronAPI.models.removeDownloadProgressListener()
})
</script>

<template>
  <div class="model-selector">
    <label class="selector-label">Model</label>

    <div v-if="isLoading" class="loading">
      Loading models...
    </div>

    <div v-else-if="error && !downloadingModel" class="error-message">
      {{ error }}
      <button class="retry-btn" @click="loadModels">Retry</button>
    </div>

    <div v-else class="selector-content">
      <!-- All models dropdown with download indicators -->
      <div class="model-dropdown">
        <select
          v-model="selectedModelName"
          class="model-select"
          :class="{ 'needs-download': selectedModelNeedsDownload }"
          :disabled="downloadingModel !== null"
          @change="handleModelChange"
        >
          <option v-if="models.length === 0" value="" disabled>
            No models configured
          </option>
          <optgroup v-if="availableModels.length > 0" label="Available">
            <option
              v-for="model in availableModels"
              :key="model.name"
              :value="model.name"
            >
              {{ model.name }} - {{ model.description }}
            </option>
          </optgroup>
          <optgroup v-if="unavailableModels.length > 0" label="Available for Download">
            <option
              v-for="model in unavailableModels"
              :key="model.name"
              :value="model.name"
            >
              ⬇ {{ model.name }} - {{ model.description }}
            </option>
          </optgroup>
        </select>

        <div v-if="selectedModelName" class="model-info">
          {{ models.find(m => m.name === selectedModelName)?.size }}
        </div>
      </div>

      <!-- Download button when unavailable model is selected -->
      <div v-if="selectedModelNeedsDownload && !downloadingModel" class="download-prompt">
        <span class="download-notice">This model needs to be downloaded first</span>
        <button class="download-btn" @click="downloadModel()">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
            <polyline points="7 10 12 15 17 10"/>
            <line x1="12" y1="15" x2="12" y2="3"/>
          </svg>
          Download {{ selectedModelName }}
        </button>
      </div>

      <!-- Download progress -->
      <div v-if="downloadingModel" class="download-progress-container">
        <div class="download-status">
          <span>Downloading {{ downloadingModel }}...</span>
          <span class="progress-text">{{ downloadProgress }}%</span>
        </div>
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-selector {
  width: 100%;
  max-width: 400px;
}

.selector-label {
  display: block;
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--text-secondary);
  margin-bottom: 0.5rem;
}

.loading {
  padding: 0.75rem;
  text-align: center;
  color: var(--text-tertiary);
  font-size: 0.875rem;
}

.error-message {
  padding: 0.75rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 6px;
  color: #ef4444;
  font-size: 0.875rem;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
}

.retry-btn {
  padding: 0.25rem 0.5rem;
  background: rgba(239, 68, 68, 0.2);
  border: none;
  border-radius: 4px;
  color: #ef4444;
  font-size: 0.75rem;
  cursor: pointer;
}

.retry-btn:hover {
  background: rgba(239, 68, 68, 0.3);
}

.selector-content {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.model-dropdown {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.model-select {
  flex: 1;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
}

.model-select:focus {
  outline: none;
  border-color: var(--accent-color);
}

.model-select:disabled {
  opacity: 0.6;
  cursor: not-allowed;
}

.model-select.needs-download {
  border-color: #f59e0b;
  background: rgba(245, 158, 11, 0.1);
}

.model-select optgroup {
  font-weight: 600;
  color: var(--text-secondary);
}

.model-select option {
  padding: 0.5rem;
}

.model-info {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.download-prompt {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.75rem;
  background: rgba(245, 158, 11, 0.1);
  border: 1px solid rgba(245, 158, 11, 0.3);
  border-radius: 6px;
}

.download-notice {
  font-size: 0.8rem;
  color: #f59e0b;
}

.download-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  background: var(--accent-color);
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 0.8rem;
  font-weight: 500;
  cursor: pointer;
  white-space: nowrap;
}

.download-btn:hover:not(:disabled) {
  background: var(--accent-hover);
}

.download-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.download-progress-container {
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  padding: 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 6px;
}

.download-status {
  display: flex;
  justify-content: space-between;
  align-items: center;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.progress-bar {
  width: 100%;
  height: 6px;
  background: var(--bg-secondary);
  border-radius: 3px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-color);
  transition: width 0.2s;
}

.progress-text {
  font-size: 0.75rem;
  color: var(--text-secondary);
  font-family: var(--font-mono);
}
</style>
