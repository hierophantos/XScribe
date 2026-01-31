/**
 * UI store - manages modals, toasts, and general UI state
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

type ModalType =
  | 'createProject'
  | 'editProject'
  | 'deleteProject'
  | 'createTag'
  | 'deleteTag'
  | 'deleteTranscription'
  | 'transcriptionDetails'
  | 'export'
  | 'settings'
  | null

interface Toast {
  id: string
  type: 'success' | 'error' | 'warning' | 'info'
  message: string
  duration?: number
}

type ViewMode = 'library' | 'transcription'

interface ModalData {
  projectId?: string
  tagId?: string
  transcriptionId?: string
}

// Load font size from localStorage or use default
function getInitialFontSize(): number {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('transcriptFontSize')
    if (stored) {
      const size = parseInt(stored, 10)
      if (size >= 12 && size <= 24) return size
    }
  }
  return 16 // Default font size
}

// Apply font size to CSS variable
function applyFontSize(size: number): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--transcript-font-size', `${size}px`)
  }
}

export const useUIStore = defineStore('ui', () => {
  // State
  const activeModal = ref<ModalType>(null)
  const modalData = ref<ModalData>({})
  const toasts = ref<Toast[]>([])
  const viewMode = ref<ViewMode>('library')
  const sidebarCollapsed = ref(false)
  const isDraggingFile = ref(false)
  const transcriptFontSize = ref(getInitialFontSize())

  // Search highlighting state
  const activeSearchTerm = ref<string | null>(null)
  const activeMatchIndex = ref(0)
  const totalMatches = ref(0)

  // Initialize font size on creation
  applyFontSize(transcriptFontSize.value)

  // Computed
  const hasActiveModal = computed(() => activeModal.value !== null)

  // Modal actions
  function openModal(type: ModalType, data: ModalData = {}) {
    activeModal.value = type
    modalData.value = data
  }

  function closeModal() {
    activeModal.value = null
    modalData.value = {}
  }

  // Toast actions
  function showToast(type: Toast['type'], message: string, duration = 5000) {
    const id = `toast-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
    const toast: Toast = { id, type, message, duration }
    toasts.value.push(toast)

    if (duration > 0) {
      setTimeout(() => {
        removeToast(id)
      }, duration)
    }

    return id
  }

  function removeToast(id: string) {
    const index = toasts.value.findIndex((t) => t.id === id)
    if (index !== -1) {
      toasts.value.splice(index, 1)
    }
  }

  function clearToasts() {
    toasts.value = []
  }

  // Convenience toast methods
  function showSuccess(message: string) {
    return showToast('success', message)
  }

  function showError(message: string) {
    return showToast('error', message, 8000) // Errors stay longer
  }

  function showWarning(message: string) {
    return showToast('warning', message)
  }

  function showInfo(message: string) {
    return showToast('info', message)
  }

  // View mode
  function setViewMode(mode: ViewMode) {
    viewMode.value = mode
  }

  function toggleSidebar() {
    sidebarCollapsed.value = !sidebarCollapsed.value
  }

  // Drag state
  function setDraggingFile(isDragging: boolean) {
    isDraggingFile.value = isDragging
  }

  // Font size actions
  function setTranscriptFontSize(size: number) {
    const clampedSize = Math.max(12, Math.min(24, size))
    transcriptFontSize.value = clampedSize
    applyFontSize(clampedSize)
    localStorage.setItem('transcriptFontSize', String(clampedSize))
  }

  function increaseFontSize() {
    setTranscriptFontSize(transcriptFontSize.value + 2)
  }

  function decreaseFontSize() {
    setTranscriptFontSize(transcriptFontSize.value - 2)
  }

  // Search highlighting actions
  function setSearchContext(term: string | null) {
    activeSearchTerm.value = term
    activeMatchIndex.value = 0
    totalMatches.value = 0
  }

  function clearSearchContext() {
    activeSearchTerm.value = null
    activeMatchIndex.value = 0
    totalMatches.value = 0
  }

  function setTotalMatches(count: number) {
    totalMatches.value = count
  }

  function nextMatch() {
    if (totalMatches.value > 0) {
      activeMatchIndex.value = (activeMatchIndex.value + 1) % totalMatches.value
    }
  }

  function prevMatch() {
    if (totalMatches.value > 0) {
      activeMatchIndex.value = (activeMatchIndex.value - 1 + totalMatches.value) % totalMatches.value
    }
  }

  return {
    // State
    activeModal,
    modalData,
    toasts,
    viewMode,
    sidebarCollapsed,
    isDraggingFile,
    transcriptFontSize,

    // Computed
    hasActiveModal,

    // Modal actions
    openModal,
    closeModal,

    // Toast actions
    showToast,
    removeToast,
    clearToasts,
    showSuccess,
    showError,
    showWarning,
    showInfo,

    // View mode
    setViewMode,
    toggleSidebar,

    // Drag state
    setDraggingFile,

    // Font size
    setTranscriptFontSize,
    increaseFontSize,
    decreaseFontSize,

    // Search highlighting
    activeSearchTerm,
    activeMatchIndex,
    totalMatches,
    setSearchContext,
    clearSearchContext,
    setTotalMatches,
    nextMatch,
    prevMatch
  }
})
