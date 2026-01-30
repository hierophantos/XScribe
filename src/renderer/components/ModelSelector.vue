<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue'

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

const availableModels = computed(() => models.value.filter((m) => m.available))
const unavailableModels = computed(() => models.value.filter((m) => !m.available))

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

function selectModel(modelName: string) {
  const model = models.value.find((m) => m.name === modelName)
  if (model?.available) {
    selectedModelName.value = modelName
    emit('modelSelected', modelName)
  }
}

async function downloadModel(modelName: string) {
  if (downloadingModel.value) return

  downloadingModel.value = modelName
  downloadProgress.value = 0
  error.value = null

  try {
    await window.electronAPI.models.download(modelName)
    // Refresh model list after download
    await loadModels()
    // Auto-select the newly downloaded model
    selectModel(modelName)
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
      <!-- Available models dropdown -->
      <div class="model-dropdown">
        <select
          v-model="selectedModelName"
          class="model-select"
          :disabled="downloadingModel !== null"
          @change="emit('modelSelected', selectedModelName)"
        >
          <option v-if="availableModels.length === 0" value="" disabled>
            No models available
          </option>
          <option
            v-for="model in availableModels"
            :key="model.name"
            :value="model.name"
          >
            {{ model.name }} - {{ model.description }}
          </option>
        </select>

        <div v-if="selectedModelName" class="model-info">
          {{ models.find(m => m.name === selectedModelName)?.size }}
        </div>
      </div>

      <!-- Download more models section -->
      <div v-if="unavailableModels.length > 0" class="download-section">
        <button
          class="toggle-downloads"
          @click="($event.target as HTMLElement).closest('.download-section')?.classList.toggle('expanded')"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="m6 9 6 6 6-6"/>
          </svg>
          Download more models
        </button>

        <div class="download-list">
          <div
            v-for="model in unavailableModels"
            :key="model.name"
            class="download-item"
          >
            <div class="download-info">
              <span class="model-name">{{ model.name }}</span>
              <span class="model-desc">{{ model.description }}</span>
              <span class="model-size">{{ model.size }}</span>
            </div>

            <button
              v-if="downloadingModel !== model.name"
              class="download-btn"
              :disabled="downloadingModel !== null"
              @click="downloadModel(model.name)"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7 10 12 15 17 10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              Download
            </button>

            <div v-else class="download-progress">
              <div class="progress-bar">
                <div class="progress-fill" :style="{ width: downloadProgress + '%' }"></div>
              </div>
              <span class="progress-text">{{ downloadProgress }}%</span>
            </div>
          </div>
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

.model-info {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
  white-space: nowrap;
}

.download-section {
  border-top: 1px solid var(--border-color);
  padding-top: 0.75rem;
}

.toggle-downloads {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  background: none;
  border: none;
  color: var(--text-tertiary);
  font-size: 0.8rem;
  cursor: pointer;
  padding: 0.25rem 0;
}

.toggle-downloads:hover {
  color: var(--accent-color);
}

.toggle-downloads svg {
  transition: transform 0.2s;
}

.download-section.expanded .toggle-downloads svg {
  transform: rotate(180deg);
}

.download-list {
  display: none;
  flex-direction: column;
  gap: 0.5rem;
  margin-top: 0.5rem;
}

.download-section.expanded .download-list {
  display: flex;
}

.download-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border-radius: 6px;
  gap: 0.75rem;
}

.download-info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  flex: 1;
  min-width: 0;
}

.model-name {
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
}

.model-desc {
  font-size: 0.75rem;
  color: var(--text-tertiary);
}

.model-size {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.download-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.375rem 0.625rem;
  background: var(--accent-color);
  border: none;
  border-radius: 4px;
  color: white;
  font-size: 0.75rem;
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

.download-progress {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  min-width: 100px;
}

.progress-bar {
  flex: 1;
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
  font-size: 0.7rem;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  min-width: 32px;
  text-align: right;
}
</style>
