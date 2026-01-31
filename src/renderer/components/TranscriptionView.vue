<script setup lang="ts">
import { computed, ref, watch, nextTick, onMounted } from 'vue'
import { useTranscriptionStore } from '../stores/transcription'
import { useUIStore } from '../stores/ui'

const transcriptionStore = useTranscriptionStore()
const uiStore = useUIStore()

const editingSpeaker = ref<string | null>(null)
const editingName = ref('')

// Context menu state
const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  hasSelection: false
})

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

// Search highlighting
interface MatchPosition {
  groupIndex: number
  segmentIndex: number
  startPos: number
  globalIndex: number
}

const matchPositions = computed<MatchPosition[]>(() => {
  if (!uiStore.activeSearchTerm) return []

  const term = uiStore.activeSearchTerm.toLowerCase()
  const matches: MatchPosition[] = []

  let globalMatchIndex = 0
  groupedSegments.value.forEach((group, gIdx) => {
    group.segments.forEach((segment, sIdx) => {
      const text = segment.text.toLowerCase()
      let pos = 0
      while ((pos = text.indexOf(term, pos)) !== -1) {
        matches.push({
          groupIndex: gIdx,
          segmentIndex: sIdx,
          startPos: pos,
          globalIndex: globalMatchIndex++
        })
        pos += term.length
      }
    })
  })

  return matches
})

// Update total matches when positions change
watch(
  matchPositions,
  (positions) => {
    uiStore.setTotalMatches(positions.length)
  },
  { immediate: true }
)

// Helper to escape HTML entities
function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

// Helper to escape regex special characters
function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Highlight text with search matches
function highlightText(text: string, groupIndex: number, segmentIndex: number): string {
  if (!uiStore.activeSearchTerm) return escapeHtml(text)

  const term = uiStore.activeSearchTerm
  const regex = new RegExp(`(${escapeRegex(term)})`, 'gi')

  // Count matches before this segment to determine global index
  const matchesBefore = matchPositions.value.filter(
    (m) => m.groupIndex < groupIndex || (m.groupIndex === groupIndex && m.segmentIndex < segmentIndex)
  ).length

  let matchIndex = 0
  return escapeHtml(text).replace(regex, (match) => {
    const globalIndex = matchesBefore + matchIndex++
    const isActive = globalIndex === uiStore.activeMatchIndex
    const className = isActive ? 'search-match active' : 'search-match'
    const id = isActive ? 'active-match' : ''
    return `<mark class="${className}"${id ? ` id="${id}"` : ''}>${match}</mark>`
  })
}

// Scroll to active match
function scrollToActiveMatch() {
  nextTick(() => {
    const activeElement = document.getElementById('active-match')
    if (activeElement) {
      activeElement.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  })
}

// Watch activeMatchIndex to scroll when navigating
watch(
  () => uiStore.activeMatchIndex,
  () => {
    scrollToActiveMatch()
  }
)

// Initial scroll when transcription loads with search term
onMounted(() => {
  if (uiStore.activeSearchTerm && matchPositions.value.length > 0) {
    // Small delay to ensure DOM is ready
    setTimeout(() => {
      scrollToActiveMatch()
    }, 100)
  }
})

// Watch for when segments change (new transcription loaded) and scroll to match
watch(
  () => transcriptionStore.segments,
  () => {
    if (uiStore.activeSearchTerm) {
      // Reset to first match when a new transcription loads
      uiStore.activeMatchIndex = 0
      setTimeout(() => {
        scrollToActiveMatch()
      }, 100)
    }
  }
)

// Navigation functions
function goToNextMatch() {
  uiStore.nextMatch()
}

function goToPrevMatch() {
  uiStore.prevMatch()
}

function clearSearch() {
  uiStore.clearSearchContext()
}

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

// Context menu functions
function showContextMenu(event: MouseEvent) {
  event.preventDefault()
  const selection = window.getSelection()?.toString().trim()
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    hasSelection: !!selection
  }
}

function hideContextMenu() {
  contextMenu.value.visible = false
}

async function copySelectedText() {
  const selection = window.getSelection()?.toString()
  if (selection) {
    try {
      await navigator.clipboard.writeText(selection)
      uiStore.showSuccess('Copied to clipboard')
    } catch {
      uiStore.showError('Failed to copy')
    }
  }
  hideContextMenu()
}

function openDetails() {
  uiStore.openModal('transcriptionDetails')
  hideContextMenu()
}

async function exportAs(format: string) {
  const transcriptionId = transcriptionStore.activeTranscriptionId
  if (!transcriptionId) return

  try {
    const filePath = await window.electronAPI.export.save(transcriptionId, format)
    if (filePath) {
      uiStore.showSuccess(`Exported to ${filePath.split('/').pop()}`)
    }
  } catch (err) {
    uiStore.showError('Export failed')
  }
  hideContextMenu()
}
</script>

<template>
  <div class="transcription-view">
    <div class="transcript-header">
      <div class="meta">
        <span class="duration">{{ formatTime(transcriptionStore.totalDuration) }}</span>
        <span class="separator">·</span>
        <span class="filename">{{ transcriptionStore.activeTranscription?.fileName || 'Unknown' }}</span>
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

        <!-- Search navigation (when search term active) -->
        <template v-if="uiStore.activeSearchTerm">
          <div class="actions-divider"></div>
          <div class="search-nav">
            <button
              class="search-nav-btn"
              @click="goToPrevMatch"
              :disabled="uiStore.totalMatches === 0"
              title="Previous match"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m18 15-6-6-6 6" />
              </svg>
            </button>
            <span class="match-counter">
              {{ uiStore.totalMatches > 0 ? `${uiStore.activeMatchIndex + 1} of ${uiStore.totalMatches}` : 'No matches' }}
            </span>
            <button
              class="search-nav-btn"
              @click="goToNextMatch"
              :disabled="uiStore.totalMatches === 0"
              title="Next match"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            <button class="search-clear-btn" @click="clearSearch" title="Clear search">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        </template>
      </div>
    </div>

    <div class="transcript-content" @contextmenu="showContextMenu">
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
          <p
            v-for="(segment, sIndex) in group.segments"
            :key="sIndex"
            class="segment"
            v-html="highlightText(segment.text, index, sIndex)"
          ></p>
        </div>
      </div>
    </div>

    <!-- Context Menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
        @click.stop
      >
        <button v-if="contextMenu.hasSelection" class="context-menu-item" @click="copySelectedText">
          Copy Selection
        </button>
        <button class="context-menu-item" @click="copyToClipboard(); hideContextMenu()">
          Copy All
        </button>
        <div class="context-menu-divider"></div>
        <button class="context-menu-item" @click="openDetails">
          Details
        </button>
        <div class="context-menu-submenu">
          <button class="context-menu-item has-submenu">
            Export
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="m9 18 6-6-6-6" />
            </svg>
          </button>
          <div class="submenu">
            <button class="context-menu-item" @click="exportAs('txt')">Plain Text (.txt)</button>
            <button class="context-menu-item" @click="exportAs('srt')">SRT Subtitles (.srt)</button>
            <button class="context-menu-item" @click="exportAs('vtt')">WebVTT (.vtt)</button>
            <button class="context-menu-item" @click="exportAs('json')">JSON (.json)</button>
            <button class="context-menu-item" @click="exportAs('docx')">Word Document (.docx)</button>
          </div>
        </div>
      </div>
      <div
        v-if="contextMenu.visible"
        class="context-menu-overlay"
        @click="hideContextMenu"
      />
    </Teleport>
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
  margin: 0 0 0.5em 0; /* Space between paragraphs */
  cursor: pointer;
  border-radius: 2px;
  transition: background 0.15s;
}

.segment:last-child {
  margin-bottom: 0;
}

.segment:hover {
  background: var(--bg-hover);
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10001;
  min-width: 140px;
  padding: 4px;
}

.context-menu-item {
  display: flex;
  align-items: center;
  gap: 8px;
  width: 100%;
  padding: 8px 12px;
  text-align: left;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-primary);
  cursor: pointer;
  font-size: 14px;
}

.context-menu-item:hover {
  background: var(--bg-tertiary);
}

.context-menu-divider {
  height: 1px;
  background: var(--border-color);
  margin: 4px 0;
}

.context-menu-submenu {
  position: relative;
}

.context-menu-item.has-submenu {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.context-menu-submenu .submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  min-width: 180px;
  padding: 4px;
  z-index: 10002;
}

.context-menu-submenu:hover .submenu {
  display: block;
}

.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
}

/* Search navigation */
.search-nav {
  display: flex;
  align-items: center;
  gap: 0.5rem;
}

.search-nav-btn,
.search-clear-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  padding: 0.25rem;
  cursor: pointer;
  color: var(--text-secondary);
  border-radius: 4px;
  transition: all 0.15s;
}

.search-nav-btn:hover:not(:disabled),
.search-clear-btn:hover {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.search-nav-btn:disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.match-counter {
  font-size: 0.8rem;
  color: var(--text-secondary);
  min-width: 70px;
  text-align: center;
  font-family: var(--font-mono);
}

/* Search highlight styles */
:deep(.search-match) {
  background-color: rgba(255, 200, 0, 0.4);
  border-radius: 2px;
  padding: 0 2px;
  margin: 0 -2px;
}

:deep(.search-match.active) {
  background-color: rgba(255, 150, 0, 0.7);
  outline: 2px solid var(--accent-color);
  outline-offset: 1px;
}
</style>
