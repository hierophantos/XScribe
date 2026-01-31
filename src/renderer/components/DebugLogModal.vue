<script setup lang="ts">
import { ref, onMounted, watch } from 'vue'
import { useUIStore } from '../stores/ui'

const uiStore = useUIStore()

const logContents = ref('')
const logPath = ref('')
const isLoading = ref(true)
const copySuccess = ref(false)

async function loadLog() {
  isLoading.value = true
  try {
    logContents.value = await window.electronAPI.logger.getContents()
    logPath.value = await window.electronAPI.logger.getPath()
  } catch (err) {
    console.error('Failed to load debug log:', err)
    logContents.value = 'Failed to load debug log'
  } finally {
    isLoading.value = false
  }
}

async function refreshLog() {
  await loadLog()
}

async function clearLog() {
  await window.electronAPI.logger.clear()
  await loadLog()
}

async function copyLog() {
  try {
    await navigator.clipboard.writeText(logContents.value)
    copySuccess.value = true
    setTimeout(() => {
      copySuccess.value = false
    }, 2000)
  } catch (err) {
    console.error('Failed to copy log:', err)
  }
}

async function openLogFolder() {
  await window.electronAPI.logger.openInExplorer()
}

function close() {
  uiStore.closeModal()
}

// Scroll to bottom when log is loaded
watch(logContents, () => {
  setTimeout(() => {
    const textarea = document.querySelector('.log-content') as HTMLTextAreaElement
    if (textarea) {
      textarea.scrollTop = textarea.scrollHeight
    }
  }, 0)
})

onMounted(() => {
  loadLog()
})
</script>

<template>
  <div class="modal-overlay" @click.self="close">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Debug Log</h2>
        <button class="close-btn" @click="close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div class="modal-body">
        <div class="log-path">
          <span class="path-label">Log file:</span>
          <code class="path-value">{{ logPath }}</code>
        </div>

        <div class="log-actions">
          <button class="action-btn" @click="refreshLog" :disabled="isLoading">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="23 4 23 10 17 10" />
              <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
            </svg>
            Refresh
          </button>
          <button class="action-btn" @click="copyLog" :disabled="isLoading || !logContents">
            <svg v-if="!copySuccess" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
              <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
            </svg>
            <svg v-else width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
            {{ copySuccess ? 'Copied!' : 'Copy' }}
          </button>
          <button class="action-btn" @click="openLogFolder">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            Open Folder
          </button>
          <button class="action-btn danger" @click="clearLog" :disabled="isLoading || !logContents">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6" />
              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
            </svg>
            Clear
          </button>
        </div>

        <div class="log-container">
          <div v-if="isLoading" class="log-loading">
            Loading log...
          </div>
          <textarea
            v-else
            class="log-content"
            readonly
            :value="logContents || '(Log is empty)'"
            wrap="off"
          ></textarea>
        </div>
      </div>

      <div class="modal-footer">
        <p class="footer-note">
          Share this log when reporting issues to help with debugging.
        </p>
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
  z-index: 10002;
}

.modal-content {
  width: 90%;
  max-width: 800px;
  max-height: 85vh;
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
  overflow: hidden;
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
}

.log-path {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
}

.path-label {
  font-size: 0.75rem;
  color: var(--text-muted);
}

.path-value {
  font-size: 0.75rem;
  color: var(--text-secondary);
  background: var(--bg-tertiary);
  padding: 0.25rem 0.5rem;
  border-radius: 4px;
  font-family: var(--font-mono);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  max-width: 100%;
}

.log-actions {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  flex-wrap: wrap;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.5rem 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 0.8125rem;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.action-btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.action-btn.danger:hover:not(:disabled) {
  background: rgba(239, 68, 68, 0.1);
  border-color: rgba(239, 68, 68, 0.3);
  color: #ef4444;
}

.log-container {
  flex: 1;
  min-height: 0;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  overflow: hidden;
}

.log-loading {
  padding: 2rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.log-content {
  width: 100%;
  height: 100%;
  min-height: 300px;
  max-height: 50vh;
  padding: 0.75rem;
  background: transparent;
  border: none;
  color: var(--text-secondary);
  font-family: var(--font-mono);
  font-size: 0.75rem;
  line-height: 1.5;
  resize: none;
  overflow: auto;
}

.log-content:focus {
  outline: none;
}

.modal-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 1rem 1.25rem;
  border-top: 1px solid var(--border-color);
  gap: 1rem;
}

.footer-note {
  font-size: 0.75rem;
  color: var(--text-muted);
  margin: 0;
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
  flex-shrink: 0;
}

.btn-primary:hover {
  background: var(--accent-hover);
}
</style>
