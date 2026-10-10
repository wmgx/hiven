import { useCallback, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { LauncherHostSurfaceTarget } from '../../store'
import { configureCurrentLauncherWindow, invalidateCurrentLauncherWindowResize, onCurrentLauncherWindowFocusChanged, startCurrentLauncherWindowDrag } from '../../workspace/windowManager/launcherWindow'
import type { PluginUiSurfaceContribution } from '../../workspace/pluginTypes'
import { clearStandaloneLauncherBlurDevtoolsSuppress, launcherNativeDialogFocus, shouldKeepLauncherOpenOnBlur } from '../../workspace/launcherBlurGuard'
import { applyStandaloneLauncherGeometry, computeStandaloneLauncherGeometry } from './GlobalLauncherLayout'
import { logLauncherPerf } from '../../workspace/launcher/perf'
import { observePasteRecoveryFocus, pasteRecoveryFocus } from '../../workspace/pasteRecovery'
import { LAUNCHER_NEW_SESSION_EVENT } from '../../workspace/launcherWindowEvents'

const launcherFocusLease = {
  isActive: () => launcherNativeDialogFocus.isActive() || pasteRecoveryFocus.isActive(),
  subscribe: (listener: () => void) => {
    const stopDialog = launcherNativeDialogFocus.subscribe(listener)
    const stopPaste = pasteRecoveryFocus.subscribe(listener)
    return () => { stopDialog(); stopPaste() }
  },
}

type SurfaceShellConfig = PluginUiSurfaceContribution['shell']

type LauncherSettingsTarget = unknown

/**
 * Standalone surfaces (launcher host, detached quick editor, closeOnBlur:false
 * panels) can stay open after the user switches apps. Auto-exit after this much
 * continuous background time so orphaned windows do not linger indefinitely.
 */
export const STANDALONE_SURFACE_BACKGROUND_IDLE_MS = 5 * 60 * 1000

/** @deprecated Prefer STANDALONE_SURFACE_BACKGROUND_IDLE_MS */
export const STANDALONE_LAUNCHER_BACKGROUND_IDLE_MS = STANDALONE_SURFACE_BACKGROUND_IDLE_MS

/** True when the window has been continuously unfocused for idleMs. */
export function isStandaloneSurfaceBackgroundIdle(
  unfocusedAt: number | null | undefined,
  now: number,
  idleMs: number = STANDALONE_SURFACE_BACKGROUND_IDLE_MS,
): boolean {
  if (unfocusedAt == null || !Number.isFinite(unfocusedAt) || !Number.isFinite(now)) return false
  if (idleMs <= 0) return true
  return now - unfocusedAt >= idleMs
}

/** @deprecated Prefer isStandaloneSurfaceBackgroundIdle */
export const isStandaloneLauncherBackgroundIdle = isStandaloneSurfaceBackgroundIdle

export function useCloseStandaloneLauncherOnBlur({
  open,
  standaloneLauncher,
  closeOnBlur,
  closeLauncher,
}: {
  open: boolean
  standaloneLauncher: boolean
  closeOnBlur?: boolean
  closeLauncher: () => void
}) {
  const closeOnBlurRef = useRef(closeOnBlur)
  const closeLauncherRef = useRef(closeLauncher)

  useLayoutEffect(() => {
    closeOnBlurRef.current = closeOnBlur
  }, [closeOnBlur])

  useLayoutEffect(() => {
    closeLauncherRef.current = closeLauncher
  }, [closeLauncher])

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!isTauriRuntime()) return
    // Fresh session — do not carry a devtools blur-suppress over from a launcher
    // instance that was already closed. Once set below it stays on for the rest
    // of *this* open (see the comment in launcherBlurGuard.ts): clearing it on
    // the first regained-focus tick races with clicking back into the search
    // input to keep typing, since devtools can re-steal focus for a beat right
    // after and that follow-up blur would no longer be suppressed.
    clearStandaloneLauncherBlurDevtoolsSuppress()

    let disposed = false
    let unlisten: (() => void) | undefined
    let blurGeneration = 0
    const checkBlur = () => {
      if (launcherFocusLease.isActive()) return
      if (closeOnBlurRef.current === false) return
      // Smart blur: keep open when focus moves to clipboard history / other hiven windows.
      const generation = ++blurGeneration
      void shouldKeepLauncherOpenOnBlur().then((keepOpen) => {
        if (disposed || generation !== blurGeneration) return
        if (keepOpen) return
        if (launcherFocusLease.isActive()) return
        if (closeOnBlurRef.current === false) return
        closeLauncherRef.current()
      })
    }
    const stopDialogFocus = launcherNativeDialogFocus.subscribe(() => {
      // Invalidate a blur check that began before the chooser acquired focus.
      blurGeneration += 1
      if (!launcherNativeDialogFocus.isActive()) checkBlur()
    })
    // Invalidate work begun before handoff without treating a completed native
    // hide as a new blur. Native failure restores focus before resolving.
    const stopPasteFocus = pasteRecoveryFocus.subscribe(() => { blurGeneration += 1 })
    onCurrentLauncherWindowFocusChanged((focused) => {
      blurGeneration += 1
      if (observePasteRecoveryFocus(focused)) return
      if (!focused) checkBlur()
    })
      .then((cleanup) => {
        if (disposed) cleanup()
        else unlisten = cleanup
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for launcher focus changes:', error)
      })
    return () => {
      disposed = true
      stopDialogFocus()
      stopPasteFocus()
      unlisten?.()
    }
  }, [open, standaloneLauncher])
}

/**
 * When the current standalone window has not been foreground for
 * {@link STANDALONE_SURFACE_BACKGROUND_IDLE_MS}, call onClose (idle close).
 * Uses getCurrentWindow() focus events — works for the launcher webview and
 * the detached quick-editor webview alike.
 * Complements blur-dismiss: surfaces with closeOnBlur:false stay usable while
 * the user briefly switches apps, but do not stick around forever.
 */
export function useAutoCloseCurrentWindowOnBackgroundIdle({
  enabled,
  onClose,
  idleMs = STANDALONE_SURFACE_BACKGROUND_IDLE_MS,
  focusLease,
  restartVersion = 0,
}: {
  enabled: boolean
  onClose: () => void
  idleMs?: number
  focusLease?: { isActive: () => boolean; subscribe: (listener: () => void) => () => void }
  /** Discard elapsed idle time even when enabled is unchanged in a batched update. */
  restartVersion?: number
}) {
  const onCloseRef = useRef(onClose)
  const idleMsRef = useRef(idleMs)

  useLayoutEffect(() => {
    onCloseRef.current = onClose
  }, [onClose])

  useLayoutEffect(() => {
    idleMsRef.current = idleMs
  }, [idleMs])

  useLayoutEffect(() => {
    if (!enabled) return
    if (!isTauriRuntime()) return

    let disposed = false
    let timerId: number | null = null
    let unfocusedAt: number | null = null
    let unlisten: (() => void) | undefined
    let focusGeneration = 0

    const clearTimer = () => {
      if (timerId != null) {
        window.clearTimeout(timerId)
        timerId = null
      }
    }

    const armTimer = (from: number) => {
      clearTimer()
      if (focusLease?.isActive()) { unfocusedAt = null; return }
      unfocusedAt = from
      const remaining = Math.max(0, idleMsRef.current - (Date.now() - from))
      timerId = window.setTimeout(() => {
        timerId = null
        if (disposed) return
        if (focusLease?.isActive()) { unfocusedAt = null; return }
        if (isStandaloneSurfaceBackgroundIdle(unfocusedAt, Date.now(), idleMsRef.current)) {
          onCloseRef.current()
        }
      }, remaining)
    }

    const onFocusChanged = (focused: boolean) => {
      if (disposed) return
      focusGeneration += 1
      if (focused) {
        unfocusedAt = null
        clearTimer()
        return
      }
      armTimer(Date.now())
    }

    const probeFocus = async () => {
      const generation = ++focusGeneration
      try {
        const { getCurrentWindow } = await import('@tauri-apps/api/window')
        if (disposed || focusLease?.isActive()) return
        const focused = await getCurrentWindow().isFocused()
        if (disposed || generation !== focusGeneration || focusLease?.isActive()) return
        if (!focused && unfocusedAt == null) armTimer(Date.now())
      } catch {
        // Focus probe is best-effort; subsequent focus events still arm.
      }
    }
    const stopFocusLease = focusLease?.subscribe(() => {
      focusGeneration += 1
      clearTimer()
      unfocusedAt = null
      // A long chooser does not count as background idle. Start a fresh clock
      // only if its dismissal really leaves this window in the background.
      if (!focusLease.isActive()) void probeFocus()
    })

    // Name is historical; implementation is getCurrentWindow().onFocusChanged.
    onCurrentLauncherWindowFocusChanged(onFocusChanged)
      .then(async (cleanup) => {
        if (disposed) {
          cleanup()
          return
        }
        unlisten = cleanup
        // If the window is already backgrounded when we attach (e.g. surface
        // kept open with closeOnBlur:false), start the idle clock immediately.
        await probeFocus()
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for window background idle:', error)
      })

    return () => {
      disposed = true
      clearTimer()
      stopFocusLease?.()
      unlisten?.()
    }
  }, [enabled, focusLease, restartVersion])
}

/**
 * Launcher-host wrapper around {@link useAutoCloseCurrentWindowOnBackgroundIdle}.
 */
export function useAutoCloseStandaloneLauncherOnBackgroundIdle({
  open,
  standaloneLauncher,
  closeLauncher,
  paused = false,
  isPaused,
  restartVersion,
  idleMs = STANDALONE_SURFACE_BACKGROUND_IDLE_MS,
}: {
  open: boolean
  standaloneLauncher: boolean
  closeLauncher: () => void
  paused?: boolean
  /** Synchronous check for a dirty report arriving before the next commit. */
  isPaused?: () => boolean
  restartVersion?: number
  idleMs?: number
}) {
  useAutoCloseCurrentWindowOnBackgroundIdle({
    enabled: open && standaloneLauncher && !paused,
    onClose: () => { if (!isPaused?.()) closeLauncher() },
    idleMs,
    focusLease: launcherFocusLease,
    restartVersion,
  })
}

export function useStandaloneLauncherResize({
  open,
  standaloneLauncher,
  panelRef,
  hostSurfaceTarget,
  launcherSettingsTarget,
  surfaceShell,
  surfaceKey,
  visibleFilteredLength,
  /** Stable primitive signature for frame changes — NOT a new object every render. */
  controllerResizeKey,
}: {
  open: boolean
  standaloneLauncher: boolean
  panelRef: RefObject<HTMLDivElement | null>
  hostSurfaceTarget: LauncherHostSurfaceTarget | null
  launcherSettingsTarget: LauncherSettingsTarget
  surfaceShell: SurfaceShellConfig
  /** Stable surface instance, independent of input and controller changes. */
  surfaceKey: string | null
  visibleFilteredLength: number
  controllerResizeKey: string
}) {
  // Must live outside the effect — previously reset to '' on every dep change,
  // so sizeKey === lastSizeKey was always false → native resize every keystroke.
  const lastSizeKeyRef = useRef('')
  const initialWindowWidthRef = useRef<number | null>(null)
  const activeResizableSurfaceRef = useRef<string | null>(null)
  const initializedResizableSurfaceRef = useRef(false)
  const [nativeOpenVersion, setNativeOpenVersion] = useState(0)
  const resizableSurfaceKey = !hostSurfaceTarget && !launcherSettingsTarget && surfaceShell?.resizable === true
    ? surfaceKey
    : null
  // Input/results affect auto-sized search frames. A tool whose size belongs
  // to the user must not re-enter this effect on every keystroke or re-render.
  const contentResizeKey = resizableSurfaceKey ? '' : controllerResizeKey
  const contentVisibleLength = resizableSurfaceKey ? 0 : visibleFilteredLength
  const defaultWidth = surfaceShell?.defaultWidth
  const defaultHeight = surfaceShell?.defaultHeight
  const minWidth = surfaceShell?.minWidth
  const minHeight = surfaceShell?.minHeight
  const shellPresent = surfaceShell != null
  const compactWidth = !hostSurfaceTarget && !launcherSettingsTarget && !surfaceKey && !shellPresent

  useLayoutEffect(() => {
    if (!standaloneLauncher) return
    const resetForNativeOpen = () => {
      invalidateCurrentLauncherWindowResize()
      lastSizeKeyRef.current = ''
      initialWindowWidthRef.current = null
      activeResizableSurfaceRef.current = null
      initializedResizableSurfaceRef.current = false
      setNativeOpenVersion((version) => version + 1)
    }
    window.addEventListener(LAUNCHER_NEW_SESSION_EVENT, resetForNativeOpen)
    return () => window.removeEventListener(LAUNCHER_NEW_SESSION_EVENT, resetForNativeOpen)
  }, [standaloneLauncher])

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!isTauriRuntime()) return

    if (activeResizableSurfaceRef.current !== resizableSurfaceKey) {
      activeResizableSurfaceRef.current = resizableSurfaceKey
      initializedResizableSurfaceRef.current = false
      lastSizeKeyRef.current = ''
    }

    let disposed = false
    let frameId: number
    // One rAF normally suffices after layout: frame switches (e.g. diff → 2 choices)
    // used to wait a fixed 80ms and felt like a full expand even for tiny lists.
    const resizeAfterLayout = () => {
      if (disposed) return
      const initialWindowWidth = initialWindowWidthRef.current ?? window.innerWidth
      // A hidden webview can report zero until its first visible layout. Do not
      // keep that width for the whole open session or record an invalid size.
      if (!Number.isFinite(initialWindowWidth) || initialWindowWidth <= 0) {
        frameId = window.requestAnimationFrame(resizeAfterLayout)
        return
      }
      initialWindowWidthRef.current = initialWindowWidth
      const panel = panelRef.current
      if (!panel) return
      const geometry = computeStandaloneLauncherGeometry({
        panel,
        hostSurfaceTarget,
        launcherSettingsTarget,
        surfaceShell: shellPresent ? { defaultWidth, defaultHeight, minWidth, minHeight, resizable: Boolean(resizableSurfaceKey) } : undefined,
        currentWindowWidth: initialWindowWidth,
      })
      applyStandaloneLauncherGeometry(panel, geometry)

      const resizable = resizableSurfaceKey !== null
      const sizeKey = resizable
        ? `${resizableSurfaceKey}:${geometry.minWidth}:${geometry.minHeight}`
        : compactWidth
        ? `compact:${geometry.height}`
        : `auto:${geometry.width}:${geometry.height}`
      if (sizeKey === lastSizeKeyRef.current) return
      const size = compactWidth
        ? { compactWidth: true, height: geometry.height }
        : resizable && initializedResizableSurfaceRef.current
        ? {}
        : { width: geometry.width, height: geometry.height }
      logLauncherPerf('resize:native-window', { ...size, resizable })
      void configureCurrentLauncherWindow({
        resizable,
        minWidth: resizable ? geometry.minWidth : undefined,
        minHeight: resizable ? geometry.minHeight : undefined,
        ...size,
      }, () => !disposed)
        .then((applied) => {
          if (disposed) return
          if (applied) lastSizeKeyRef.current = sizeKey
          if (applied && resizable) initializedResizableSurfaceRef.current = true
          if (!applied && lastSizeKeyRef.current === sizeKey) lastSizeKeyRef.current = ''
        })
        .catch((error) => {
          if (!disposed && lastSizeKeyRef.current === sizeKey) lastSizeKeyRef.current = ''
          console.warn('[hiven] Failed to resize launcher window:', error)
        })
    }
    frameId = window.requestAnimationFrame(resizeAfterLayout)

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
      invalidateCurrentLauncherWindowResize()
    }
  }, [
    contentVisibleLength,
    nativeOpenVersion,
    open,
    contentResizeKey,
    standaloneLauncher,
    resizableSurfaceKey,
    shellPresent,
    compactWidth,
    defaultWidth,
    defaultHeight,
    minWidth,
    minHeight,
    hostSurfaceTarget,
    launcherSettingsTarget,
    panelRef,
  ])

  // Reset dedupe when launcher closes so next open can compact→expand once.
  useLayoutEffect(() => {
    if (!open) {
      lastSizeKeyRef.current = ''
      initialWindowWidthRef.current = null
      activeResizableSurfaceRef.current = null
      initializedResizableSurfaceRef.current = false
      invalidateCurrentLauncherWindowResize()
    }
  }, [open])
}

export function useFocusGlobalLauncherSurfaceShell({
  panelRef,
  surfaceFrame,
  launcherSettingsTarget,
  hostSurfaceTarget,
  surfaceFocusVersion,
}: {
  panelRef: RefObject<HTMLDivElement | null>
  surfaceFrame: unknown
  launcherSettingsTarget: unknown
  hostSurfaceTarget: unknown
  surfaceFocusVersion: number
}) {
  useLayoutEffect(() => {
    if (!surfaceFrame && !launcherSettingsTarget && !hostSurfaceTarget) return
    const frame = window.requestAnimationFrame(() => {
      const shell = panelRef.current?.querySelector<HTMLElement>('.global-launcher-surface-shell, .global-launcher-settings-shell, .global-launcher-host-surface-shell')
      const focusTarget =
        shell?.querySelector<HTMLElement>('[data-plugin-surface-autofocus]') ??
        shell
      focusTarget?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [hostSurfaceTarget, launcherSettingsTarget, panelRef, surfaceFrame, surfaceFocusVersion])
}

export function useGlobalLauncherNativeDrag(standaloneLauncher: boolean) {
  return useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    if (!(event.target instanceof HTMLElement)) return

    // Never steal gestures from interactive controls.
    // Header/search chrome (padding, search icon) IS a drag handle — only the
    // actual <input> stays non-drag so focus still works. CSS app-region alone
    // is unreliable on transparent Tauri windows, so we always use startDragging.
    if (
      event.target.closest(
        [
          '[data-launcher-scrollable]',
          '[data-no-drag]',
          'input',
          'textarea',
          'select',
          'button',
          'a',
          'pre',
          '[role="button"]',
          '[role="grid"]',
          '[role="row"]',
          '[role="gridcell"]',
          '[role="columnheader"]',
          '.monaco-editor',
          '.rdg',
          '.csv-tools-surface',
          '.global-launcher-surface-shell .global-launcher-body',
          '.global-launcher-body',
          '.launcher-empty-well',
          '.l-row',
          '.cmd-item',
          '.object-block-remove',
        ].join(', '),
      )
    ) {
      return
    }

    // Standalone launcher window only. Position TTL is persisted in App.tsx `onMoved`.
    if (standaloneLauncher && isTauriRuntime()) {
      event.preventDefault()
      event.stopPropagation()
      try {
        void startCurrentLauncherWindowDrag().catch((error) => {
          console.warn('[hiven] Failed to drag launcher window:', error)
        })
      } catch (error) {
        console.warn('[hiven] Failed to drag launcher window:', error)
      }
    }
  }, [standaloneLauncher])
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
