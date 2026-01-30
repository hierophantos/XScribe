<script setup lang="ts">
defineProps<{
  percent: number
  label?: string
}>()

function formatPercent(value: number): string {
  return `${Math.round(value)}%`
}
</script>

<template>
  <div class="progress-container">
    <div v-if="label" class="progress-label">{{ label }}</div>
    <div class="progress-bar">
      <div class="progress-fill" :style="{ width: `${Math.min(100, Math.max(0, percent))}%` }"></div>
    </div>
    <div class="progress-text">{{ formatPercent(percent) }}</div>
  </div>
</template>

<style scoped>
.progress-container {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  width: 100%;
  max-width: 400px;
}

.progress-label {
  font-size: 0.875rem;
  color: var(--text-secondary);
  text-align: center;
}

.progress-bar {
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

.progress-text {
  font-size: 0.75rem;
  color: var(--text-tertiary);
  text-align: center;
  font-variant-numeric: tabular-nums;
}
</style>
