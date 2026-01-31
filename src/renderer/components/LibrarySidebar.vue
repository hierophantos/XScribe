<script setup lang="ts">
import { ref, computed } from 'vue'
import { useLibraryStore } from '../stores/library'
import { useUIStore } from '../stores/ui'
import { useTranscriptionStore } from '../stores/transcription'

const libraryStore = useLibraryStore()
const uiStore = useUIStore()
const transcriptionStore = useTranscriptionStore()

const searchInput = ref('')
const showProjects = ref(true)
const showRecent = ref(true)

const displayedTranscriptions = computed(() => {
  if (searchInput.value.trim()) {
    return libraryStore.searchResults.map((r) => r.transcription)
  }
  return libraryStore.recentTranscriptions
})

// Pending items that are NOT currently being processed (those show in Processing section)
const waitingPendingItems = computed(() => {
  return transcriptionStore.pendingQueue.filter(
    item => item.id !== transcriptionStore.currentProcessingId
  )
})

function handleSearch() {
  if (searchInput.value.trim()) {
    libraryStore.search(searchInput.value)
  } else {
    libraryStore.clearSearch()
  }
}

function selectProject(projectId: string | null) {
  libraryStore.selectProject(projectId)
}

function formatDuration(seconds: number | null): string {
  if (!seconds) return '--:--'
  const mins = Math.floor(seconds / 60)
  const secs = Math.floor(seconds % 60)
  return `${mins}:${secs.toString().padStart(2, '0')}`
}

function formatDate(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  // Less than 24 hours
  if (diff < 86400000) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Less than 7 days
  if (diff < 604800000) {
    return date.toLocaleDateString([], { weekday: 'short' })
  }

  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function getStatusIcon(status: string) {
  switch (status) {
    case 'completed':
      return '✓'
    case 'processing':
      return '⏳'
    case 'pending':
      return '⋯'
    case 'failed':
      return '✕'
    case 'cancelled':
      return '⊘'
    default:
      return ''
  }
}

async function cancelTranscription(transcriptionId: string) {
  try {
    await window.electronAPI.transcribe.cancel(transcriptionId)
  } catch (err) {
    console.error('Failed to cancel transcription:', err)
  }
}

async function cancelPendingItem(id: string) {
  try {
    await transcriptionStore.removeFromQueue(id)
  } catch (err) {
    console.error('Failed to cancel pending item:', err)
  }
}

// Context menu state for transcriptions
interface Transcription {
  id: string
  fileName: string
  status: string
  duration: number | null
  createdAt: string
  completedAt: string | null
}

const contextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  transcriptionId: null as string | null
})

// Context menu state for projects
const projectContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  projectId: null as string | null
})

// Context menu state for pending items
const pendingContextMenu = ref({
  visible: false,
  x: 0,
  y: 0,
  pendingId: null as string | null, // null means header was right-clicked (show only "Cancel All")
  isCurrentlyProcessing: false
})

function showContextMenu(event: MouseEvent, transcription: Transcription) {
  event.preventDefault()
  // Don't show context menu for processing items
  if (transcription.status === 'processing' || transcription.status === 'pending') {
    return
  }
  contextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    transcriptionId: transcription.id
  }
}

function hideContextMenu() {
  contextMenu.value.visible = false
  contextMenu.value.transcriptionId = null
}

async function deleteTranscription() {
  if (!contextMenu.value.transcriptionId) return
  try {
    await libraryStore.deleteTranscription(contextMenu.value.transcriptionId)
  } catch (err) {
    console.error('Failed to delete transcription:', err)
  }
  hideContextMenu()
}

// Project context menu functions
function showProjectContextMenu(event: MouseEvent, projectId: string) {
  event.preventDefault()
  projectContextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    projectId
  }
}

function hideProjectContextMenu() {
  projectContextMenu.value.visible = false
  projectContextMenu.value.projectId = null
}

function editProject() {
  if (!projectContextMenu.value.projectId) return
  uiStore.openModal('editProject', { projectId: projectContextMenu.value.projectId })
  hideProjectContextMenu()
}

async function exportProjectAs(format: string) {
  if (!projectContextMenu.value.projectId) return

  try {
    const result = await window.electronAPI.export.project(
      projectContextMenu.value.projectId,
      format
    )
    if (result) {
      uiStore.showSuccess(`Exported ${result.count} files to folder`)
    }
  } catch (err) {
    uiStore.showError(err instanceof Error ? err.message : 'Export failed')
  }
  hideProjectContextMenu()
}

// Pending context menu functions
function showPendingContextMenu(event: MouseEvent, pendingId: string | null = null, isCurrentlyProcessing: boolean = false) {
  event.preventDefault()
  pendingContextMenu.value = {
    visible: true,
    x: event.clientX,
    y: event.clientY,
    pendingId,
    isCurrentlyProcessing
  }
}

function hidePendingContextMenu() {
  pendingContextMenu.value.visible = false
  pendingContextMenu.value.pendingId = null
  pendingContextMenu.value.isCurrentlyProcessing = false
}

async function cancelPendingFromMenu() {
  if (!pendingContextMenu.value.pendingId) return
  try {
    await transcriptionStore.removeFromQueue(pendingContextMenu.value.pendingId)
  } catch (err) {
    console.error('Failed to cancel pending item:', err)
  }
  hidePendingContextMenu()
}

async function cancelAllPending() {
  try {
    await transcriptionStore.clearQueue()
  } catch (err) {
    console.error('Failed to cancel all pending:', err)
  }
  hidePendingContextMenu()
}

const emit = defineEmits<{
  (e: 'select-transcription', id: string): void
  (e: 'select-processing', id: string): void
  (e: 'new-transcription'): void
}>()

// Select a transcription, preserving search context if searching
function selectTranscription(transcriptionId: string) {
  // Save search context if we're currently searching
  if (searchInput.value.trim()) {
    uiStore.setSearchContext(searchInput.value.trim())
  } else {
    uiStore.clearSearchContext()
  }
  emit('select-transcription', transcriptionId)
}
</script>

<template>
  <aside class="library-sidebar">
    <!-- Search -->
    <div class="search-container">
      <input
        v-model="searchInput"
        type="text"
        :placeholder="libraryStore.selectedProject ? `Search in ${libraryStore.selectedProject.name}...` : 'Search transcripts...'"
        class="search-input"
        @input="handleSearch"
      />
      <svg
        v-if="!searchInput"
        class="search-icon"
        width="16"
        height="16"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
      >
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
      <button v-else class="clear-search" @click="searchInput = ''; libraryStore.clearSearch()">
        ✕
      </button>
    </div>

    <!-- New Transcription Button -->
    <button class="new-transcription-btn" @click="$emit('new-transcription')">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M12 5v14M5 12h14" />
      </svg>
      New Transcription
    </button>

    <!-- Projects Section -->
    <div class="section">
      <button class="section-header" @click="showProjects = !showProjects">
        <svg
          class="chevron"
          :class="{ collapsed: !showProjects }"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span>Projects</span>
        <span class="count">{{ libraryStore.projects.length }}</span>
      </button>

      <div v-show="showProjects" class="section-content">
        <button
          class="project-item"
          :class="{ active: libraryStore.selectedProjectId === null }"
          @click="selectProject(null)"
        >
          <span class="project-icon">📁</span>
          <span class="project-name">All Transcriptions</span>
        </button>

        <button
          v-for="project in libraryStore.projects"
          :key="project.id"
          class="project-item"
          :class="{ active: libraryStore.selectedProjectId === project.id }"
          @click="selectProject(project.id)"
          @contextmenu="showProjectContextMenu($event, project.id)"
        >
          <span
            class="project-dot"
            :style="{ backgroundColor: project.color || 'var(--text-tertiary)' }"
          ></span>
          <span class="project-name">{{ project.name }}</span>
        </button>

        <button class="add-project-btn" @click="uiStore.openModal('createProject')">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Add Project
        </button>
      </div>
    </div>

    <!-- Project Transcriptions Section (when a project is selected) -->
    <div v-if="libraryStore.selectedProjectId" class="section">
      <button class="section-header" @click="showRecent = !showRecent">
        <svg
          class="chevron"
          :class="{ collapsed: !showRecent }"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span>{{ searchInput ? 'Search Results' : libraryStore.selectedProject?.name || 'Project' }}</span>
        <span class="count">{{ searchInput ? displayedTranscriptions.length : libraryStore.projectTranscriptions.length }}</span>
      </button>

      <div v-show="showRecent" class="section-content transcription-list">
        <div v-if="searchInput ? displayedTranscriptions.length === 0 : libraryStore.projectTranscriptions.length === 0" class="empty-list">
          {{ searchInput ? 'No results found' : 'No transcriptions in this project' }}
        </div>

        <button
          v-for="transcription in (searchInput ? displayedTranscriptions : libraryStore.projectTranscriptions)"
          :key="transcription.id"
          class="transcription-item"
          @click="selectTranscription(transcription.id)"
          @contextmenu="showContextMenu($event, transcription)"
        >
          <div class="transcription-info">
            <span class="transcription-name">{{ transcription.fileName }}</span>
            <span class="transcription-meta">
              <span class="status-icon" :class="transcription.status">
                {{ getStatusIcon(transcription.status) }}
              </span>
              <span>{{ formatDuration(transcription.duration) }}</span>
              <span class="separator">·</span>
              <span>{{ formatDate(transcription.completedAt || transcription.createdAt) }}</span>
            </span>
          </div>
        </button>
      </div>
    </div>

    <!-- Recent Section (when no project selected) -->
    <div v-else class="section">
      <button class="section-header" @click="showRecent = !showRecent">
        <svg
          class="chevron"
          :class="{ collapsed: !showRecent }"
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
        <span>{{ searchInput ? 'Search Results' : 'Recent' }}</span>
        <span class="count">{{ displayedTranscriptions.length }}</span>
      </button>

      <div v-show="showRecent" class="section-content transcription-list">
        <div v-if="displayedTranscriptions.length === 0" class="empty-list">
          {{ searchInput ? 'No results found' : 'No transcriptions yet' }}
        </div>

        <button
          v-for="transcription in displayedTranscriptions"
          :key="transcription.id"
          class="transcription-item"
          @click="selectTranscription(transcription.id)"
          @contextmenu="showContextMenu($event, transcription)"
        >
          <div class="transcription-info">
            <span class="transcription-name">{{ transcription.fileName }}</span>
            <span class="transcription-meta">
              <span class="status-icon" :class="transcription.status">
                {{ getStatusIcon(transcription.status) }}
              </span>
              <span>{{ formatDuration(transcription.duration) }}</span>
              <span class="separator">·</span>
              <span>{{ formatDate(transcription.completedAt || transcription.createdAt) }}</span>
            </span>
          </div>
        </button>
      </div>
    </div>

    <!-- Processing Section (if any) -->
    <div v-if="libraryStore.processingTranscriptions.length > 0" class="section">
      <div class="section-header">
        <span class="processing-indicator"></span>
        <span>Processing</span>
        <span class="count">{{ libraryStore.processingTranscriptions.length }}</span>
      </div>

      <div class="section-content">
        <div
          v-for="transcription in libraryStore.processingTranscriptions"
          :key="transcription.id"
          class="transcription-item processing"
          role="button"
          tabindex="0"
          @click="$emit('select-processing', transcription.id)"
          @keydown.enter="$emit('select-processing', transcription.id)"
        >
          <div class="transcription-info">
            <span class="transcription-name">{{ transcription.fileName }}</span>
            <div class="progress-bar">
              <div class="progress-fill"></div>
            </div>
          </div>
          <button
            class="cancel-btn"
            title="Cancel transcription"
            @click.stop="cancelTranscription(transcription.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Pending Queue Section (shows items waiting to be processed, not the current one) -->
    <div v-if="waitingPendingItems.length > 0" class="section">
      <div class="section-header" @contextmenu="showPendingContextMenu($event, null)">
        <span class="pending-indicator"></span>
        <span>Pending</span>
        <span class="count">{{ waitingPendingItems.length }}</span>
      </div>

      <div class="section-content pending-list">
        <div
          v-for="item in waitingPendingItems"
          :key="item.id"
          class="pending-item"
          @contextmenu="showPendingContextMenu($event, item.id, false)"
        >
          <div class="pending-info">
            <span class="pending-name">{{ item.fileName }}</span>
            <span class="pending-meta">
              <span v-if="item.duration" class="pending-duration">{{ formatDuration(item.duration) }}</span>
              <span class="pending-model">{{ item.queueModel }}</span>
            </span>
          </div>
          <button
            class="cancel-btn"
            title="Remove from queue"
            @click.stop="cancelPendingItem(item.id)"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
    </div>

    <!-- Footer -->
    <div class="sidebar-footer">
      <button class="settings-btn" @click="uiStore.openModal('settings')">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3" />
          <path
            d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"
          />
        </svg>
      </button>
    </div>

    <!-- Transcription Context Menu -->
    <Teleport to="body">
      <div
        v-if="contextMenu.visible"
        class="context-menu"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
        @click.stop
      >
        <button class="context-menu-item danger" @click="deleteTranscription">
          ❌ Remove Transcript
        </button>
      </div>
      <div
        v-if="contextMenu.visible"
        class="context-menu-overlay"
        @click="hideContextMenu"
      />
    </Teleport>

    <!-- Project Context Menu -->
    <Teleport to="body">
      <div
        v-if="projectContextMenu.visible"
        class="context-menu"
        :style="{ top: projectContextMenu.y + 'px', left: projectContextMenu.x + 'px' }"
        @click.stop
      >
        <button class="context-menu-item" @click="editProject">
          ✏️ Edit Project
        </button>
        <div class="context-menu-divider"></div>
        <div class="context-menu-submenu">
          <button class="context-menu-item has-submenu">
            📥 Export Project
            <svg class="chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="9 18 15 12 9 6" />
            </svg>
          </button>
          <div class="submenu">
            <button class="context-menu-item" @click="exportProjectAs('txt')">Plain Text (.txt)</button>
            <button class="context-menu-item" @click="exportProjectAs('srt')">SRT Subtitles (.srt)</button>
            <button class="context-menu-item" @click="exportProjectAs('vtt')">WebVTT (.vtt)</button>
            <button class="context-menu-item" @click="exportProjectAs('json')">JSON (.json)</button>
            <button class="context-menu-item" @click="exportProjectAs('docx')">Word Document (.docx)</button>
          </div>
        </div>
      </div>
      <div
        v-if="projectContextMenu.visible"
        class="context-menu-overlay"
        @click="hideProjectContextMenu"
      />
    </Teleport>

    <!-- Pending Context Menu -->
    <Teleport to="body">
      <div
        v-if="pendingContextMenu.visible"
        class="context-menu"
        :style="{ top: pendingContextMenu.y + 'px', left: pendingContextMenu.x + 'px' }"
        @click.stop
      >
        <button
          v-if="pendingContextMenu.pendingId && !pendingContextMenu.isCurrentlyProcessing"
          class="context-menu-item danger"
          @click="cancelPendingFromMenu"
        >
          ❌ Cancel Transcript
        </button>
        <button class="context-menu-item danger" @click="cancelAllPending">
          🗑️ Cancel All Pending
        </button>
      </div>
      <div
        v-if="pendingContextMenu.visible"
        class="context-menu-overlay"
        @click="hidePendingContextMenu"
      />
    </Teleport>
  </aside>
</template>

<style scoped>
.library-sidebar {
  width: 280px;
  height: 100vh;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.search-container {
  padding: 1rem;
  padding-top: 2.5rem; /* Account for traffic lights on macOS */
  position: relative;
  z-index: 10000; /* Above titlebar drag region */
}

.search-input {
  width: 100%;
  padding: 0.5rem 0.75rem;
  padding-left: 2rem;
  background: var(--bg-tertiary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
}

.search-input::placeholder {
  color: var(--text-muted);
}

.search-input:focus {
  outline: none;
  border-color: var(--accent-color);
}

.search-icon {
  position: absolute;
  left: 1.5rem;
  top: 50%;
  transform: translateY(-50%);
  color: var(--text-muted);
  margin-top: 0.75rem;
}

.clear-search {
  position: absolute;
  right: 1.5rem;
  top: 50%;
  transform: translateY(-50%);
  margin-top: 0.75rem;
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 0.25rem;
  font-size: 0.75rem;
}

.new-transcription-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  margin: 0 1rem 1rem;
  padding: 0.6rem;
  background: var(--accent-color);
  color: white;
  border: none;
  border-radius: 6px;
  font-weight: 500;
  cursor: pointer;
  transition: background 0.2s;
}

.new-transcription-btn:hover {
  background: var(--accent-hover);
}

.section {
  border-top: 1px solid var(--border-color);
}

.section-header {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.75rem 1rem;
  background: none;
  border: none;
  color: var(--text-secondary);
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  cursor: pointer;
  text-align: left;
}

.section-header:hover {
  color: var(--text-primary);
}

.chevron {
  transition: transform 0.2s;
}

.chevron.collapsed {
  transform: rotate(-90deg);
}

.count {
  margin-left: auto;
  background: var(--bg-tertiary);
  padding: 0.125rem 0.375rem;
  border-radius: 4px;
  font-size: 0.625rem;
}

.section-content {
  padding: 0 0.5rem 0.5rem;
}

.project-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-primary);
  font-size: 0.875rem;
  cursor: pointer;
  text-align: left;
}

.project-item:hover {
  background: var(--bg-tertiary);
}

.project-item.active {
  background: var(--accent-color);
  color: white;
}

.project-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
}

.project-icon {
  font-size: 0.875rem;
}

.project-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.add-project-btn {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: none;
  border: none;
  color: var(--text-muted);
  font-size: 0.8125rem;
  cursor: pointer;
  text-align: left;
}

.add-project-btn:hover {
  color: var(--accent-color);
}

.transcription-list {
  max-height: 300px;
  overflow-y: auto;
}

.transcription-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}

.transcription-item.processing {
  cursor: pointer;
}

.transcription-item:hover {
  background: var(--bg-tertiary);
}

.transcription-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  flex: 1;
  min-width: 0;
}

.transcription-name {
  font-size: 0.875rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transcription-meta {
  display: flex;
  align-items: center;
  gap: 0.375rem;
  font-size: 0.75rem;
  color: var(--text-muted);
}

.status-icon {
  font-size: 0.625rem;
}

.status-icon.completed {
  color: var(--success-color, #22c55e);
}

.status-icon.processing {
  color: var(--accent-color);
}

.status-icon.failed {
  color: var(--error-color, #ef4444);
}

.separator {
  opacity: 0.5;
}

.empty-list {
  padding: 1rem;
  text-align: center;
  color: var(--text-muted);
  font-size: 0.875rem;
}

.processing-indicator {
  width: 8px;
  height: 8px;
  background: var(--accent-color);
  border-radius: 50%;
  animation: pulse 1.5s ease-in-out infinite;
}

@keyframes pulse {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.5;
  }
}

.progress-bar {
  height: 4px;
  background: var(--bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
  margin-top: 0.25rem;
}

.progress-fill {
  height: 100%;
  width: 30%;
  background: var(--accent-color);
  border-radius: 2px;
  animation: progress 1.5s ease-in-out infinite;
}

@keyframes progress {
  0% {
    width: 0%;
    margin-left: 0;
  }
  50% {
    width: 50%;
    margin-left: 25%;
  }
  100% {
    width: 0%;
    margin-left: 100%;
  }
}

.sidebar-footer {
  margin-top: auto;
  padding: 1rem;
  border-top: 1px solid var(--border-color);
}

.settings-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  background: none;
  border: none;
  border-radius: 6px;
  color: var(--text-muted);
  cursor: pointer;
}

.settings-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}

.cancel-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  background: none;
  border: none;
  border-radius: 4px;
  color: var(--text-muted);
  cursor: pointer;
  flex-shrink: 0;
  opacity: 0.6;
  transition: opacity 0.2s, color 0.2s, background 0.2s;
}

.cancel-btn:hover {
  opacity: 1;
  color: var(--error-color, #ef4444);
  background: rgba(239, 68, 68, 0.1);
}

.status-icon.cancelled {
  color: var(--text-muted);
}

/* Context Menu */
.context-menu {
  position: fixed;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  z-index: 10001;
  min-width: 160px;
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

.context-menu-item.danger {
  color: var(--error-color, #ef4444);
}

.context-menu-item.danger:hover {
  background: rgba(239, 68, 68, 0.1);
}

.context-menu-overlay {
  position: fixed;
  inset: 0;
  z-index: 10000;
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

.context-menu-item.has-submenu .chevron {
  opacity: 0.5;
}

.context-menu-submenu .submenu {
  display: none;
  position: absolute;
  left: 100%;
  top: 0;
  background: var(--bg-secondary);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  min-width: 180px;
  padding: 4px;
  z-index: 10002;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.context-menu-submenu:hover .submenu {
  display: block;
}

/* Pending Queue Styles */
.pending-indicator {
  width: 8px;
  height: 8px;
  background: var(--text-muted);
  border-radius: 50%;
}

.pending-list {
  max-height: 200px;
  overflow-y: auto;
}

.pending-item {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-radius: 6px;
  background: var(--bg-tertiary);
  margin-bottom: 0.25rem;
}

.pending-item.is-current {
  background: rgba(99, 102, 241, 0.1);
  border: 1px solid rgba(99, 102, 241, 0.2);
}

.pending-info {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  flex: 1;
  min-width: 0;
}

.pending-name {
  font-size: 0.8125rem;
  color: var(--text-primary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pending-meta {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.6875rem;
  color: var(--text-muted);
}

.pending-duration {
  font-family: var(--font-mono);
}

.pending-model {
  background: var(--bg-secondary);
  padding: 0.0625rem 0.25rem;
  border-radius: 3px;
}

.pending-item .cancel-btn:disabled {
  opacity: 0.3;
  cursor: not-allowed;
}

.pending-item .cancel-btn:disabled:hover {
  color: var(--text-muted);
  background: none;
}
</style>
