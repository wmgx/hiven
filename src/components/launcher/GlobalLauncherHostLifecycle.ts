import { useCallback, useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from 'react'
import type { LauncherControllerState } from '../../workspace/launcher/controller'
import { finishImeComposition, startImeComposition } from '../../utils/imeKeyboard'
import { runLauncherEscapeInterceptor } from './launcherEscapeInterceptor'
import { usePluginSettingsStore } from '../../workspace/pluginSettingsStore'
import { focusLauncherWebview } from '../../workspace/windowManager/launcherWindow'
import { launcherNativeDialogFocus } from '../../workspace/launcherBlurGuard'
import { pasteRecoveryFocus } from '../../workspace/pasteRecovery'

export function isStandaloneLauncherWindow() {
  return !window.__HIVEN_WEB_NATIVE_BRIDGE__
    && new URLSearchParams(window.location.search).get('window') === 'launcher'
}

/**
 * Focus for the launcher search field.
 *
 * Intentionally minimal: repeated window.focus / makeFirstResponder / setSelectionRange
 * broke both list selection and click-to-focus on the non-activating macOS panel.
 * Native show already keys the webview; here we only focus the <input> on open/mount,
 * plus ONE native rekey on the cold first mount — native show rekeys before the page
 * has loaded, so without a rekey after DOM focus the caret stays ghost (no input).
 */
export function useGlobalLauncherFocusSession({
  open,
  inputRef,
  setQuery,
  setSelectedIndex,
  /**
   * When true, focus the search input on open/mount.
   * Disable on result frames, surfaces, settings, param steps that own their own fields.
   */
  retainSearchFocus = true,
}: {
  open: boolean
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
  setQuery: (value: string) => void
  setSelectedIndex: (value: number, options?: { pin?: boolean }) => void
  retainSearchFocus?: boolean
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null)
  const retainRef = useRef(retainSearchFocus)
  retainRef.current = retainSearchFocus

  const openRef = useRef(open)
  openRef.current = open
  /** Only reset query/selection on false→true open edge. */
  const wasOpenRef = useRef(false)
  /** Cold open only: warm rekeys caused caret thrash / broke list clicks. */
  const didColdRekeyRef = useRef(false)

  const focusLauncherInput = useCallback(() => {
    if (launcherNativeDialogFocus.isActive() || pasteRecoveryFocus.isActive()) return false
    const el = inputRef.current
    if (!el) return false
    try {
      el.focus({ preventScroll: true })
    } catch {
      try { el.focus() } catch { /* ignore */ }
    }
    return document.activeElement === el
  }, [inputRef])

  /**
   * Called when the search <input> mounts (Host renders null while closed).
   * One focus attempt only; the sole native rekey happens on the cold first
   * mount, after DOM focus — the order the WKWebView ghost-focus fix requires.
   */
  const bindSearchInputRef = useCallback((node: HTMLInputElement | HTMLTextAreaElement | null) => {
    ;(inputRef as MutableRefObject<HTMLInputElement | HTMLTextAreaElement | null>).current = node
    if (node && openRef.current && retainRef.current) {
      // Defer past commit so the node is in the document before focus.
      requestAnimationFrame(() => {
        if (!openRef.current || !retainRef.current || launcherNativeDialogFocus.isActive() || pasteRecoveryFocus.isActive()) return
        if (inputRef.current !== node) return
        try {
          node.focus({ preventScroll: true })
        } catch {
          try { node.focus() } catch { /* ignore */ }
        }
        if (!didColdRekeyRef.current) {
          didColdRekeyRef.current = true
          focusLauncherWebview()
            .then(() => {
              // Cold open: the window only became key during this rekey, so the
              // DOM focus above ran against an inactive page. Re-assert it.
              if (inputRef.current === node && openRef.current && retainRef.current && !launcherNativeDialogFocus.isActive() && !pasteRecoveryFocus.isActive()) {
                try { node.focus({ preventScroll: true }) } catch { /* ignore */ }
              }
            })
            .catch(() => { /* best-effort rekey */ })
        }
      })
    }
  }, [inputRef])

  // A new open starts with an empty query and first-row selection.
  useLayoutEffect(() => {
    if (!open) {
      wasOpenRef.current = false
      return
    }
    if (!wasOpenRef.current) {
      wasOpenRef.current = true
      previousFocusRef.current = document.activeElement as HTMLElement | null
      // Empty first so static list paints via empty-open path.
      // setQuery bails when already '' — no extra rank on warm re-open.
      setQuery('')
      setSelectedIndex(0, { pin: false })
    }
    const raf1 = requestAnimationFrame(() => {
      if (!openRef.current) return
      if (retainRef.current) focusLauncherInput()
    })
    return () => {
      cancelAnimationFrame(raf1)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open-edge only
  }, [open])

  const restoreFocus = useCallback(() => {
    const el = previousFocusRef.current
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus())
    }
    previousFocusRef.current = null
  }, [])

  const focusSearchInputAfterBack = useCallback(() => {
    requestAnimationFrame(() => { focusLauncherInput() })
  }, [focusLauncherInput])

  return { restoreFocus, focusSearchInputAfterBack, focusLauncherInput, bindSearchInputRef }
}

export function useGlobalLauncherImeComposition() {
  const isImeComposingRef = useRef(false)
  const handleCompositionStart = useCallback(() => {
    startImeComposition(isImeComposingRef)
  }, [])
  const handleCompositionEnd = useCallback(() => {
    finishImeComposition(isImeComposingRef)
  }, [])

  // Capture-phase document listeners: composition events target the focused <input>
  // and can miss parent React handlers in some webviews / focus paths. Global
  // capture keeps Enter-上屏 suppressed even when panel handlers do not fire.
  useEffect(() => {
    const onStart = () => startImeComposition(isImeComposingRef)
    const onEnd = () => finishImeComposition(isImeComposingRef)
    document.addEventListener('compositionstart', onStart, true)
    document.addEventListener('compositionend', onEnd, true)
    return () => {
      document.removeEventListener('compositionstart', onStart, true)
      document.removeEventListener('compositionend', onEnd, true)
    }
  }, [])

  return { isImeComposingRef, handleCompositionStart, handleCompositionEnd }
}

export function useGlobalLauncherCollectInputPreview({
  open,
  controllerState,
  controllerRef,
  inputRef,
}: {
  open: boolean
  controllerState: LauncherControllerState | null | undefined
  controllerRef: RefObject<{ previewInput?: () => void | Promise<void> } | null>
  inputRef: RefObject<HTMLInputElement | HTMLTextAreaElement | null>
}) {
  useEffect(() => {
    if (!open || !controllerState || controllerState.frames.length <= 1) return
    const topFrame = controllerState.frames[controllerState.frames.length - 1]
    if (topFrame.kind !== 'collect-input') return
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [controllerState, inputRef, open])

  useEffect(() => {
    if (!open || !controllerState || controllerState.frames.length <= 1) return
    if (controllerState.busy) return
    const topFrame = controllerState.frames[controllerState.frames.length - 1]
    if (topFrame.kind !== 'collect-input') return
    if (topFrame.item.behavior.type !== 'perform' || topFrame.item.inputPolicy == null) return
    if (topFrame.previewInputText === topFrame.inputText) return
    const timer = window.setTimeout(() => {
      void controllerRef.current?.previewInput?.()
    }, 180)
    return () => window.clearTimeout(timer)
  }, [controllerRef, controllerState, open])
}

/**
 * System-owned Escape = global back, not "close whatever is focused".
 *
 * Stack (top → bottom), one level per Escape:
 * 1. Active layer interceptor (plugin surface / host surface / permission /
 *    quick-editor double-Esc hint) — must only pop that layer, never close
 * 2. Launcher controller frames (result / param / collect-input)
 * 3. Root list → close launcher
 */
export function useGlobalLauncherHostEscape({
  open,
  isImeComposingRef,
  controllerRef,
  closeLauncher,
  focusSearchInputAfterBack,
  onRootBack,
}: {
  open: boolean
  isImeComposingRef: RefObject<boolean>
  controllerRef: RefObject<{ back?: () => boolean | void } | null>
  closeLauncher: () => void
  focusSearchInputAfterBack: () => void
  /** Optional root navigation; command/surface Escape handlers still take precedence. */
  onRootBack?: () => boolean
}) {
  const handleHostEscape = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    // Dialog menus may portal beside the popup, outside its DOM ancestry.
    if (document.querySelector('[role="dialog"][data-open]')) return
    // Let an open tooltip consume Escape before the host leaves its page.
    if (document.querySelector('[role="tooltip"][data-open]')) return
    // A visible Select portal owns Escape before its containing surface.
    const openSelect = Array.from(document.querySelectorAll('.hiven-ui-select-menu[data-open]'))
      .some((popup) => popup.getClientRects().length > 0 && getComputedStyle(popup).visibility === 'visible')
    if (openSelect) return

    // Clear any stuck IME composition flag so Esc can never be permanently dead.
    // (compositionend can be missed after remount / webview rekey / focus thrash.)
    if (isImeComposingRef.current) {
      isImeComposingRef.current = false
    }

    // Layer interceptors first: settings / plugin surface / permission / quick-editor.
    // Do NOT early-return on settingsDialogTarget — global-launcher settings only
    // owns Esc through this interceptor. Early-return previously swallowed Esc for
    // the whole launcher while settings (or a stale target) was open.
    if (runLauncherEscapeInterceptor(event)) return

    // Modal settings dialog mounts its own capture listener; if that presentation
    // is open, leave Esc to it (it stopImmediatePropagations).
    const settingsTarget = usePluginSettingsStore.getState().settingsDialogTarget
    if (settingsTarget && settingsTarget.presentation !== 'global-launcher') return

    event.preventDefault()
    event.stopPropagation()

    // Controller frame stack (result / param / collect-input empty state, …).
    if (controllerRef.current?.back?.()) {
      focusSearchInputAfterBack()
      return
    }

    if (onRootBack?.()) return

    // Root: only now may Escape dismiss the launcher.
    closeLauncher()
  }, [
    closeLauncher,
    controllerRef,
    focusSearchInputAfterBack,
    isImeComposingRef,
    onRootBack,
  ])

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleHostEscape, true)
    return () => window.removeEventListener('keydown', handleHostEscape, true)
  }, [handleHostEscape, open])
}
