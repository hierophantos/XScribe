<script setup lang="ts">
import { ref } from 'vue'

const emit = defineEmits<{
  fileDropped: [path: string]
}>()

const isDragging = ref(false)

function handleDragOver(event: DragEvent) {
  event.preventDefault()
  isDragging.value = true
}

function handleDragLeave() {
  isDragging.value = false
}

function handleDrop(event: DragEvent) {
  event.preventDefault()
  isDragging.value = false

  const files = event.dataTransfer?.files
  if (files && files.length > 0) {
    const file = files[0]
    // In Electron, we can get the path from the file
    const filePath = (file as File & { path?: string }).path
    if (filePath) {
      emit('fileDropped', filePath)
    }
  }
}

async function handleClick() {
  const filePath = await window.electronAPI.openFileDialog()
  if (filePath) {
    emit('fileDropped', filePath)
  }
}
</script>

<template>
  <div
    class="drop-zone"
    :class="{ 'is-dragging': isDragging }"
    @dragover="handleDragOver"
    @dragleave="handleDragLeave"
    @drop="handleDrop"
    @click="handleClick"
  >
    <div class="drop-content">
      <div class="drop-icon">
        <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <h3>Drop audio or video file here</h3>
      <p>or click to browse</p>
      <div class="supported-formats">
        <span>MP3</span>
        <span>WAV</span>
        <span>FLAC</span>
        <span>M4A</span>
        <span>MP4</span>
        <span>MKV</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.drop-zone {
  width: 100%;
  max-width: 500px;
  padding: 3rem;
  border: 2px dashed var(--border-color);
  border-radius: 12px;
  background: var(--bg-secondary);
  cursor: pointer;
  transition: all 0.2s;
  position: relative;
  z-index: 10000; /* Above titlebar drag region */
}

.drop-zone:hover,
.drop-zone.is-dragging {
  border-color: var(--accent-color);
  background: var(--bg-hover);
}

.drop-zone.is-dragging {
  transform: scale(1.02);
}

.drop-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.75rem;
  text-align: center;
}

.drop-icon {
  color: var(--accent-color);
  margin-bottom: 0.5rem;
}

.drop-content h3 {
  margin: 0;
  font-size: 1.1rem;
  font-weight: 600;
  color: var(--text-primary);
}

.drop-content p {
  margin: 0;
  font-size: 0.875rem;
  color: var(--text-secondary);
}

.supported-formats {
  display: flex;
  gap: 0.5rem;
  flex-wrap: wrap;
  justify-content: center;
  margin-top: 0.5rem;
}

.supported-formats span {
  padding: 0.25rem 0.5rem;
  background: var(--bg-tertiary);
  border-radius: 4px;
  font-size: 0.7rem;
  font-weight: 500;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
</style>
