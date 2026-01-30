/**
 * Pinia store setup
 */

import { createPinia } from 'pinia'

export const pinia = createPinia()

// Re-export stores for convenience
export * from './library'
export * from './transcription'
export * from './ui'
