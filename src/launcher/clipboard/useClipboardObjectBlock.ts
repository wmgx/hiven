import type { LauncherItem } from '../../workspace/launcher/types'
import { detectContent } from '../../kits/content/index'
import { isSoftClipboardOperand } from './clipboardSnapshot'
import { useCallback, useEffect, useRef, useState } from 'react'
import { checkPendingPasteRecovery } from '../../workspace/pasteRecovery'
import { TelemetryEvents, trackBehavior } from '../../workspace/telemetry'
import { buildRecentClipboardHint, createClipboardObjectBlock, createQueryObjectBlock, type LauncherObjectBlock } from './objectBlock'
import { clearPendingObjectBlock, consumePendingObjectBlock, peekPendingObjectBlock, setPendingObjectBlock, subscribePendingObjectBlock } from './pendingObjectBlock'
import { dismissClipboardHint, getDismissedClipboardHintHash, subscribeClipboardChange, updateClipboardSnapshot, type ClipboardSnapshot } from './clipboardSnapshot'
import { acceptMaterialHandoff, discardCurrentMaterial, forgetPreviousMaterial, getMaterialTextPair, replaceCurrentMaterial, type CurrentMaterial } from './currentMaterial'
import { getAttachedTextFilePath, readAttachedTextFile, startFileTextMaterialRead, type FileTextErrorCode } from './fileTextMaterial'

export const OBJECT_BLOCK_EXIT_MS = 130
export type ClipboardObjectBlockMode = 'object-action' | 'search-only'
export type ClipboardObjectBlockState = ReturnType<typeof useClipboardObjectBlock>

function isHandoffBlock(block: LauncherObjectBlock | null): boolean {
  return block?.source === 'history-item' || block?.source === 'tool-result'
}

export function useClipboardObjectBlock({ open, readClipboard, findAnswer, onAnswer }: {
  open: boolean
  readClipboard: () => Promise<ClipboardSnapshot>
  findAnswer?: (text: string, signal: AbortSignal) => Promise<LauncherItem | undefined>
  onAnswer?: (item: LauncherItem, paste: boolean) => void
}) {
  const [material, setMaterial] = useState(() => replaceCurrentMaterial(null))
  const materialRef = useRef(material)
  const generationRef = useRef(0)
  const mountedRef = useRef(false)
  const openRef = useRef(open)
  openRef.current = open
  const dismissedRef = useRef(false)
  const [isExiting, setIsExiting] = useState(false)
  const exitTimerRef = useRef<number | null>(null)
  const [answer, setAnswer] = useState<{ snapshot: ClipboardSnapshot; item: LauncherItem } | null>(null)
  const answerHandlerRef = useRef(onAnswer)
  answerHandlerRef.current = onAnswer
  const [snapshot, setSnapshot] = useState<ClipboardSnapshot | null>(null)
  const snapshotRef = useRef(snapshot)
  snapshotRef.current = snapshot
  const [isReadingFileText, setIsReadingFileText] = useState(false)
  const [fileTextError, setFileTextError] = useState<FileTextErrorCode | null>(null)
  const fileReadRef = useRef<ReturnType<typeof startFileTextMaterialRead> | null>(null)

  const cancelFileTextRead = useCallback(() => {
    fileReadRef.current?.cancel()
    fileReadRef.current = null
    setIsReadingFileText(false)
    setFileTextError(null)
  }, [])
  const clearExitTimer = useCallback(() => {
    if (exitTimerRef.current !== null) window.clearTimeout(exitTimerRef.current)
    exitTimerRef.current = null
  }, [])
  const publishMaterial = useCallback((next: CurrentMaterial) => {
    cancelFileTextRead()
    generationRef.current += 1
    materialRef.current = next
    setMaterial(next)
    checkPendingPasteRecovery()
  }, [cancelFileTextRead])
  const dismissHint = useCallback(() => {
    const current = snapshotRef.current
    if (current) dismissClipboardHint(current)
    snapshotRef.current = null
    setSnapshot(null)
  }, [])
  const applyHandoffBlock = useCallback((pending: LauncherObjectBlock) => {
    if (!openRef.current) return false
    const next = acceptMaterialHandoff(materialRef.current, pending, !dismissedRef.current)
    if (next === materialRef.current) return false
    clearExitTimer()
    publishMaterial(next)
    dismissedRef.current = false
    setIsExiting(false)
    setSnapshot(null)
    return true
  }, [clearExitTimer, publishMaterial])

  useEffect(() => subscribePendingObjectBlock((pending) => {
    const accepted = applyHandoffBlock(pending)
    if (!accepted) {
      if (openRef.current) clearPendingObjectBlock(pending)
      return false
    }
    if (isHandoffBlock(pending)) setPendingObjectBlock(materialRef.current.block!, { persist: true, silent: true })
    else clearPendingObjectBlock()
    return true
  }), [applyHandoffBlock])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      fileReadRef.current?.cancel()
      clearExitTimer()
      checkPendingPasteRecovery()
    }
  }, [clearExitTimer])

  useEffect(() => {
    if (!open) {
      const current = materialRef.current.block
      if (!dismissedRef.current && current && isHandoffBlock(current)) {
        setPendingObjectBlock(current, { persist: true, silent: true })
      }
      clearExitTimer()
      publishMaterial(replaceCurrentMaterial(null))
      setSnapshot(null)
      setIsExiting(false)
      return
    }
    dismissedRef.current = false
    const pending = consumePendingObjectBlock()
    if (pending) {
      applyHandoffBlock(pending)
      if (isHandoffBlock(pending)) setPendingObjectBlock(materialRef.current.block!, { persist: true, silent: true })
      return
    }
    let cancelled = false
    let reading = 0
    let answers: AbortController | null = null
    const generation = generationRef.current
    const read = async () => {
      const request = ++reading
      answers?.abort()
      setAnswer(null)
      try {
        const value = await readClipboard()
        if (cancelled || request !== reading || generation !== generationRef.current || materialRef.current.block) return
        const next = updateClipboardSnapshot(value)
        if (next.hash === getDismissedClipboardHintHash()) { setSnapshot(null); return }
        snapshotRef.current = next
        setSnapshot(next)
        if (!findAnswer || !next.text.trim() || isSoftClipboardOperand(next.text) ||
          detectContent(next.text).some(({ kind }) => kind === 'secret' || kind === 'secret-like')) return
        answers = new AbortController()
        const item = await findAnswer(next.text, answers.signal)
        if (item && !cancelled && request === reading && generation === generationRef.current && snapshotRef.current === next) {
          setAnswer({ snapshot: next, item })
        }
      } catch {
        // A failed read never substitutes stale or user-provided material.
      }
    }
    const frame = requestAnimationFrame(() => { void read() })
    const unsubscribe = subscribeClipboardChange(() => { void read() })
    return () => { cancelled = true; answers?.abort(); cancelAnimationFrame(frame); unsubscribe() }
  }, [open, readClipboard, findAnswer, applyHandoffBlock, clearExitTimer, publishMaterial])

  const removeBlock = useCallback(() => {
    const block = materialRef.current.block
    if (!block || isExiting) return
    dismissedRef.current = true
    publishMaterial(forgetPreviousMaterial(materialRef.current))
    clearPendingObjectBlock()
    trackBehavior(TelemetryEvents.clipboardBlockRemove, { kind: block.kind, source: block.source })
    clearExitTimer()
    setIsExiting(true)
    const generation = generationRef.current
    exitTimerRef.current = window.setTimeout(() => {
      if (generation !== generationRef.current) return
      publishMaterial(discardCurrentMaterial(materialRef.current))
      setIsExiting(false)
      exitTimerRef.current = null
    }, OBJECT_BLOCK_EXIT_MS)
  }, [isExiting, publishMaterial, clearExitTimer])

  const clearMaterial = useCallback((options?: { preservePending?: boolean }) => {
    const pending = options?.preservePending ? peekPendingObjectBlock() : null
    dismissedRef.current = true
    publishMaterial(pending ? replaceCurrentMaterial(null) : discardCurrentMaterial(materialRef.current))
    if (!options?.preservePending) clearPendingObjectBlock()
    clearExitTimer()
    setSnapshot(null)
    setIsExiting(false)
    if (pending) applyHandoffBlock(pending)
  }, [publishMaterial, clearExitTimer, applyHandoffBlock])

  const renderedGeneration = generationRef.current
  const isCurrent = useCallback(() => mountedRef.current && openRef.current && !dismissedRef.current &&
    generationRef.current === renderedGeneration && materialRef.current === material,
  [material, renderedGeneration])

  const readFileText = useCallback((target = material.block) => {
    if (!isCurrent() || !target || !getAttachedTextFilePath(target) || fileReadRef.current) return
    setFileTextError(null)
    setIsReadingFileText(true)
    const request = startFileTextMaterialRead({ block: target, read: readAttachedTextFile, isCurrent })
    fileReadRef.current = request
    void request.result.then((result) => {
      if (fileReadRef.current !== request || !isCurrent()) return
      fileReadRef.current = null
      setIsReadingFileText(false)
      if (result.status === 'error') { setFileTextError(result.code); return }
      if (result.status !== 'ready') return
      dismissHint()
      // Reading a hint is an explicit attachment, not a result/history handoff.
      const block = target.source === 'clipboard' ? { ...result.block, source: 'clipboard' as const } : result.block
      clearExitTimer()
      publishMaterial(acceptMaterialHandoff(materialRef.current, block, true))
      if (isHandoffBlock(block)) setPendingObjectBlock(block, { persist: true, silent: true })
      else clearPendingObjectBlock()
      setIsExiting(false)
    })
  }, [material.block, isCurrent, dismissHint, clearExitTimer, publishMaterial])

  const hint = snapshot && !material.block
    ? answer?.snapshot === snapshot
      ? { snapshot, kind: snapshot.detectedType, masked: false, answer: answer.item }
      : buildRecentClipboardHint(snapshot)
    : null
  const attachHintAsBlock = useCallback(() => {
    if (!hint || hint.answer || !isCurrent() || snapshotRef.current !== hint.snapshot) return
    const block = createClipboardObjectBlock(hint.snapshot)
    if (getAttachedTextFilePath(block)) { readFileText(block); return }
    dismissHint()
    clearExitTimer()
    publishMaterial(replaceCurrentMaterial(block))
    clearPendingObjectBlock()
    setIsExiting(false)
    trackBehavior(TelemetryEvents.clipboardHintAttach, { kind: block.kind, source: block.source })
  }, [hint, isCurrent, readFileText, dismissHint, clearExitTimer, publishMaterial])
  const activateHint = useCallback((paste = false) => {
    if (!hint || !isCurrent() || snapshotRef.current !== hint.snapshot) return
    if (hint.answer) {
      dismissHint()
      answerHandlerRef.current?.(hint.answer, paste)
    } else attachHintAsBlock()
  }, [hint, isCurrent, dismissHint, attachHintAsBlock])
  const attachQueryAsBlock = useCallback((text: string) => {
    if (!text || !mountedRef.current || !openRef.current) return
    setPendingObjectBlock(createQueryObjectBlock({ query: text }))
  }, [])
  const handleBackspace = useCallback((queryEmpty: boolean) => {
    if (!queryEmpty || !materialRef.current.block) return false
    removeBlock()
    return true
  }, [removeBlock])
  const beginTextPair = useCallback(() => {
    if (!isCurrent() || isExiting) return null
    const pair = getMaterialTextPair(material)
    return pair ? { ...pair, isCurrent } : null
  }, [material, isCurrent, isExiting])
  const getMaterialGeneration = useCallback(() => mountedRef.current && openRef.current ? generationRef.current : undefined, [])
  const hasMaterial = useCallback((expected: LauncherObjectBlock) => {
    const block = materialRef.current.block
    return Boolean(mountedRef.current && openRef.current && block && block.id === expected.id &&
      block.source === expected.source && block.createdAt === expected.createdAt)
  }, [])

  return {
    mode: (material.block ? 'object-action' : 'search-only') as ClipboardObjectBlockMode,
    block: material.block, isExiting, hint, dismissHint, activateHint,
    removeBlock, handleBackspace, attachHintAsBlock, attachQueryAsBlock, clearMaterial, beginTextPair,
    canReadFileText: open && !isExiting && Boolean(getAttachedTextFilePath(material.block)),
    isReadingFileText, fileTextError, readFileText: () => readFileText(), cancelFileTextRead,
    getMaterialGeneration, hasMaterial,
  }
}
