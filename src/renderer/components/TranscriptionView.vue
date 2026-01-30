<script setup lang="ts">
import { computed, ref } from 'vue'
import { useTranscriptionStore } from '../stores/transcription'
import { useUIStore } from '../stores/ui'

const transcriptionStore = useTranscriptionStore()
const uiStore = useUIStore()

const editingSpeaker = ref<string | null>(null)
const editingName = ref('')

const speakerColors = [
  '#3b82f6', // blue
  '#10b981', // green
  '#f59e0b', // amber
  '#ef4444', // red
  '#8b5cf6', // violet
  '#ec4899' // pink
]

function getSpeakerColor(speakerId: string | null): string {
  if (!speakerId) return speakerColors[0]
  const speaker = transcriptionStore.speakerMap.get(speakerId)
  if (speaker?.color) return speaker.color
  const index = parseInt(speakerId.replace('SPEAKER_', ''), 10) || 0
  return speakerColors[index % speakerColors.length]
}

function getSpeakerName(speakerId: string | null): string {
  if (!speakerId) return 'Speaker'
  const speaker = transcriptionStore.speakerMap.get(speakerId)
  return speaker?.displayName || speakerId
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

// Check if there are multiple speakers
const hasMultipleSpeakers = computed(() => {
  return transcriptionStore.uniqueSpeakers.length > 1
})

const groupedSegments = computed(() => {
  // Group consecutive segments by speaker
  const groups: Array<{
    speakerId: string | null
    start: number
    end: number
    segments: typeof transcriptionStore.segments
  }> = []

  for (const segment of transcriptionStore.segments) {
    const lastGroup = groups[groups.length - 1]
    if (lastGroup && lastGroup.speakerId === segment.speakerId) {
      lastGroup.segments.push(segment)
      lastGroup.end = segment.endTime
    } else {
      groups.push({
        speakerId: segment.speakerId,
        start: segment.startTime,
        end: segment.endTime,
        segments: [segment]
      })
    }
  }

  return groups
})

function startEditSpeaker(speakerId: string | null) {
  if (!speakerId) return
  editingSpeaker.value = speakerId
  editingName.value = getSpeakerName(speakerId)
}

async function saveEditSpeaker() {
  if (!editingSpeaker.value || !editingName.value.trim()) {
    editingSpeaker.value = null
    return
  }

  try {
    await transcriptionStore.renameSpeaker(editingSpeaker.value, editingName.value.trim())
    uiStore.showSuccess('Speaker renamed')
  } catch (error) {
    uiStore.showError('Failed to rename speaker')
  }

  editingSpeaker.value = null
}

function cancelEditSpeaker() {
  editingSpeaker.value = null
  editingName.value = ''
}

async function copyToClipboard() {
  try {
    await navigator.clipboard.writeText(transcriptionStore.fullText)
    uiStore.showSuccess('Copied to clipboard')
  } catch {
    uiStore.showError('Failed to copy')
  }
}

function openExportModal() {
  uiStore.openModal('export', { transcriptionId: transcriptionStore.activeTranscriptionId || undefined })
}
</script>

<template>
  <div class="transcription-view">
    <div class="transcript-header">
      <div class="meta">
        <span class="segments">{{ transcriptionStore.segments.length }} segments</span>
        <span class="duration">{{ formatTime(transcriptionStore.totalDuration) }}</span>
        <span v-if="transcriptionStore.uniqueSpeakers.length > 0" class="speakers">
          {{ transcriptionStore.uniqueSpeakers.length }} speakers
        </span>
      </div>
      <div class="actions">
        <!-- Font size controls -->
        <div class="font-size-controls">
          <button
            class="font-btn"
            @click="uiStore.decreaseFontSize()"
            :disabled="uiStore.transcriptFontSize <= 12"
            title="Decrease font size"
          >
            A-
          </button>
          <span class="font-size-value">{{ uiStore.transcriptFontSize }}px</span>
          <button
            class="font-btn"
            @click="uiStore.increaseFontSize()"
            :disabled="uiStore.transcriptFontSize >= 24"
            title="Increase font size"
          >
            A+
          </button>
        </div>

        <div class="actions-divider"></div>

        <button class="action-btn" @click="openExportModal">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="7 10 12 15 17 10" />
            <line x1="12" y1="15" x2="12" y2="3" />
          </svg>
          Export
        </button>
        <button class="action-btn" @click="copyToClipboard">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
          </svg>
          Copy
        </button>
      </div>
    </div>

    <div class="transcript-content">
      <div v-if="transcriptionStore.segments.length === 0" class="empty-state">
        <p>No transcript content</p>
      </div>

      <div v-for="(group, index) in groupedSegments" :key="index" class="speaker-block">
        <div class="speaker-header" v-if="hasMultipleSpeakers">
          <div
            v-if="editingSpeaker !== group.speakerId"
            class="speaker-badge"
            :style="{ backgroundColor: getSpeakerColor(group.speakerId) }"
            @click="startEditSpeaker(group.speakerId)"
          >
            {{ getSpeakerName(group.speakerId) }}
            <span v-if="group.speakerId" class="edit-icon">✎</span>
          </div>
          <div v-else class="speaker-edit">
            <input
              v-model="editingName"
              type="text"
              class="speaker-input"
              @keyup.enter="saveEditSpeaker"
              @keyup.escape="cancelEditSpeaker"
              autofocus
            />
            <button class="save-btn" @click="saveEditSpeaker">✓</button>
            <button class="cancel-btn" @click="cancelEditSpeaker">✕</button>
          </div>
          <span class="time-range"> {{ formatTime(group.start) }} - {{ formatTime(group.end) }} </span>
        </div>
        <div class="speaker-text">
          <span v-for="(segment, sIndex) in group.segments" :key="sIndex" class="segment">
            {{ segment.text }}{{ ' ' }}
          </span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.transcription-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.transcript-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 0.75rem 1.5rem;
  padding-top: 2.5rem; /* Account for title bar */
  background: var(--bg-secondary);
  border-bottom: 1px solid var(--border-color);
  position: relative;
  z-index: 10000; /* Above titlebar drag region */
}

.meta {
  display: flex;
  gap: 1rem;
  font-size: 0.8rem;
  color: var(--text-secondary);
}

.actions {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.font-size-controls {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.25rem;
  background: var(--bg-tertiary);
  border-radius: 5px;
}

.font-btn {
  padding: 0.25rem 0.5rem;
  background: none;
  border: none;
  border-radius: 3px;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
}

.font-btn:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.font-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.font-size-value {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
  min-width: 32px;
  text-align: center;
}

.actions-divider {
  width: 1px;
  height: 20px;
  background: var(--border-color);
  margin: 0 0.25rem;
}

.action-btn {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  padding: 0.4rem 0.75rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 5px;
  color: var(--text-secondary);
  font-size: 0.8rem;
  cursor: pointer;
  transition: all 0.15s;
}

.action-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.transcript-content {
  flex: 1;
  overflow-y: auto;
  padding: 1.5rem;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--text-tertiary);
}

.speaker-block {
  margin-bottom: 1.5rem;
}

.speaker-header {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 0.5rem;
}

.speaker-badge {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  padding: 0.2rem 0.6rem;
  border-radius: 4px;
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: opacity 0.15s;
}

.speaker-badge:hover {
  opacity: 0.9;
}

.edit-icon {
  font-size: 0.625rem;
  opacity: 0;
  transition: opacity 0.15s;
}

.speaker-badge:hover .edit-icon {
  opacity: 1;
}

.speaker-edit {
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.speaker-input {
  padding: 0.2rem 0.5rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--accent-color);
  border-radius: 4px;
  color: var(--text-primary);
  font-size: 0.75rem;
  width: 120px;
}

.speaker-input:focus {
  outline: none;
}

.save-btn,
.cancel-btn {
  padding: 0.2rem 0.4rem;
  background: none;
  border: none;
  cursor: pointer;
  font-size: 0.75rem;
}

.save-btn {
  color: #22c55e;
}

.cancel-btn {
  color: #ef4444;
}

.time-range {
  font-size: 0.75rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}

.speaker-text {
  font-size: var(--transcript-font-size);
  line-height: 1.7;
  color: var(--text-primary);
}

.segment {
  cursor: pointer;
  border-radius: 2px;
  transition: background 0.15s;
}

.segment:hover {
  background: var(--bg-hover);
}
</style>
