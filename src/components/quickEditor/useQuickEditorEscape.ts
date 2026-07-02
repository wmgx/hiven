import { useCallback, useEffect, useRef, useState } from 'react'
import { useAppStore } from '../../store'
import { useLauncherEscapeInterceptor } from '../launcher/launcherEscapeInterceptor'
import { isQuickEditorDetachedWindow } from '../../workspace/windowManager/quickEditorWindow'

const EXIT_HINT_DURATION_MS = 1500

/**
 * Quick Editor two-stage escape:
 * - command overlay open → overlay handles Escape itself (bubble phase)
 * - first Escape → show a hint only; Monaco still receives the key
 * - second Escape within the hint window → run the host-provided exit action
 *
 * Registered via the launcher escape interceptor in the surface host, and via
 * a window capture listener in the detached window (no host escape chain).
 */
export function useQuickEditorEscape(onExit: () => void) {
  const [exitHintVisible, setExitHintVisible] = useState(false)
  const hintTimerRef = useRef<number | null>(null)
  const onExitRef = useRef(onExit)

  useEffect(() => {
    onExitRef.current = onExit
  }, [onExit])

  const clearHint = useCallback(() => {
    if (hintTimerRef.current != null) window.clearTimeout(hintTimerRef.current)
    hintTimerRef.current = null
    setExitHintVisible(false)
  }, [])

  useEffect(() => () => clearHint(), [clearHint])

  const handleEscape = useCallback((event: KeyboardEvent): boolean => {
    if (event.key !== 'Escape') return false
    // The command overlay handles its own Escape in the bubble phase.
    if (useAppStore.getState().quickEditorCommandOpen) return true
    if (hintTimerRef.current != null) {
      event.preventDefault()
      event.stopPropagation()
      clearHint()
      onExitRef.current()
      return true
    }
    // First Escape: hint only. No preventDefault so Monaco can close its own
    // widgets (find, suggest) — but the host default chain must not run.
    setExitHintVisible(true)
    hintTimerRef.current = window.setTimeout(() => {
      hintTimerRef.current = null
      setExitHintVisible(false)
    }, EXIT_HINT_DURATION_MS)
    return true
  }, [clearHint])

  const detached = isQuickEditorDetachedWindow()

  // Surface host: register on the launcher escape interceptor slot.
  useLauncherEscapeInterceptor(detached ? null : handleEscape)

  // Detached window host: capture-phase window listener.
  useEffect(() => {
    if (!detached) return
    const listener = (event: KeyboardEvent) => {
      handleEscape(event)
    }
    window.addEventListener('keydown', listener, true)
    return () => window.removeEventListener('keydown', listener, true)
  }, [detached, handleEscape])

  return { exitHintVisible }
}
