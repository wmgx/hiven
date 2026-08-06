/**
 * Pending Object Block bridge — delivers a history-item (or other) block into
 * Global Launcher across surface leave / window open, without racing readClipboard.
 */

import type { LauncherObjectBlock } from './objectBlock'

const PENDING_KEY = 'hiven-pending-object-block'
/** Long enough for hide-history → show-launcher across separate webviews. */
const DEFAULT_TTL_MS = 60_000

type PendingRecord = {
  block: LauncherObjectBlock
  createdAt: number
}

type PendingListener = (block: LauncherObjectBlock) => void

let memoryPending: PendingRecord | null = null
const listeners = new Set<PendingListener>()

function isFresh(record: PendingRecord, ttlMs: number): boolean {
  return Date.now() - record.createdAt <= ttlMs
}

/** Live subscribers (already-open launcher) receive the block immediately. */
export function subscribePendingObjectBlock(listener: PendingListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function setPendingObjectBlock(
  block: LauncherObjectBlock,
  options?: {
    persist?: boolean
    ttlMs?: number
    /** Skip live listeners (re-stash / persist-only; avoid notify loops). */
    silent?: boolean
  },
): void {
  const record: PendingRecord = { block, createdAt: Date.now() }
  memoryPending = record
  if (options?.persist) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(record))
    } catch (error) {
      console.warn('[hiven] Failed to persist pending object block:', error)
    }
  }
  if (options?.silent) return
  // Notify already-mounted launcher hooks (stack path keeps open=true)
  for (const listener of listeners) {
    try {
      listener(block)
    } catch (error) {
      console.warn('[hiven] Pending object block listener failed:', error)
    }
  }
}

export function consumePendingObjectBlock(ttlMs: number = DEFAULT_TTL_MS): LauncherObjectBlock | null {
  // Memory first (same webview / stack path)
  if (memoryPending) {
    const record = memoryPending
    memoryPending = null
    try {
      localStorage.removeItem(PENDING_KEY)
    } catch {
      // ignore
    }
    return isFresh(record, ttlMs) ? record.block : null
  }

  // Cross-webview fallback
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    localStorage.removeItem(PENDING_KEY)
    const parsed = JSON.parse(raw) as PendingRecord
    if (!parsed?.block || typeof parsed.createdAt !== 'number') return null
    if (!isFresh(parsed, ttlMs)) return null
    return parsed.block
  } catch (error) {
    console.warn('[hiven] Failed to consume pending object block:', error)
    return null
  }
}

export function clearPendingObjectBlock(): void {
  memoryPending = null
  try {
    localStorage.removeItem(PENDING_KEY)
  } catch {
    // ignore
  }
}

export function peekPendingObjectBlock(ttlMs: number = DEFAULT_TTL_MS): LauncherObjectBlock | null {
  if (memoryPending && isFresh(memoryPending, ttlMs)) return memoryPending.block
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PendingRecord
    if (!parsed?.block || typeof parsed.createdAt !== 'number') return null
    if (!isFresh(parsed, ttlMs)) return null
    return parsed.block
  } catch {
    return null
  }
}
