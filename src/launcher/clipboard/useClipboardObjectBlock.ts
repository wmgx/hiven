/**
 * useClipboardObjectBlock — React hook for Global Launcher clipboard integration.
 *
 * Responsibilities:
 *  1. On launcher open: read system clipboard, build ClipboardSnapshot.
 *  2. Apply freshness rules to decide whether to auto-attach ObjectBlock.
 *  3. Expose Backspace one-shot remove with short exit transition.
 *  4. Expose mode: 'object-action' | 'search-only'.
 *  5. Expose recent clipboard hint when past fresh TTL (30s) but within 2 min.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LauncherObjectBlock, RecentClipboardHint } from './objectBlock'
import {
  buildRecentClipboardHint,
  createClipboardObjectBlock,
} from './objectBlock'
import { consumePendingObjectBlock, subscribePendingObjectBlock } from './pendingObjectBlock'
import {
  createClipboardSnapshotFromUnknownAge,
  dismissClipboardBlock,
  getLastClipboardSnapshot,
  hashClipboardText,
  isClipboardDismissed,
  observeClipboardText,
  updateClipboardSnapshot,
  type ClipboardSnapshot,
} from './clipboardSnapshot'
import { launcherPerfNow, logLauncherPerfDuration } from '../../workspace/launcher/perf'

/** Keep token mounted for compositor-only exit (opacity + transform). */
export const OBJECT_BLOCK_EXIT_MS = 130

export type ClipboardObjectBlockMode = 'object-action' | 'search-only'

export type ClipboardObjectBlockState = {
  mode: ClipboardObjectBlockMode
  block: LauncherObjectBlock | null
  /** True while the token plays its remove transition (block still rendered). */
  isExiting: boolean
  hint: RecentClipboardHint | null
  removeBlock: () => void
  selectBlockForDelete: () => void
  handleBackspace: (queryEmpty: boolean) => boolean
  attachHintAsBlock: () => void
}

export function useClipboardObjectBlock(params: {
  open: boolean
  readClipboard: () => Promise<string>
}): ClipboardObjectBlockState {
  const { open, readClipboard } = params
  const [block, setBlock] = useState<LauncherObjectBlock | null>(null)
  const [isExiting, setIsExiting] = useState(false)
  const [hint, setHint] = useState<RecentClipboardHint | null>(null)
  const didReadRef = useRef(false)
  const exitTimerRef = useRef<number | null>(null)

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current != null) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
  }, [])

  // Live deliver pending blocks while launcher stays open (history stack → list).
  useEffect(() => {
    return subscribePendingObjectBlock((pending) => {
      clearExitTimer()
      setIsExiting(false)
      setBlock(pending)
      setHint(null)
      didReadRef.current = true
      // Consume so a later open/read path does not overwrite.
      consumePendingObjectBlock()
    })
  }, [clearExitTimer])

  // On open: prefer pending history-item block; else read clipboard after first paint.
  useEffect(() => {
    if (!open) {
      didReadRef.current = false
      return
    }
    if (didReadRef.current) return
    didReadRef.current = true

    const pending = consumePendingObjectBlock()
    if (pending) {
      clearExitTimer()
      setIsExiting(false)
      setBlock(pending)
      setHint(null)
      return
    }

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const startedAt = launcherPerfNow()
        try {
          const text = await readClipboard()
          if (cancelled) return
          logLauncherPerfDuration('clipboard-object-block:read', startedAt, {
            hasText: Boolean(text),
            textLength: text.length,
          })
          if (!text) {
            setBlock(null)
            setIsExiting(false)
            setHint(null)
            return
          }

          // Clock rules (must not treat "first read at open" as copy time):
          // - No prior observation → unknown age (no auto-attach).
          // - Same content as tracker/open baseline → preserve changedAt / ageConfidence.
          // - Content changed since last observation → known age at observation time
          //   (race with background tracker; user likely just copied).
          const lastSnapshot = getLastClipboardSnapshot()
          let snapshot: ClipboardSnapshot
          if (!lastSnapshot) {
            snapshot = createClipboardSnapshotFromUnknownAge(text)
          } else if (lastSnapshot.hash === hashClipboardText(text) || lastSnapshot.text === text) {
            snapshot = updateClipboardSnapshot(text)
          } else {
            // Prefer observe path so first-ever change after unknown baseline is known.
            snapshot = observeClipboardText(text) ?? updateClipboardSnapshot(text)
          }

          if (cancelled) return
          const newBlock = isClipboardDismissed(snapshot) ? null : createClipboardObjectBlock(snapshot)
          clearExitTimer()
          setIsExiting(false)
          setBlock(newBlock)
          setHint(newBlock ? null : buildRecentClipboardHint(snapshot))
        } catch {
          if (cancelled) return
          logLauncherPerfDuration('clipboard-object-block:read', startedAt, { failed: true })
          setBlock(null)
          setIsExiting(false)
          setHint(null)
        }
      })()
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, readClipboard, clearExitTimer])

  // When launcher closes, clear block state
  useEffect(() => {
    if (!open) {
      clearExitTimer()
      setBlock(null)
      setIsExiting(false)
      setHint(null)
    }
  }, [open, clearExitTimer])

  useEffect(() => () => clearExitTimer(), [clearExitTimer])

  /**
   * Dismiss snapshot immediately (no re-attach), keep token mounted for exit CSS, then unmount.
   * Unmount is deferred one frame so the exiting class paints before the timer starts.
   */
  const removeBlock = useCallback(() => {
    if (!block || isExiting) return
    const snapshot = getLastClipboardSnapshot()
    if (snapshot) dismissClipboardBlock(snapshot)
    setIsExiting(true)
    clearExitTimer()
    // rAF: apply .is-exiting paint first; avoid unmount racing the first transition frame.
    requestAnimationFrame(() => {
      exitTimerRef.current = window.setTimeout(() => {
        setBlock(null)
        setIsExiting(false)
        exitTimerRef.current = null
      }, OBJECT_BLOCK_EXIT_MS)
    })
  }, [block, isExiting, clearExitTimer])

  const selectBlockForDelete = useCallback(() => {
    setBlock((prev) => prev ? { ...prev, selectedForDelete: true } : null)
  }, [])

  /**
   * Handle Backspace when query is empty: remove the object block in one press
   * (with exit transition). Returns true if Backspace was consumed.
   */
  const handleBackspace = useCallback((queryEmpty: boolean): boolean => {
    if (!queryEmpty) return false
    if (!block) return false
    if (isExiting) return true
    removeBlock()
    return true
  }, [block, isExiting, removeBlock])

  const attachHintAsBlock = useCallback(() => {
    if (!hint) return
    const snapshot = getLastClipboardSnapshot()
    if (!snapshot) return
    // Force-create block bypassing freshness, preserving original changedAt for accurate age display
    const now = Date.now()
    const forcedBlock = createClipboardObjectBlock(snapshot, now, { forceAttach: true })
    if (forcedBlock) {
      clearExitTimer()
      setIsExiting(false)
      setBlock(forcedBlock)
      setHint(null)
    }
  }, [hint, clearExitTimer])

  // Keep object-action until unmount so ranking/list do not re-render mid-exit (jank source).
  const mode: ClipboardObjectBlockMode = block ? 'object-action' : 'search-only'

  return {
    mode,
    block,
    isExiting,
    hint,
    removeBlock,
    selectBlockForDelete,
    handleBackspace,
    attachHintAsBlock,
  }
}
