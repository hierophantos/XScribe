/**
 * Library store - manages projects, tags, and transcription list
 */

import { defineStore } from 'pinia'
import { ref, computed } from 'vue'

// Types matching the preload/database types
interface Project {
  id: string
  name: string
  description: string | null
  color: string | null
  createdAt: string
  updatedAt: string
}

interface Tag {
  id: string
  name: string
  color: string | null
}

type TranscriptionStatus = 'pending' | 'processing' | 'completed' | 'failed'

interface Transcription {
  id: string
  projectId: string | null
  filePath: string
  fileName: string
  fileSize: number | null
  duration: number | null
  language: string | null
  modelUsed: string | null
  status: TranscriptionStatus
  error: string | null
  createdAt: string
  updatedAt: string
  completedAt: string | null
  tags?: Tag[]
}

interface Segment {
  id: number
  transcriptionId: string
  speakerId: string | null
  startTime: number
  endTime: number
  text: string
  confidence: number | null
}

interface SearchResult {
  transcriptionId: string
  transcription: Transcription
  matchingSegments: Array<{
    segment: Segment
    highlight: string
  }>
}

export const useLibraryStore = defineStore('library', () => {
  // State
  const projects = ref<Project[]>([])
  const tags = ref<Tag[]>([])
  const transcriptions = ref<Transcription[]>([])
  const selectedProjectId = ref<string | null>(null)
  const selectedTagIds = ref<string[]>([])
  const searchQuery = ref('')
  const searchResults = ref<SearchResult[]>([])
  const isLoading = ref(false)
  const error = ref<string | null>(null)

  // Computed
  const selectedProject = computed(() => {
    if (!selectedProjectId.value) return null
    return projects.value.find((p) => p.id === selectedProjectId.value) || null
  })

  const filteredTranscriptions = computed(() => {
    let result = transcriptions.value

    // Filter by project
    if (selectedProjectId.value !== null) {
      result = result.filter((t) => t.projectId === selectedProjectId.value)
    }

    // Filter by tags
    if (selectedTagIds.value.length > 0) {
      result = result.filter((t) =>
        selectedTagIds.value.some((tagId) => t.tags?.some((tag) => tag.id === tagId))
      )
    }

    return result
  })

  const recentTranscriptions = computed(() => {
    return [...transcriptions.value]
      .filter((t) => t.status === 'completed')
      .sort((a, b) => new Date(b.completedAt || b.createdAt).getTime() - new Date(a.completedAt || a.createdAt).getTime())
      .slice(0, 10)
  })

  const processingTranscriptions = computed(() => {
    return transcriptions.value.filter((t) => t.status === 'processing' || t.status === 'pending')
  })

  // Actions
  async function loadLibrary() {
    isLoading.value = true
    error.value = null

    try {
      const [projectsList, tagsList, transcriptionsList] = await Promise.all([
        window.electronAPI.db.projects.list(),
        window.electronAPI.db.tags.list(),
        window.electronAPI.db.transcriptions.list()
      ])

      projects.value = projectsList
      tags.value = tagsList
      transcriptions.value = transcriptionsList
    } catch (err) {
      console.error('[LibraryStore] Failed to load library:', err)
      error.value = err instanceof Error ? err.message : 'Failed to load library'
    } finally {
      isLoading.value = false
    }
  }

  async function refreshTranscriptions() {
    try {
      transcriptions.value = await window.electronAPI.db.transcriptions.list()
    } catch (err) {
      console.error('[LibraryStore] Failed to refresh transcriptions:', err)
    }
  }

  // Project actions
  async function createProject(name: string, description?: string, color?: string) {
    try {
      const project = await window.electronAPI.db.projects.create({ name, description, color })
      projects.value.push(project)
      return project
    } catch (err) {
      console.error('[LibraryStore] Failed to create project:', err)
      throw err
    }
  }

  async function updateProject(id: string, data: { name?: string; description?: string | null; color?: string | null }) {
    try {
      const updated = await window.electronAPI.db.projects.update(id, data)
      if (updated) {
        const index = projects.value.findIndex((p) => p.id === id)
        if (index !== -1) {
          projects.value[index] = updated
        }
      }
      return updated
    } catch (err) {
      console.error('[LibraryStore] Failed to update project:', err)
      throw err
    }
  }

  async function deleteProject(id: string) {
    try {
      await window.electronAPI.db.projects.delete(id)
      projects.value = projects.value.filter((p) => p.id !== id)

      // Clear selection if deleted
      if (selectedProjectId.value === id) {
        selectedProjectId.value = null
      }

      // Refresh transcriptions as some may have had their projectId set to null
      await refreshTranscriptions()
    } catch (err) {
      console.error('[LibraryStore] Failed to delete project:', err)
      throw err
    }
  }

  function selectProject(id: string | null) {
    selectedProjectId.value = id
  }

  // Tag actions
  async function createTag(name: string, color?: string) {
    try {
      const tag = await window.electronAPI.db.tags.create(name, color)
      tags.value.push(tag)
      return tag
    } catch (err) {
      console.error('[LibraryStore] Failed to create tag:', err)
      throw err
    }
  }

  async function deleteTag(id: string) {
    try {
      await window.electronAPI.db.tags.delete(id)
      tags.value = tags.value.filter((t) => t.id !== id)
      selectedTagIds.value = selectedTagIds.value.filter((tid) => tid !== id)

      // Refresh transcriptions to update their tags
      await refreshTranscriptions()
    } catch (err) {
      console.error('[LibraryStore] Failed to delete tag:', err)
      throw err
    }
  }

  async function addTagToTranscription(transcriptionId: string, tagId: string) {
    try {
      await window.electronAPI.db.tags.addToTranscription(transcriptionId, tagId)

      // Update local state
      const transcription = transcriptions.value.find((t) => t.id === transcriptionId)
      const tag = tags.value.find((t) => t.id === tagId)
      if (transcription && tag) {
        if (!transcription.tags) {
          transcription.tags = []
        }
        if (!transcription.tags.some((t) => t.id === tagId)) {
          transcription.tags.push(tag)
        }
      }
    } catch (err) {
      console.error('[LibraryStore] Failed to add tag to transcription:', err)
      throw err
    }
  }

  async function removeTagFromTranscription(transcriptionId: string, tagId: string) {
    try {
      await window.electronAPI.db.tags.removeFromTranscription(transcriptionId, tagId)

      // Update local state
      const transcription = transcriptions.value.find((t) => t.id === transcriptionId)
      if (transcription?.tags) {
        transcription.tags = transcription.tags.filter((t) => t.id !== tagId)
      }
    } catch (err) {
      console.error('[LibraryStore] Failed to remove tag from transcription:', err)
      throw err
    }
  }

  function toggleTagFilter(tagId: string) {
    const index = selectedTagIds.value.indexOf(tagId)
    if (index === -1) {
      selectedTagIds.value.push(tagId)
    } else {
      selectedTagIds.value.splice(index, 1)
    }
  }

  // Transcription actions
  async function deleteTranscription(id: string) {
    try {
      await window.electronAPI.db.transcriptions.delete(id)
      transcriptions.value = transcriptions.value.filter((t) => t.id !== id)
    } catch (err) {
      console.error('[LibraryStore] Failed to delete transcription:', err)
      throw err
    }
  }

  async function moveTranscriptionToProject(transcriptionId: string, projectId: string | null) {
    try {
      await window.electronAPI.db.transcriptions.update(transcriptionId, { projectId })

      // Update local state
      const transcription = transcriptions.value.find((t) => t.id === transcriptionId)
      if (transcription) {
        transcription.projectId = projectId
      }
    } catch (err) {
      console.error('[LibraryStore] Failed to move transcription:', err)
      throw err
    }
  }

  // Search
  async function search(query: string) {
    searchQuery.value = query

    if (!query.trim()) {
      searchResults.value = []
      return
    }

    try {
      searchResults.value = await window.electronAPI.db.transcriptions.search(query)
    } catch (err) {
      console.error('[LibraryStore] Search failed:', err)
      searchResults.value = []
    }
  }

  function clearSearch() {
    searchQuery.value = ''
    searchResults.value = []
  }

  // Update transcription in local state (used by transcription events)
  function updateTranscriptionLocally(id: string, updates: Partial<Transcription>) {
    const index = transcriptions.value.findIndex((t) => t.id === id)
    if (index !== -1) {
      transcriptions.value[index] = { ...transcriptions.value[index], ...updates }
    }
  }

  function addTranscriptionLocally(transcription: Transcription) {
    // Add at the beginning since it's most recent
    transcriptions.value.unshift(transcription)
  }

  return {
    // State
    projects,
    tags,
    transcriptions,
    selectedProjectId,
    selectedTagIds,
    searchQuery,
    searchResults,
    isLoading,
    error,

    // Computed
    selectedProject,
    filteredTranscriptions,
    recentTranscriptions,
    processingTranscriptions,

    // Actions
    loadLibrary,
    refreshTranscriptions,
    createProject,
    updateProject,
    deleteProject,
    selectProject,
    createTag,
    deleteTag,
    addTagToTranscription,
    removeTagFromTranscription,
    toggleTagFilter,
    deleteTranscription,
    moveTranscriptionToProject,
    search,
    clearSearch,
    updateTranscriptionLocally,
    addTranscriptionLocally
  }
})
