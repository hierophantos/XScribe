<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

// WhisperX model info
interface WhisperXModelInfo {
  name: string
  description: string
  size: string
  downloaded: boolean
}

const emit = defineEmits<{
  modelSelected: [modelName: string]
}>()

const props = defineProps<{
  selectedModel?: string
  defaultModel?: string
}>()

// Default model to use
const DEFAULT_MODEL = 'base.en'

// WhisperX models
const models = ref<WhisperXModelInfo[]>([])
const isLoading = ref(true)
const error = ref<string | null>(null)
const selectedModelName = ref<string>('')

async function loadModels() {
  isLoading.value = true
  error.value = null

  try {
    // Load WhisperX models
    try {
      models.value = await window.electronAPI.whisperx.getModels()
    } catch (err) {
      console.error('Failed to load WhisperX models:', err)
      // Use fallback list (assume not downloaded)
      models.value = [
        { name: 'tiny', description: 'Fastest, multilingual', size: '~75MB', downloaded: false },
        { name: 'tiny.en', description: 'Fastest, English only', size: '~75MB', downloaded: false },
        { name: 'base', description: 'Fast, multilingual', size: '~145MB', downloaded: false },
        { name: 'base.en', description: 'Fast, English only', size: '~145MB', downloaded: false },
        { name: 'small', description: 'Balanced, multilingual', size: '~470MB', downloaded: false },
        { name: 'small.en', description: 'Balanced, English only', size: '~470MB', downloaded: false },
        { name: 'medium', description: 'Accurate, multilingual', size: '~1.5GB', downloaded: false },
        { name: 'medium.en', description: 'Accurate, English only', size: '~1.5GB', downloaded: false },
        { name: 'large-v3', description: 'Most accurate', size: '~2.9GB', downloaded: false }
      ]
    }

    // Auto-select default model if none selected
    if (!selectedModelName.value) {
      const defaultModel = props.defaultModel || DEFAULT_MODEL
      selectedModelName.value = defaultModel
      emit('modelSelected', defaultModel)
    }
  } catch (err) {
    error.value = err instanceof Error ? err.message : 'Failed to load models'
    console.error('Failed to load models:', err)
  } finally {
    isLoading.value = false
  }
}

function handleModelChange() {
  emit('modelSelected', selectedModelName.value)
}

const selectedModelInfo = computed(() => {
  return models.value.find(m => m.name === selectedModelName.value)
})

onMounted(() => {
  loadModels()

  // Use prop if provided
  if (props.selectedModel) {
    selectedModelName.value = props.selectedModel
  }
})
</script>

<template>
  <div class="model-selector">
    <!-- Engine Info -->
    <div class="engine-info">
      <span class="engine-badge">WhisperX</span>
      <span class="info-badge">✓ Word-level timestamps</span>
      <span class="info-badge">✓ Speaker diarization</span>
    </div>

    <label class="selector-label">Model</label>

    <div v-if="isLoading" class="loading">
      Loading models...
    </div>

    <div v-else-if="error" class="error-message">
      {{ error }}
      <button class="retry-btn" @click="loadModels">Retry</button>
    </div>

    <div v-else class="selector-content">
      <!-- Model dropdown -->
      <div class="model-dropdown">
        <select
          v-model="selectedModelName"
          class="model-select"
          @change="handleModelChange"
        >
          <option v-if="models.length === 0" value="" disabled>
            No models available
          </option>
          <option
            v-for="model in models"
            :key="model.name"
            :value="model.name"
          >
            {{ model.downloaded ? '✓' : '↓' }} {{ model.name }} - {{ model.description }}
          </option>
        </select>

        <div v-if="selectedModelInfo" class="model-status">
          <span
            class="status-indicator"
            :class="selectedModelInfo.downloaded ? 'downloaded' : 'not-downloaded'"
            :title="selectedModelInfo.downloaded ? 'Downloaded' : 'Will download on first use'"
          >
            {{ selectedModelInfo.downloaded ? '✓' : '↓' }}
          </span>
          <span class="model-size">{{ selectedModelInfo.size }}</span>
        </div>
      </div>

      <!-- First-use download notice (only show if model not downloaded) -->
      <div v-if="selectedModelName && selectedModelInfo && !selectedModelInfo.downloaded" class="download-notice">
        <span class="notice-icon">↓</span>
        <span>Model will be downloaded from HuggingFace on first use</span>
      </div>

      <!-- Downloaded notice -->
      <div v-else-if="selectedModelName && selectedModelInfo?.downloaded" class="downloaded-notice">
        <span class="notice-icon">✓</span>
        <span>Model is ready to use</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.model-selector {
  width: 100%;
  max-width: 400px;
}

.engine-info {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.engine-badge {
  font-size: 0.75rem;
  font-weight: 600;
  padding: 0.25rem 0.5rem;
  background: var(--accent-color);
  color: white;
  border-radius: 4px;
}

.info-badge {
  font-size: 0.7rem;
  padding: 0.2rem 0.5rem;
  background: rgba(34, 197, 94, 0.1);
  color: #22c55e;
  border-radius: 4px;
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

.model-select option {
  padding: 0.5rem;
}

.model-status {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  white-space: nowrap;
}

.status-indicator {
  font-size: 0.875rem;
  font-weight: 600;
  width: 1.25rem;
  text-align: center;
}

.status-indicator.downloaded {
  color: #22c55e;
}

.status-indicator.not-downloaded {
  color: var(--text-muted);
}

.model-size {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  font-family: var(--font-mono);
}

.download-notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(59, 130, 246, 0.1);
  border: 1px solid rgba(59, 130, 246, 0.2);
  border-radius: 6px;
  font-size: 0.75rem;
  color: #3b82f6;
}

.downloaded-notice {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  background: rgba(34, 197, 94, 0.1);
  border: 1px solid rgba(34, 197, 94, 0.2);
  border-radius: 6px;
  font-size: 0.75rem;
  color: #22c55e;
}

.notice-icon {
  font-size: 0.875rem;
  font-weight: 600;
}
</style>
