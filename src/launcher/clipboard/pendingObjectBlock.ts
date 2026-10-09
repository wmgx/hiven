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

type PendingListener = (block: LauncherObjectBlock) => boolean | void

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
): boolean {
  const record: PendingRecord = { block, createdAt: Date.now() }
  memoryPending = record
  if (options?.persist) {
    try {
      localStorage.setItem(PENDING_KEY, JSON.stringify(record))
    } catch (error) {
      console.warn('[hiven] Failed to persist pending object block:', error)
    }
  } else {
    // A new in-memory handoff supersedes this window's previous persisted backup.
    try { localStorage.removeItem(PENDING_KEY) } catch { /* memory remains usable */ }
  }
  if (options?.silent) return false
  let accepted = false
  // Notify already-mounted launcher hooks (stack path keeps open=true)
  for (const listener of listeners) {
    try {
      if (listener(block) === true) accepted = true
    } catch (error) {
      console.warn('[hiven] Pending object block listener failed:', error)
    }
  }
  return accepted
}

export function consumePendingObjectBlock(ttlMs: number = DEFAULT_TTL_MS): LauncherObjectBlock | null {
  const memory = memoryPending
  memoryPending = null
  // Another webview can replace the shared record while this window retains an
  // older silent backup. Read shared storage before clearing either candidate.
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return memory && isFresh(memory, ttlMs) ? memory.block : null
    if (localStorage.getItem(PENDING_KEY) === raw) localStorage.removeItem(PENDING_KEY)
    const parsed = JSON.parse(raw) as PendingRecord
    if (!parsed?.block || typeof parsed.createdAt !== 'number') return null
    if (!isFresh(parsed, ttlMs)) return null
    return memory && JSON.stringify(memory) === raw ? memory.block : parsed.block
  } catch (error) {
    console.warn('[hiven] Failed to consume pending object block:', error)
    return memory && isFresh(memory, ttlMs) ? memory.block : null
  }
}

export function clearPendingObjectBlock(expected?: LauncherObjectBlock): void {
  const matches = (block: LauncherObjectBlock | undefined) => !expected || Boolean(block &&
    block.id === expected.id && block.source === expected.source && block.createdAt === expected.createdAt)
  if (matches(memoryPending?.block)) memoryPending = null
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return
    const record = JSON.parse(raw) as PendingRecord
    if (matches(record?.block) && localStorage.getItem(PENDING_KEY) === raw) localStorage.removeItem(PENDING_KEY)
  } catch {
    // ignore
  }
}

export function peekPendingObjectBlock(ttlMs: number = DEFAULT_TTL_MS): LauncherObjectBlock | null {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return memoryPending && isFresh(memoryPending, ttlMs) ? memoryPending.block : null
    const parsed = JSON.parse(raw) as PendingRecord
    if (!parsed?.block || typeof parsed.createdAt !== 'number') return null
    if (!isFresh(parsed, ttlMs)) return null
    return memoryPending && JSON.stringify(memoryPending) === raw ? memoryPending.block : parsed.block
  } catch {
    return memoryPending && isFresh(memoryPending, ttlMs) ? memoryPending.block : null
  }
}
