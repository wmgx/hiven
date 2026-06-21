/**
 * Clipboard History Plugin — In-Memory Index Cache
 *
 * Module-level singleton shared between background and surface within the same
 * renderer process. Background keeps it warm on every write; Surface reads it
 * synchronously on mount to skip the first IPC round-trip.
 */

import type { ClipboardHistoryIndex } from './clipboardHistoryTypes'

let cachedIndex: ClipboardHistoryIndex | null = null
const listeners = new Set<(index: ClipboardHistoryIndex | null) => void>()

/** Read the cached index (null if never warmed). */
export function getCachedIndex(): ClipboardHistoryIndex | null {
  return cachedIndex
}

/** Warm/update the cache. Called by repository after every mutation. */
export function setCachedIndex(index: ClipboardHistoryIndex): void {
  cachedIndex = index
  for (const listener of listeners) {
    listener(cachedIndex)
  }
}

/** Clear the cache (e.g. on clearAll). */
export function clearCachedIndex(): void {
  cachedIndex = null
  for (const listener of listeners) {
    listener(cachedIndex)
  }
}

/** Subscribe to cache changes from already-mounted surfaces. */
export function subscribeCachedIndex(listener: (index: ClipboardHistoryIndex | null) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
