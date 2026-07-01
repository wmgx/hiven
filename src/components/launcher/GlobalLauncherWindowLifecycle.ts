import { useCallback, useLayoutEffect, type PointerEvent as ReactPointerEvent, type RefObject } from 'react'
import { LAUNCHER_PROGRAMMATIC_MOVE_EVENT } from '../../workspace/launcherWindowEvents'
import { onCurrentLauncherWindowFocusChanged, resizeCurrentLauncherWindow, startCurrentLauncherWindowDrag } from '../../workspace/windowManager/launcherWindow'
import { computeStandaloneLauncherSize } from './GlobalLauncherLayout'

type SurfaceShellConfig = {
  closeOnBlur?: boolean
} | undefined

type LauncherHostSurfaceTarget = 'settings' | 'plugins' | null

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
  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!isTauriRuntime()) return

    let disposed = false
    let unlisten: (() => void) | undefined
    onCurrentLauncherWindowFocusChanged((focused) => {
      if (!focused && closeOnBlur !== false) closeLauncher()
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
  }, [closeLauncher, closeOnBlur, open, standaloneLauncher])
}

export function useStandaloneLauncherResize({
  open,
  standaloneLauncher,
  panelRef,
  hostSurfaceTarget,
  launcherSettingsTarget,
  surfaceShell,
  visibleFilteredLength,
  mode,
  controllerState,
}: {
  open: boolean
  standaloneLauncher: boolean
  panelRef: RefObject<HTMLDivElement | null>
  hostSurfaceTarget: LauncherHostSurfaceTarget
  launcherSettingsTarget: LauncherSettingsTarget
  surfaceShell: SurfaceShellConfig
  visibleFilteredLength: number
  mode: unknown
  controllerState: unknown
}) {
  useLayoutEffect(() => {
    if (!open || !standaloneLauncher) return
    if (!isTauriRuntime()) return

    const timer = window.setTimeout(() => {
      const panel = panelRef.current
      if (!panel) return
      const { width: nextWidth, height: nextHeight } = computeStandaloneLauncherSize({
        panel,
        hostSurfaceTarget,
        launcherSettingsTarget,
        surfaceShell,
        mode: mode as string | undefined,
      })
      window.dispatchEvent(new CustomEvent(LAUNCHER_PROGRAMMATIC_MOVE_EVENT))
      void resizeCurrentLauncherWindow({ width: nextWidth, height: nextHeight })
        .catch((error) => {
          console.warn('[hiven] Failed to resize launcher window:', error)
        })
    }, 150)

    return () => window.clearTimeout(timer)
  }, [
    visibleFilteredLength,
    mode,
    open,
    controllerState,
    standaloneLauncher,
    surfaceShell,
    hostSurfaceTarget,
    launcherSettingsTarget,
    panelRef,
  ])
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
    if (event.target instanceof HTMLElement && event.target.closest('input, textarea, select, button, a, [role="button"], [data-no-drag], [data-launcher-scrollable]')) return
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
