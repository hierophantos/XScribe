<script setup lang="ts">
defineProps<{
  currentFile: string | null
  appVersion: string
}>()

const emit = defineEmits<{
  openFile: []
}>()
</script>

<template>
  <aside class="sidebar">
    <div class="sidebar-header">
      <div class="logo">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
          <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
          <line x1="12" y1="19" x2="12" y2="22"/>
        </svg>
        <span class="app-name">XScribe</span>
      </div>
    </div>

    <nav class="sidebar-nav">
      <button class="nav-item" @click="emit('openFile')">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14,2 14,8 20,8"/>
          <line x1="12" y1="18" x2="12" y2="12"/>
          <line x1="9" y1="15" x2="15" y2="15"/>
        </svg>
        <span>Open File</span>
      </button>

      <button class="nav-item" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="1"/>
          <circle cx="12" cy="5" r="1"/>
          <circle cx="12" cy="19" r="1"/>
        </svg>
        <span>Recent Files</span>
      </button>

      <button class="nav-item" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="3"/>
          <path d="M12 1v6M12 17v6M4.22 4.22l4.24 4.24M15.54 15.54l4.24 4.24M1 12h6M17 12h6M4.22 19.78l4.24-4.24M15.54 8.46l4.24-4.24"/>
        </svg>
        <span>Settings</span>
      </button>
    </nav>

    <div class="sidebar-footer">
      <div class="status-indicator">
        <span class="status-dot"></span>
        <span>Models Ready</span>
      </div>
      <span class="version">v{{ appVersion || '0.1.0' }}</span>
    </div>
  </aside>
</template>

<style scoped>
.sidebar {
  width: 220px;
  display: flex;
  flex-direction: column;
  background: var(--bg-secondary);
  border-right: 1px solid var(--border-color);
  -webkit-app-region: drag;
}

.sidebar-header {
  padding: 1rem;
  padding-top: 2.5rem; /* Account for traffic lights on macOS */
}

.logo {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  color: var(--accent-color);
}

.app-name {
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--text-primary);
}

.sidebar-nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  padding: 0.5rem;
  gap: 0.25rem;
  -webkit-app-region: no-drag;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.6rem 0.75rem;
  background: transparent;
  border: none;
  border-radius: 6px;
  color: var(--text-secondary);
  font-size: 0.875rem;
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
}

.nav-item:hover:not(:disabled) {
  background: var(--bg-hover);
  color: var(--text-primary);
}

.nav-item:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.sidebar-footer {
  padding: 1rem;
  border-top: 1px solid var(--border-color);
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  -webkit-app-region: no-drag;
}

.status-indicator {
  display: flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
  color: var(--text-secondary);
}

.status-dot {
  width: 8px;
  height: 8px;
  background: #22c55e;
  border-radius: 50%;
}

.version {
  font-size: 0.7rem;
  color: var(--text-muted);
  font-family: var(--font-mono);
}
</style>
