<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useUIStore } from '../stores/ui'

const uiStore = useUIStore()

// Default model setting
const defaultModel = ref<string>('base.en')
const availableModels = ref<{ name: string; description: string; size: string; downloaded: boolean }[]>([])
const isLoadingModels = ref(true)

// Model options that make sense as defaults (excluding large models that take too long to download)
const RECOMMENDED_DEFAULTS = ['tiny', 'tiny.en', 'base', 'base.en', 'small', 'small.en', 'medium', 'medium.en', 'large-v3']

async function loadSettings() {
  try {
    // Load default model setting
    const savedDefault = await window.electronAPI.db.settings.get('defaultModel')
    if (savedDefault) {
      defaultModel.value = savedDefault
    }

    // Load available models
    try {
      availableModels.value = await window.electronAPI.whisperx.getModels()
    } catch {
      // Fallback list
      availableModels.value = [
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
  } catch (err) {
    console.error('Failed to load settings:', err)
  } finally {
    isLoadingModels.value = false
  }
}

async function handleDefaultModelChange(event: Event) {
  const value = (event.target as HTMLSelectElement).value
  defaultModel.value = value
  await window.electronAPI.db.settings.set('defaultModel', value)
}

function close() {
  uiStore.closeModal()
}

onMounted(() => {
  loadSettings()
})
</script>

<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Settings</h2>
        <button class="close-btn" @click="close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <!-- Default Model Setting -->
        <div class="setting-group">
          <label class="setting-label">Default Model</label>
          <div class="setting-control">
            <select
              v-if="!isLoadingModels"
              class="model-select"
              :value="defaultModel"
              @change="handleDefaultModelChange"
            >
              <option
                v-for="model in availableModels"
                :key="model.name"
                :value="model.name"
              >
                {{ model.downloaded ? '✓' : '↓' }} {{ model.name }} - {{ model.description }} ({{ model.size }})
              </option>
            </select>
            <span v-else class="loading-text">Loading models...</span>
          </div>
          <p class="setting-description">
            The model selected by default for new transcriptions. ✓ = downloaded, ↓ = will download on first use.
          </p>
        </div>

        <!-- Font Size Setting -->
        <div class="setting-group">
          <label class="setting-label">Transcript Font Size</label>
          <div class="setting-control">
            <button
              class="font-btn"
              @click="uiStore.decreaseFontSize()"
              :disabled="uiStore.transcriptFontSize <= 12"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
            <div class="font-size-display">
              <span class="font-size-value">{{ uiStore.transcriptFontSize }}px</span>
              <input
                type="range"
                min="12"
                max="24"
                step="2"
                :value="uiStore.transcriptFontSize"
                @input="uiStore.setTranscriptFontSize(Number(($event.target as HTMLInputElement).value))"
                class="font-slider"
              />
            </div>
            <button
              class="font-btn"
              @click="uiStore.increaseFontSize()"
              :disabled="uiStore.transcriptFontSize >= 24"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19" />
                <line x1="5" y1="12" x2="19" y2="12" />
              </svg>
            </button>
          </div>
          <p class="setting-description">
            Adjust the font size used in the transcription viewer (12px - 24px)
          </p>
        </div>

        <!-- Placeholder for future settings -->
        <div class="setting-group disabled">
          <label class="setting-label">Theme</label>
          <div class="setting-control">
            <span class="coming-soon">System Default (follows OS)</span>
          </div>
          <p class="setting-description">
            Theme customization coming soon
          </p>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn-primary" @click="close">Done</button>
      </div>
    </div>
  </div>
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

.modal-content {
  width: 90%;
  max-width: 480px;
  max-height: 80vh;
  background: var(--bg-secondary);
  border-radius: 12px;
  border: 1px solid var(--border-color);
  overflow: hidden;
  display: flex;
  flex-direction: column;
}

.modal-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-bottom: 1px solid var(--border-color);
}

.modal-header h2 {
  font-size: 1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.close-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
}

.close-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.modal-body {
  padding: 1.25rem;
  overflow-y: auto;
}

.setting-group {
  margin-bottom: 1.5rem;
}

.setting-group.disabled {
  opacity: 0.5;
}

.setting-label {
  display: block;
  font-size: 0.875rem;
  font-weight: 500;
  color: var(--text-primary);
  margin-bottom: 0.5rem;
}

.setting-control {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.font-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  cursor: pointer;
  flex-shrink: 0;
}

.font-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.font-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.font-size-display {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}

.font-size-value {
  font-size: 0.875rem;
  font-weight: 600;
  color: var(--text-primary);
  text-align: center;
  font-family: var(--font-mono);
}

.font-slider {
  width: 100%;
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  appearance: none;
  cursor: pointer;
}

.font-slider::-webkit-slider-thumb {
  appearance: none;
  width: 16px;
  height: 16px;
  background: var(--accent-color);
  border-radius: 50%;
  cursor: pointer;
}

.font-slider::-webkit-slider-thumb:hover {
  background: var(--accent-hover);
}

.setting-description {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin-top: 0.5rem;
}

.coming-soon {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-style: italic;
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

.loading-text {
  font-size: 0.875rem;
  color: var(--text-muted);
  font-style: italic;
}

.modal-footer {
  display: flex;
  justify-content: flex-end;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border-color);
}

.btn-primary {
  padding: 0.5rem 1rem;
  background: var(--accent-color);
  border: none;
  border-radius: 6px;
  color: white;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}

.btn-primary:hover {
  background: var(--accent-hover);
}
</style>
