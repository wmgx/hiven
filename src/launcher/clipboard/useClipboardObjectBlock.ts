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
  createQueryObjectBlock,
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
import {
  acceptMaterialHandoff,
  canEditMaterialText,
  discardCurrentMaterial,
  forgetPreviousMaterial,
  replaceCurrentMaterial,
  restorePreviousMaterial,
  type CurrentMaterial,
} from './currentMaterial'
import { getAttachedTextFilePath, readAttachedTextFile, startFileTextMaterialRead, type FileTextErrorCode } from './fileTextMaterial'

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
  attachQueryAsBlock: (text: string) => void
  markBlockConsumed: () => void
  canRestorePreviousMaterial: boolean
  restorePreviousMaterial: () => void
  canEditText: boolean
  /** Bound to the displayed material/session; null for a stale entry button. */
  beginTextEdit: () => { text: string; commit: (text: string) => boolean } | null
  canReadFileText: boolean
  isReadingFileText: boolean
  fileTextError: FileTextErrorCode | null
  readFileText: () => void
  cancelFileTextRead: () => void
  /** Synchronous identity for the currently attached material session. */
  getMaterialGeneration: () => number | undefined
  /** Synchronous receipt check when retrying presentation of an already delivered block. */
  hasMaterial: (block: LauncherObjectBlock) => boolean
}

/** Blocks handed in from history / tools — re-stash on hide so ⌘↵ is not lost mid-transition. */
const HANDOFF_BLOCK_SOURCES = new Set(['history-item', 'tool-result', 'query'])

function isHandoffBlock(block: LauncherObjectBlock | null | undefined): boolean {
  return Boolean(block && HANDOFF_BLOCK_SOURCES.has(block.source))
}

export function useClipboardObjectBlock(params: {
  open: boolean
  readClipboard: () => Promise<string>
  /**
   * When true at open-read time, skip auto Object Block while input is in progress.
   * forceAttach / history pending still work.
   */
  suppressAutoAttach?: () => boolean
}): ClipboardObjectBlockState {
  const { open, readClipboard, suppressAutoAttach } = params
  const [material, setMaterial] = useState(() => replaceCurrentMaterial(null))
  const block = material.block
  const [isExiting, setIsExiting] = useState(false)
  const [hint, setHint] = useState<RecentClipboardHint | null>(null)
  const [isReadingFileText, setIsReadingFileText] = useState(false)
  const [fileTextError, setFileTextError] = useState<FileTextErrorCode | null>(null)
  const fileReadRef = useRef<ReturnType<typeof startFileTextMaterialRead> | null>(null)
  const didReadRef = useRef(false)
  const exitTimerRef = useRef<number | null>(null)
  const exitFrameRef = useRef<number | null>(null)
  const materialRef = useRef(material)
  materialRef.current = material
  const materialGenerationRef = useRef(0)
  const mountedRef = useRef(false)
  const openRef = useRef(open)
  openRef.current = open
  /** User dismissed the token — do not re-stash on close. */
  const userDismissedRef = useRef(false)
  // Host often passes an inline suppress fn — keep in ref so open effect is stable.
  const suppressAutoAttachRef = useRef(suppressAutoAttach)
  suppressAutoAttachRef.current = suppressAutoAttach

  const clearExitTimer = useCallback(() => {
    if (exitFrameRef.current != null) {
      cancelAnimationFrame(exitFrameRef.current)
      exitFrameRef.current = null
    }
    if (exitTimerRef.current != null) {
      window.clearTimeout(exitTimerRef.current)
      exitTimerRef.current = null
    }
  }, [])

  const cancelFileTextRead = useCallback(() => {
    fileReadRef.current?.cancel()
    fileReadRef.current = null
    setIsReadingFileText(false)
    setFileTextError(null)
  }, [])

  const publishMaterial = useCallback((next: CurrentMaterial) => {
    cancelFileTextRead()
    materialGenerationRef.current += 1
    materialRef.current = next
    setMaterial(next)
  }, [cancelFileTextRead])

  const applyHandoffBlock = useCallback((pending: LauncherObjectBlock) => {
    if (!openRef.current) return false
    // The in-flight open read may settle before React commits material below.
    // Publish explicit material synchronously so that older clipboard read cannot replace it.
    const next = acceptMaterialHandoff(materialRef.current, pending, openRef.current && !userDismissedRef.current)
    if (next === materialRef.current) return false
    publishMaterial(next)
    clearExitTimer()
    setIsExiting(false)
    setHint(null)
    didReadRef.current = true
    userDismissedRef.current = false
    return true
  }, [clearExitTimer, publishMaterial])

  // Live deliver pending blocks while launcher stays open (history stack → list).
  useEffect(() => {
    return subscribePendingObjectBlock((pending) => {
      const accepted = applyHandoffBlock(pending)
      if (!accepted) {
        if (openRef.current) clearPendingObjectBlock(pending)
        return false
      }
      // Re-persist without re-notifying so hide/show races can still recover.
      const current = materialRef.current.block
      if (current && !userDismissedRef.current) {
        setPendingObjectBlock(current, { persist: true, silent: true })
      } else {
        clearPendingObjectBlock()
      }
      return true
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
      const current = materialRef.current.block
      if (current) setPendingObjectBlock(current, { persist: true, silent: true })
      return
    }
    if (didReadRef.current) return
    didReadRef.current = true

    let cancelled = false
    const generation = materialGenerationRef.current
    const isReadCurrent = () => mountedRef.current && !cancelled && generation === materialGenerationRef.current
    const readAfterFirstPaint = async () => {
      if (!isReadCurrent() || userDismissedRef.current) return
      const startedAt = launcherPerfNow()
      try {
        const text = await readClipboard()
        if (!isReadCurrent() || userDismissedRef.current) return
        // Never clobber a history handoff that landed while we were reading.
        if (isHandoffBlock(materialRef.current.block)) return
        logLauncherPerfDuration('clipboard-object-block:read', startedAt, {
          kind: 'latency',
          hasText: Boolean(text),
          textLength: text.length,
        })
        if (!text) {
          publishMaterial(replaceCurrentMaterial(null))
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

        if (!isReadCurrent()) return
        if (isHandoffBlock(materialRef.current.block)) return
        const suppress = suppressAutoAttachRef.current?.() === true
        const newBlock = isClipboardDismissed(snapshot)
          ? null
          : createClipboardObjectBlock(snapshot, Date.now(), { suppressAutoAttach: suppress })
        clearExitTimer()
        setIsExiting(false)
        publishMaterial(replaceCurrentMaterial(newBlock))
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
        if (!isReadCurrent() || userDismissedRef.current) return
        if (isHandoffBlock(materialRef.current.block)) return
        logLauncherPerfDuration('clipboard-object-block:read', startedAt, {
          kind: 'latency',
          failed: true,
        })
        publishMaterial(replaceCurrentMaterial(null))
        setIsExiting(false)
        setHint(null)
      }
    }
    let timer = 0
    const raf1 = requestAnimationFrame(() => {
      timer = window.setTimeout(() => {
        void readAfterFirstPaint()
      }, 0)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(raf1)
      window.clearTimeout(timer)
      // Effect replay may cancel the first read before it starts. Only retry
      // that untouched read; an explicit handoff/restoration already owns it.
      if (generation === materialGenerationRef.current) didReadRef.current = false
    }
  }, [open, readClipboard, clearExitTimer, applyHandoffBlock, publishMaterial])

  // When launcher closes: re-stash handoff blocks so ⌘↵ is not lost if hide races show.
  useEffect(() => {
    if (!open) {
      clearExitTimer()
      const current = materialRef.current.block
      if (!userDismissedRef.current && isHandoffBlock(current) && current) {
        setPendingObjectBlock(current, { persist: true, silent: true })
      }
      publishMaterial(replaceCurrentMaterial(null))
      setIsExiting(false)
      setHint(null)
    }
  }, [open, clearExitTimer, publishMaterial])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      materialGenerationRef.current += 1
      fileReadRef.current?.cancel()
      fileReadRef.current = null
      clearExitTimer()
    }
  }, [clearExitTimer])

  /**
   * Dismiss snapshot immediately (no re-attach), keep token mounted for exit CSS, then unmount.
   * Unmount is deferred one frame so the exiting class paints before the timer starts.
   */
  const removeBlock = useCallback(() => {
    if (!block || isExiting) return
    userDismissedRef.current = true
    publishMaterial(forgetPreviousMaterial(materialRef.current))
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
    const generation = materialGenerationRef.current
    exitFrameRef.current = requestAnimationFrame(() => {
      exitFrameRef.current = null
      if (generation !== materialGenerationRef.current) return
      exitTimerRef.current = window.setTimeout(() => {
        if (generation !== materialGenerationRef.current) return
        publishMaterial(discardCurrentMaterial(materialRef.current))
        setIsExiting(false)
        exitTimerRef.current = null
      }, OBJECT_BLOCK_EXIT_MS)
    })
  }, [block, isExiting, clearExitTimer, publishMaterial])

  const selectBlockForDelete = useCallback(() => {
    if (userDismissedRef.current) return
    const current = materialRef.current
    if (current.block) publishMaterial({ ...current, block: { ...current.block, selectedForDelete: true } })
  }, [publishMaterial])

  /**
   * Mark the current block's clipboard content as handled — for when an object
   * action already acted on it (pasted / exported / opened it) and the launcher
   * is closing right after. No exit transition (nothing to animate; the whole
   * launcher is going away), just the same dismiss-cooldown bookkeeping
   * {@link removeBlock} uses.
   *
   * Without this the OS clipboard still holds the identical text (executing an
   * action doesn't clear it), so the very next open would silently re-attach
   * the same block — reproducing the "still has my old input" complaint.
   */
  const markBlockConsumed = useCallback(() => {
    // Completion must also cancel history/tool handoff recovery after a native hide.
    userDismissedRef.current = true
    publishMaterial(discardCurrentMaterial(materialRef.current))
    clearPendingObjectBlock()
    clearExitTimer()
    setHint(null)
    setIsExiting(false)
    const snapshot = getLastClipboardSnapshot()
    if (snapshot) dismissClipboardBlock(snapshot)
  }, [clearExitTimer, publishMaterial])

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

  const renderedGeneration = materialGenerationRef.current
  const attachHintAsBlock = useCallback(() => {
    // A queued hint click must not replace newer explicit material or another session.
    if (!hint || !mountedRef.current || !openRef.current || userDismissedRef.current ||
      materialRef.current !== material || materialGenerationRef.current !== renderedGeneration) return
    // Force-create block bypassing freshness, preserving original changedAt for accurate age display
    const now = Date.now()
    const forcedBlock = createClipboardObjectBlock(hint.snapshot, now, { forceAttach: true })
    if (forcedBlock) {
      trackBehavior(TelemetryEvents.clipboardHintAttach, {
        kind: forcedBlock.kind,
        source: forcedBlock.source,
      })
      clearExitTimer()
      setIsExiting(false)
      publishMaterial(replaceCurrentMaterial(forcedBlock))
      clearPendingObjectBlock()
      userDismissedRef.current = false
      setHint(null)
    }
  }, [hint, clearExitTimer, publishMaterial, material, renderedGeneration])

  const restoreMaterial = useCallback(() => {
    // A queued click from a removed token/session cannot restore newer work.
    if (!mountedRef.current || !openRef.current || userDismissedRef.current || materialRef.current !== material) return
    const next = restorePreviousMaterial(materialRef.current)
    if (next === materialRef.current || !next.block) return
    clearExitTimer()
    publishMaterial(next)
    setIsExiting(false)
    setHint(null)
    didReadRef.current = true
    // Restore only the current material. Ordinary handoff listeners reset the
    // host's query/browser intent, so synchronize the backup without notifying.
    setPendingObjectBlock(next.block, { persist: true, silent: true })
  }, [clearExitTimer, publishMaterial, material])

  const beginTextEdit = useCallback(() => {
    const isCurrent = () => mountedRef.current && openRef.current && !userDismissedRef.current &&
      materialRef.current === material && materialGenerationRef.current === renderedGeneration
    if (!isCurrent() || !canEditMaterialText(material.block)) return null
    return {
      text: material.block!.payloadText!,
      commit: (text: string) => {
        if (!isCurrent()) return false
        // Editing deliberately replaces material; it is not another processing handoff.
        const edited = createQueryObjectBlock({ query: text })
        // Once read, editing its contents must never re-enable path resolution.
        if (material.block?.meta?.textOrigin === 'file-content') {
          edited.meta = { ...edited.meta, textOrigin: 'file-content', fileName: material.block.meta.fileName }
        }
        const next = replaceCurrentMaterial(edited)
        clearExitTimer()
        publishMaterial(next)
        setIsExiting(false)
        setHint(null)
        didReadRef.current = true
        setPendingObjectBlock(next.block!, { persist: true, silent: true })
        return true
      },
    }
  }, [clearExitTimer, publishMaterial, material, renderedGeneration])

  const readFileText = useCallback(() => {
    const isCurrent = () => mountedRef.current && openRef.current && !userDismissedRef.current &&
      materialRef.current === material && materialGenerationRef.current === renderedGeneration
    if (!isCurrent() || !material.block || !getAttachedTextFilePath(material.block) || fileReadRef.current) return
    setFileTextError(null)
    setIsReadingFileText(true)
    const request = startFileTextMaterialRead({ block: material.block, read: readAttachedTextFile, isCurrent })
    fileReadRef.current = request
    void request.result.then((result) => {
      if (fileReadRef.current !== request || !isCurrent()) return
      fileReadRef.current = null
      setIsReadingFileText(false)
      if (result.status === 'error') {
        setFileTextError(result.code)
        return
      }
      if (result.status !== 'ready') return
      const next = acceptMaterialHandoff(materialRef.current, result.block, true)
      clearExitTimer()
      publishMaterial(next)
      setIsExiting(false)
      setHint(null)
      didReadRef.current = true
      // Preserve command search intent and use the usual handoff backup/restore.
      setPendingObjectBlock(result.block, { persist: true, silent: true })
    })
  }, [clearExitTimer, publishMaterial, material, renderedGeneration])

  const attachQueryAsBlock = useCallback((text: string) => {
    if (text.length === 0) return
    setPendingObjectBlock(createQueryObjectBlock({ query: text }))
  }, [])

  const getMaterialGeneration = useCallback(() => mountedRef.current && openRef.current
    ? materialGenerationRef.current : undefined, [])
  const hasMaterial = useCallback((expected: LauncherObjectBlock) => {
    const current = materialRef.current.block
    return Boolean(mountedRef.current && openRef.current && current && current.id === expected.id &&
      current.source === expected.source && current.createdAt === expected.createdAt)
  }, [])

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
    attachQueryAsBlock,
    markBlockConsumed,
    canRestorePreviousMaterial: open && Boolean(material.previousBlock) && !isExiting,
    restorePreviousMaterial: restoreMaterial,
    canEditText: open && !isExiting && canEditMaterialText(block),
    beginTextEdit,
    canReadFileText: open && !isExiting && Boolean(getAttachedTextFilePath(block)),
    isReadingFileText,
    fileTextError,
    readFileText,
    cancelFileTextRead,
    getMaterialGeneration,
    hasMaterial,
  }
}
