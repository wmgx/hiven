import { useCallback, useLayoutEffect, useRef, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import type { LauncherHostSurfaceTarget } from '../../store'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from '../../workspace/launcherWindowEvents'
import { onCurrentLauncherWindowFocusChanged, resizeCurrentLauncherWindow, startCurrentLauncherWindowDrag } from '../../workspace/windowManager/launcherWindow'
import { shouldSuppressStandaloneLauncherBlur } from '../../workspace/launcherBlurGuard'
import { applyStandaloneLauncherGeometry, computeStandaloneLauncherGeometry } from './GlobalLauncherLayout'
import { logLauncherPerf } from '../../workspace/launcher/perf'

type SurfaceShellConfig = {
  closeOnBlur?: boolean
} | undefined

type LauncherSettingsTarget = unknown

/**
 * Standalone launcher windows (especially closeOnBlur:false surfaces) can stay
 * open after the user switches apps. Auto-exit after this much continuous
 * background time so orphaned windows do not linger indefinitely.
 */
export const STANDALONE_LAUNCHER_BACKGROUND_IDLE_MS = 5 * 60 * 1000

/** True when the window has been continuously unfocused for idleMs. */
export function isStandaloneLauncherBackgroundIdle(
  unfocusedAt: number | null | undefined,
  now: number,
  idleMs: number = STANDALONE_LAUNCHER_BACKGROUND_IDLE_MS,
): boolean {
  if (unfocusedAt == null || !Number.isFinite(unfocusedAt) || !Number.isFinite(now)) return false
  if (idleMs <= 0) return true
  return now - unfocusedAt >= idleMs
}

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

  useLayoutEffect(() => {
    closeOnBlurRef.current = closeOnBlur
  }, [closeOnBlur])

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!isTauriRuntime()) return
    if (closeOnBlurRef.current === false) return

    let disposed = false
    let unlisten: (() => void) | undefined
    onCurrentLauncherWindowFocusChanged((focused) => {
      if (!focused && shouldSuppressStandaloneLauncherBlur()) return
      if (!focused && closeOnBlurRef.current !== false) closeLauncher()
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
      unlisten?.()
    }
  }, [closeOnBlur, closeLauncher, open, standaloneLauncher])
}

/**
 * When the standalone global launcher window has not been foreground for
 * {@link STANDALONE_LAUNCHER_BACKGROUND_IDLE_MS}, close it (idle close).
 * Complements blur-dismiss: surfaces with closeOnBlur:false stay usable while
 * the user briefly switches apps, but do not stick around forever.
 */
export function useAutoCloseStandaloneLauncherOnBackgroundIdle({
  open,
  standaloneLauncher,
  closeLauncher,
  idleMs = STANDALONE_LAUNCHER_BACKGROUND_IDLE_MS,
}: {
  open: boolean
  standaloneLauncher: boolean
  closeLauncher: () => void
  idleMs?: number
}) {
  const closeLauncherRef = useRef(closeLauncher)
  const idleMsRef = useRef(idleMs)

  useLayoutEffect(() => {
    closeLauncherRef.current = closeLauncher
  }, [closeLauncher])

  useLayoutEffect(() => {
    idleMsRef.current = idleMs
  }, [idleMs])

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!isTauriRuntime()) return

    let disposed = false
    let timerId: number | null = null
    let unfocusedAt: number | null = null
    let unlisten: (() => void) | undefined

    const clearTimer = () => {
      if (timerId != null) {
        window.clearTimeout(timerId)
        timerId = null
      }
    }

    const armTimer = (from: number) => {
      clearTimer()
      unfocusedAt = from
      const remaining = Math.max(0, idleMsRef.current - (Date.now() - from))
      timerId = window.setTimeout(() => {
        timerId = null
        if (disposed) return
        if (isStandaloneLauncherBackgroundIdle(unfocusedAt, Date.now(), idleMsRef.current)) {
          closeLauncherRef.current()
        }
      }, remaining)
    }

    const onFocusChanged = (focused: boolean) => {
      if (disposed) return
      if (focused) {
        unfocusedAt = null
        clearTimer()
        return
      }
      armTimer(Date.now())
    }

    onCurrentLauncherWindowFocusChanged(onFocusChanged)
      .then(async (cleanup) => {
        if (disposed) {
          cleanup()
          return
        }
        unlisten = cleanup
        // If the window is already backgrounded when we attach (e.g. surface
        // kept open with closeOnBlur:false), start the idle clock immediately.
        try {
          const { getCurrentWindow } = await import('@tauri-apps/api/window')
          if (disposed) return
          const focused = await getCurrentWindow().isFocused()
          if (disposed) return
          if (!focused && unfocusedAt == null) armTimer(Date.now())
        } catch {
          // Focus probe is best-effort; subsequent focus events still arm.
        }
      })
      .catch((error) => {
        console.warn('[hiven] Failed to listen for launcher background idle:', error)
      })

    return () => {
      disposed = true
      clearTimer()
      unlisten?.()
    }
  }, [open, standaloneLauncher])
}

export function useStandaloneLauncherResize({
  open,
  standaloneLauncher,
  panelRef,
  hostSurfaceTarget,
  launcherSettingsTarget,
  surfaceShell,
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
  visibleFilteredLength: number
  controllerResizeKey: string
}) {
  // Must live outside the effect — previously reset to '' on every dep change,
  // so sizeKey === lastSizeKey was always false → native resize every keystroke.
  const lastSizeKeyRef = useRef('')

  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!isTauriRuntime()) return

    let disposed = false
    // One rAF is enough after layout: frame switches (e.g. diff → 2 choices)
    // used to wait a fixed 80ms and felt like a full expand even for tiny lists.
    const frameId = window.requestAnimationFrame(() => {
      if (disposed) return
      const panel = panelRef.current
      if (!panel) return
      const geometry = computeStandaloneLauncherGeometry({
        panel,
        hostSurfaceTarget,
        launcherSettingsTarget,
        surfaceShell,
      })
      applyStandaloneLauncherGeometry(panel, geometry)

      const sizeKey = `${geometry.width}:${geometry.height}`
      if (sizeKey === lastSizeKeyRef.current) return
      lastSizeKeyRef.current = sizeKey
      logLauncherPerf('resize:native-window', { width: geometry.width, height: geometry.height })
      window.dispatchEvent(new CustomEvent(LAUNCHER_PROGRAMMATIC_MOVE_EVENT))
      void resizeCurrentLauncherWindow({ width: geometry.width, height: geometry.height })
        .catch((error) => {
          console.warn('[hiven] Failed to resize launcher window:', error)
        })
    })

    return () => {
      disposed = true
      window.cancelAnimationFrame(frameId)
    }
  }, [
    visibleFilteredLength,
    open,
    controllerResizeKey,
    standaloneLauncher,
    surfaceShell,
    hostSurfaceTarget,
    launcherSettingsTarget,
    panelRef,
  ])

  // Reset dedupe when launcher closes so next open can compact→expand once.
  useLayoutEffect(() => {
    if (!open) lastSizeKeyRef.current = ''
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
