/**
 * useClipboardObjectBlock — React hook for Global Launcher clipboard integration.
 *
 * Responsibilities:
 *  1. On launcher open: read system clipboard, build ClipboardSnapshot.
 *  2. Apply freshness rules to decide whether to auto-attach ObjectBlock.
 *  3. Expose Backspace-to-select-to-delete interaction state.
 *  4. Expose mode: 'object-action' | 'search-only'.
 *  5. Expose recent clipboard hint when in 2–10 min window.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { LauncherObjectBlock, RecentClipboardHint } from './objectBlock'
import {
  buildRecentClipboardHint,
  createClipboardObjectBlock,
} from './objectBlock'
import {
  clearClipboardSnapshot,
  createClipboardSnapshotFromUnknownAge,
  dismissClipboardBlock,
  getLastClipboardSnapshot,
  isClipboardDismissed,
  updateClipboardSnapshot,
  type ClipboardSnapshot,
} from './clipboardSnapshot'
import { launcherPerfNow, logLauncherPerfDuration } from '../../workspace/launcher/perf'

export type ClipboardObjectBlockMode = 'object-action' | 'search-only'

export type ClipboardObjectBlockState = {
  mode: ClipboardObjectBlockMode
  block: LauncherObjectBlock | null
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
  const [hint, setHint] = useState<RecentClipboardHint | null>(null)
  const didReadRef = useRef(false)

  // On open: read clipboard after first paint — never compete with window show / list paint.
  useEffect(() => {
    if (!open) {
      didReadRef.current = false
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
          logLauncherPerfDuration('clipboard-object-block:read', startedAt, {
            hasText: Boolean(text),
            textLength: text.length,
          })
          if (!text) {
            setBlock(null)
            setHint(null)
            return
          }

          const lastSnapshot = getLastClipboardSnapshot()
          let snapshot: ClipboardSnapshot

          if (lastSnapshot && lastSnapshot.text === text) {
            snapshot = updateClipboardSnapshot(text)
          } else if (lastSnapshot) {
            snapshot = updateClipboardSnapshot(text)
          } else {
            snapshot = createClipboardSnapshotFromUnknownAge(text)
          }

          if (cancelled) return
          const newBlock = isClipboardDismissed(snapshot) ? null : createClipboardObjectBlock(snapshot)
          setBlock(newBlock)
          setHint(newBlock ? null : buildRecentClipboardHint(snapshot))
        } catch {
          if (cancelled) return
          logLauncherPerfDuration('clipboard-object-block:read', startedAt, { failed: true })
          setBlock(null)
          setHint(null)
        }
      })()
    }, 180)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [open, readClipboard])

  // When launcher closes, clear block state
  useEffect(() => {
    if (!open) {
      setBlock(null)
      setHint(null)
    }
  }, [open])

  const removeBlock = useCallback(() => {
    const snapshot = getLastClipboardSnapshot()
    if (snapshot) dismissClipboardBlock(snapshot)
    setBlock(null)
  }, [])

  const selectBlockForDelete = useCallback(() => {
    setBlock((prev) => prev ? { ...prev, selectedForDelete: true } : null)
  }, [])

  /**
   * Handle Backspace key when query is empty:
   *  - First press: select block for delete
   *  - Second press: delete block
   * Returns true if Backspace was consumed.
   */
  const handleBackspace = useCallback((queryEmpty: boolean): boolean => {
    if (!queryEmpty) return false
    if (!block) return false
    if (block.selectedForDelete) {
      const snapshot = getLastClipboardSnapshot()
      if (snapshot) dismissClipboardBlock(snapshot)
      setBlock(null)
      return true
    }
    setBlock({ ...block, selectedForDelete: true })
    return true
  }, [block])

  const attachHintAsBlock = useCallback(() => {
    if (!hint) return
    const snapshot = getLastClipboardSnapshot()
    if (!snapshot) return
    // Force-create block bypassing freshness, preserving original changedAt for accurate age display
    const now = Date.now()
    const forcedBlock = createClipboardObjectBlock(snapshot, now, { forceAttach: true })
    if (forcedBlock) {
      setBlock(forcedBlock)
      setHint(null)
    }
  }, [hint])

  const mode: ClipboardObjectBlockMode = block ? 'object-action' : 'search-only'

  return {
    mode,
    block,
    hint,
    removeBlock,
    selectBlockForDelete,
    handleBackspace,
    attachHintAsBlock,
  }
}
