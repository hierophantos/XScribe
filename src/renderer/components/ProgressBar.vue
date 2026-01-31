<script setup lang="ts">
import { computed } from 'vue'

const props = defineProps<{
  percent: number
  label?: string
}>()

// Check if we're in indeterminate mode (percent < 0)
const isIndeterminate = computed(() => props.percent < 0)

function formatPercent(value: number): string {
  if (value < 0) return 'Downloading...'
  return `${Math.round(value)}%`
}
</script>

<template>
  <div class="progress-container">
    <div v-if="label" class="progress-label">{{ label }}</div>
    <div class="progress-bar" :class="{ indeterminate: isIndeterminate }">
      <div
        v-if="!isIndeterminate"
        class="progress-fill"
        :style="{ width: `${Math.min(100, Math.max(0, percent))}%` }"
      ></div>
      <div v-else class="progress-fill-indeterminate"></div>
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

/* Indeterminate progress animation */
.progress-bar.indeterminate {
  overflow: hidden;
}

.progress-fill-indeterminate {
  height: 100%;
  width: 30%;
  background: var(--accent-color);
  border-radius: 4px;
  animation: indeterminate 1.5s ease-in-out infinite;
}

@keyframes indeterminate {
  0% {
    transform: translateX(-100%);
  }
  50% {
    transform: translateX(250%);
  }
  100% {
    transform: translateX(-100%);
  }
}
</style>
