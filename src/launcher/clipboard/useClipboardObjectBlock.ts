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
import {
  clearPendingObjectBlock,
  consumePendingObjectBlock,
  setPendingObjectBlock,
  subscribePendingObjectBlock,
} from './pendingObjectBlock'
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
import { TelemetryEvents, trackBehavior } from '../../workspace/telemetry'

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

/** Blocks handed in from history / tools — re-stash on hide so ⌘↵ is not lost mid-transition. */
const HANDOFF_BLOCK_SOURCES = new Set(['history-item', 'tool-result'])

function isHandoffBlock(block: LauncherObjectBlock | null | undefined): boolean {
  return Boolean(block && HANDOFF_BLOCK_SOURCES.has(block.source))
}

export function useClipboardObjectBlock(params: {
  open: boolean
  readClipboard: () => Promise<string>
  /**
   * When true at open-read time, skip auto Object Block (sticky query / non-empty input).
   * forceAttach / history pending still work.
   */
  suppressAutoAttach?: () => boolean
}): ClipboardObjectBlockState {
  const { open, readClipboard, suppressAutoAttach } = params
  const [block, setBlock] = useState<LauncherObjectBlock | null>(null)
  const [isExiting, setIsExiting] = useState(false)
  const [hint, setHint] = useState<RecentClipboardHint | null>(null)
  const didReadRef = useRef(false)
  const exitTimerRef = useRef<number | null>(null)
  const blockRef = useRef<LauncherObjectBlock | null>(null)
  blockRef.current = block
  /** User dismissed the token — do not re-stash on close. */
  const userDismissedRef = useRef(false)
  // Host often passes an inline suppress fn — keep in ref so open effect is stable.
  const suppressAutoAttachRef = useRef(suppressAutoAttach)
  suppressAutoAttachRef.current = suppressAutoAttach

  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current != null) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
  }, [])

  const applyHandoffBlock = useCallback((pending: LauncherObjectBlock) => {
    clearExitTimer()
    setIsExiting(false)
    setBlock(pending)
    setHint(null)
    didReadRef.current = true
    userDismissedRef.current = false
  }, [clearExitTimer])

  // Live deliver pending blocks while launcher stays open (history stack → list).
  useEffect(() => {
    return subscribePendingObjectBlock((pending) => {
      applyHandoffBlock(pending)
      // Re-persist without re-notifying so hide/show races can still recover.
      setPendingObjectBlock(pending, { persist: true, silent: true })
    })
  }, [applyHandoffBlock])

  // On open: prefer pending history-item block; else read clipboard after first paint.
  useEffect(() => {
    if (!open) {
      didReadRef.current = false
      return
    }
    userDismissedRef.current = false

    // Always prefer handoff pending when opening — even if a previous session
    // left didReadRef true (listener path) without a surviving UI block.
    const pending = consumePendingObjectBlock()
    if (pending) {
      applyHandoffBlock(pending)
      // Keep a silent backup until the open frame has fully settled (close race).
      setPendingObjectBlock(pending, { persist: true, silent: true })
      return
    }
    if (didReadRef.current) return
    didReadRef.current = true

    let cancelled = false
    const timer = window.setTimeout(() => {
      void (async () => {
        const startedAt = launcherPerfNow()
        try {
          const text = await readClipboard()
          if (cancelled) return
          // Never clobber a history handoff that landed while we were reading.
          if (isHandoffBlock(blockRef.current)) return
          logLauncherPerfDuration('clipboard-object-block:read', startedAt, {
            kind: 'latency',
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
          if (isHandoffBlock(blockRef.current)) return
          const suppress = suppressAutoAttachRef.current?.() === true
          const newBlock = isClipboardDismissed(snapshot)
            ? null
            : createClipboardObjectBlock(snapshot, Date.now(), { suppressAutoAttach: suppress })
          clearExitTimer()
          setIsExiting(false)
          setBlock(newBlock)
          // Hint only when not suppressed and content would qualify (policy inside builder).
          setHint(newBlock || suppress ? null : buildRecentClipboardHint(snapshot))
          if (newBlock) {
            trackBehavior(TelemetryEvents.clipboardBlockAttach, {
              kind: newBlock.kind,
              source: newBlock.source,
              auto: true,
              suppressed: false,
            })
          } else if (suppress) {
            trackBehavior(TelemetryEvents.clipboardBlockAttach, {
              auto: false,
              suppressed: true,
            })
          }
        } catch {
          if (cancelled) return
          if (isHandoffBlock(blockRef.current)) return
          logLauncherPerfDuration('clipboard-object-block:read', startedAt, {
            kind: 'latency',
            failed: true,
          })
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
  }, [open, readClipboard, clearExitTimer, applyHandoffBlock])

  // When launcher closes: re-stash handoff blocks so ⌘↵ is not lost if hide races show.
  useEffect(() => {
    if (!open) {
      clearExitTimer()
      const current = blockRef.current
      if (!userDismissedRef.current && isHandoffBlock(current) && current) {
        setPendingObjectBlock(current, { persist: true, silent: true })
      }
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
    userDismissedRef.current = true
    trackBehavior(TelemetryEvents.clipboardBlockRemove, {
      kind: block.kind,
      source: block.source,
    })
    clearPendingObjectBlock()
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
      trackBehavior(TelemetryEvents.clipboardHintAttach, {
        kind: forcedBlock.kind,
        source: forcedBlock.source,
      })
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
