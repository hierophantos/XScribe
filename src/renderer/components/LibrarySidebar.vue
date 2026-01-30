<script setup lang="ts">
import { ref, computed } from 'vue'
import { useLibraryStore } from '../stores/library'
import { useUIStore } from '../stores/ui'

const libraryStore = useLibraryStore()
const uiStore = useUIStore()

const searchInput = ref('')
const showProjects = ref(true)
const showRecent = ref(true)

const displayedTranscriptions = computed(() => {
  if (searchInput.value.trim()) {
    return libraryStore.searchResults.map((r) => r.transcription)
  }
  return libraryStore.recentTranscriptions
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
    default:
      return ''
  }
}

defineEmits<{
  (e: 'select-transcription', id: string): void
  (e: 'new-transcription'): void
}>()
</script>

<template>
  <aside class="library-sidebar">
    <!-- Search -->
    <div class="search-container">
      <input
        v-model="searchInput"
        type="text"
        placeholder="Search transcripts..."
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

    <!-- Recent Section -->
    <div class="section">
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
          @click="$emit('select-transcription', transcription.id)"
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
        >
          <div class="transcription-info">
            <span class="transcription-name">{{ transcription.fileName }}</span>
            <div class="progress-bar">
              <div class="progress-fill"></div>
            </div>
          </div>
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
  color: var(--text-tertiary);
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
  color: var(--text-tertiary);
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
  color: var(--text-tertiary);
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
  color: var(--text-tertiary);
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
  display: block;
  width: 100%;
  padding: 0.5rem 0.75rem;
  background: none;
  border: none;
  border-radius: 6px;
  cursor: pointer;
  text-align: left;
}

.transcription-item:hover {
  background: var(--bg-tertiary);
}

.transcription-info {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
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
  color: var(--text-tertiary);
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
  color: var(--text-tertiary);
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
  color: var(--text-tertiary);
  cursor: pointer;
}

.settings-btn:hover {
  background: var(--bg-tertiary);
  color: var(--text-primary);
}
</style>
