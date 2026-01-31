<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'

const emit = defineEmits<{
  'setup-complete': []
}>()

const stage = ref<string>('checking')
const percent = ref(0)
const message = ref('Checking setup...')
const error = ref<string | null>(null)
const isRunning = ref(false)

const stageIcon = computed(() => {
  switch (stage.value) {
    case 'checking':
      return '🔍'
    case 'downloading-python':
      return '⬇️'
    case 'extracting':
      return '📦'
    case 'installing-deps':
      return '⚙️'
    case 'complete':
      return '✅'
    case 'error':
      return '❌'
    default:
      return '⏳'
  }
})

const stageTitle = computed(() => {
  switch (stage.value) {
    case 'checking':
      return 'Checking Setup'
    case 'downloading-python':
      return 'Downloading Python'
    case 'extracting':
      return 'Extracting Files'
    case 'installing-deps':
      return 'Installing Components'
    case 'complete':
      return 'Setup Complete!'
    case 'error':
      return 'Setup Failed'
    default:
      return 'Setting Up'
  }
})

async function checkAndRunSetup() {
  isRunning.value = true
  error.value = null

  try {
    // Check if setup is already complete
    const isComplete = await window.electronAPI.setup.isComplete()

    if (isComplete) {
      stage.value = 'complete'
      percent.value = 100
      message.value = 'Ready to go!'
      setTimeout(() => emit('setup-complete'), 500)
      return
    }

    // Run setup
    await window.electronAPI.setup.run()
  } catch (err) {
    stage.value = 'error'
    error.value = err instanceof Error ? err.message : 'Unknown error occurred'
  } finally {
    isRunning.value = false
  }
}

function handleProgress(data: { stage: string; percent: number; message: string; error?: string }) {
  stage.value = data.stage
  percent.value = data.percent
  message.value = data.message

  if (data.error) {
    error.value = data.error
  }

  if (data.stage === 'complete') {
    setTimeout(() => emit('setup-complete'), 1500)
  }
}

async function retry() {
  error.value = null
  await checkAndRunSetup()
}

onMounted(() => {
  // Listen for progress updates
  window.electronAPI.onSetupProgress(handleProgress)
  checkAndRunSetup()
})
</script>

<template>
  <div class="setup-wizard">
    <div class="setup-content">
      <div class="logo">
        <svg width="80" height="80" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
          <path d="M12 6v6l4 2" />
          <path d="M8 14l-2 4M16 14l2 4" />
        </svg>
      </div>

      <h1>Welcome to XScribe</h1>

      <div class="stage-info">
        <span class="stage-icon">{{ stageIcon }}</span>
        <span class="stage-title">{{ stageTitle }}</span>
      </div>

      <div class="progress-container">
        <div class="progress-bar">
          <div class="progress-fill" :style="{ width: `${percent}%` }" />
        </div>
        <span class="progress-percent">{{ Math.round(percent) }}%</span>
      </div>

      <p class="message">{{ message }}</p>

      <div v-if="error" class="error-box">
        <p class="error-message">{{ error }}</p>
        <button class="retry-button" @click="retry">Try Again</button>
      </div>

      <p v-if="stage === 'installing-deps'" class="hint">
        This is a one-time setup. Future launches will be instant.
      </p>

      <p v-if="stage === 'complete'" class="success-hint">
        You're all set! XScribe is ready to transcribe.
      </p>
    </div>
  </div>
</template>

<style scoped>
.setup-wizard {
  position: fixed;
  inset: 0;
  background: var(--bg-primary);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100000;
}

.setup-content {
  text-align: center;
  max-width: 400px;
  padding: 2rem;
}

.logo {
  color: var(--accent-color);
  margin-bottom: 1.5rem;
  animation: pulse 2s ease-in-out infinite;
}

@keyframes pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

h1 {
  font-size: 1.75rem;
  font-weight: 600;
  margin: 0 0 1.5rem;
  color: var(--text-primary);
}

.stage-info {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin-bottom: 1rem;
}

.stage-icon {
  font-size: 1.25rem;
}

.stage-title {
  font-size: 1rem;
  font-weight: 500;
  color: var(--text-secondary);
}

.progress-container {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin-bottom: 1rem;
}

.progress-bar {
  flex: 1;
  height: 8px;
  background: var(--bg-tertiary);
  border-radius: 4px;
  overflow: hidden;
}

.progress-fill {
  height: 100%;
  background: var(--accent-color);
  border-radius: 4px;
  transition: width 0.3s ease;
}

.progress-percent {
  font-size: 0.875rem;
  color: var(--text-secondary);
  min-width: 40px;
  text-align: right;
}

.message {
  font-size: 0.875rem;
  color: var(--text-secondary);
  margin: 0;
  min-height: 1.5rem;
}

.hint {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  margin-top: 2rem;
}

.success-hint {
  font-size: 0.875rem;
  color: #22c55e;
  margin-top: 1rem;
  font-weight: 500;
}

.error-box {
  margin-top: 1.5rem;
  padding: 1rem;
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: 8px;
}

.error-message {
  color: #ef4444;
  font-size: 0.875rem;
  margin: 0 0 1rem;
}

.retry-button {
  padding: 0.5rem 1rem;
  background: var(--accent-color);
  color: white;
  border: none;
  border-radius: 6px;
  font-size: 0.875rem;
  font-weight: 500;
  cursor: pointer;
}

.retry-button:hover {
  opacity: 0.9;
}
</style>
