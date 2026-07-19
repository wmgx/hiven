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
    if (
      event.target instanceof HTMLElement &&
      event.target.closest(
        // data-launcher-scrollable / data-no-drag first: keep contract + early match for surfaces/tables.
        // .l-search / header: never start native startDragging from the search row —
        // that steals the click and prevents the input from focusing.
        '[data-launcher-scrollable], [data-no-drag], input, textarea, select, button, a, pre, [role="button"], [role="grid"], [role="row"], [role="gridcell"], [role="columnheader"], .monaco-editor, .rdg, .csv-tools-surface, .global-launcher-surface-shell .global-launcher-body, .global-launcher-header, .l-search',
      )
    ) {
      return
    }
    // Only the standalone launcher window is draggable, via the native Tauri
    // window drag. Its position (with TTL) is persisted in App.tsx `onMoved`.
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
