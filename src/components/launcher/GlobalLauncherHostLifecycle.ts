import { useCallback, useEffect, useRef, type RefObject } from 'react'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import type { LauncherControllerState } from '../../workspace/launcher/controller'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../../utils/imeKeyboard'
import { runLauncherEscapeInterceptor } from './launcherEscapeInterceptor'

export function isStandaloneLauncherWindow() {
  return new URLSearchParams(window.location.search).get('window') === 'launcher'
}

export function useGlobalLauncherFocusSession({
  open,
  inputRef,
  setQuery,
  setSelectedIndex,
}: {
  open: boolean
  inputRef: RefObject<HTMLInputElement | null>
  setQuery: (value: string) => void
  setSelectedIndex: (value: number) => void
}) {
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    if (!open) return
    previousFocusRef.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => {
      setQuery('')
      setSelectedIndex(0)
      inputRef.current?.focus()
    })
  }, [inputRef, open, setQuery, setSelectedIndex])

  const restoreFocus = useCallback(() => {
    const el = previousFocusRef.current
    if (el && typeof el.focus === 'function') {
      requestAnimationFrame(() => el.focus())
    }
    previousFocusRef.current = null
  }, [])

  const focusSearchInputAfterBack = useCallback(() => {
    requestAnimationFrame(() => inputRef.current?.focus())
  }, [inputRef])

  return { restoreFocus, focusSearchInputAfterBack }
}

export function useGlobalLauncherImeComposition() {
  const isImeComposingRef = useRef(false)
  const handleCompositionStart = useCallback(() => {
    startImeComposition(isImeComposingRef)
  }, [])
  const handleCompositionEnd = useCallback(() => {
    finishImeComposition(isImeComposingRef)
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
  inputRef: RefObject<HTMLInputElement | null>
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

export function useGlobalLauncherHostEscape({
  open,
  mode,
  isImeComposingRef,
  launcherSettingsTarget,
  closeSettingsDialog,
  settingsDialogTarget,
  surfaceFrame,
  leaveSurface,
  hostSurfaceTarget,
  clearLauncherHostSurface,
  itemPermissionFrame,
  cancelItemPermissionPrompt,
  controllerRef,
  closeLauncher,
  focusSearchInputAfterBack,
}: {
  open: boolean
  mode?: string
  isImeComposingRef: RefObject<boolean>
  launcherSettingsTarget: { pluginId: string; source: PluginSettingsSource } | null
  closeSettingsDialog: () => void
  settingsDialogTarget: unknown
  surfaceFrame: unknown
  leaveSurface: () => void
  hostSurfaceTarget: unknown
  clearLauncherHostSurface: () => void
  itemPermissionFrame: unknown
  cancelItemPermissionPrompt: () => void
  controllerRef: RefObject<{ back?: () => boolean | void } | null>
  closeLauncher: () => void
  focusSearchInputAfterBack: () => void
}) {
  const handleHostEscape = useCallback((event: KeyboardEvent) => {
    if (event.key !== 'Escape') return
    if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return

    // TODO(escape-migration): migrate the settings / plugin surface / host
    // surface / permission branches below onto the launcherEscapeInterceptor
    // protocol so each page owns its escape handling; the default chain should
    // eventually shrink to: IME check → interceptor → controller.back → close.
    if (runLauncherEscapeInterceptor(event)) return

    if (event.key === 'Escape' && launcherSettingsTarget) {
      event.preventDefault()
      event.stopPropagation()
      closeSettingsDialog()
      focusSearchInputAfterBack()
      return
    }
    if (settingsDialogTarget) return
    event.preventDefault()
    event.stopPropagation()

    if (surfaceFrame) {
      leaveSurface()
      return
    }

    if (hostSurfaceTarget) {
      clearLauncherHostSurface()
      focusSearchInputAfterBack()
      return
    }

    if (itemPermissionFrame) {
      cancelItemPermissionPrompt()
      return
    }

    if (controllerRef.current?.back?.()) {
      focusSearchInputAfterBack()
      return
    }

    closeLauncher()
  }, [
    cancelItemPermissionPrompt,
    clearLauncherHostSurface,
    closeLauncher,
    closeSettingsDialog,
    controllerRef,
    focusSearchInputAfterBack,
    hostSurfaceTarget,
    isImeComposingRef,
    itemPermissionFrame,
    launcherSettingsTarget,
    leaveSurface,
    mode,
    settingsDialogTarget,
    surfaceFrame,
  ])

  useEffect(() => {
    if (!open) return
    window.addEventListener('keydown', handleHostEscape, true)
    return () => window.removeEventListener('keydown', handleHostEscape, true)
  }, [handleHostEscape, open])
}
