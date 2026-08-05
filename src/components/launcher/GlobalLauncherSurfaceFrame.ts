import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import { useAppStore, type PluginSurfaceOpenTarget } from '../../store'
import { samePluginSurfaceTarget } from './GlobalLauncherSurfaceRegistry'
import { getPluginSurfaceDefinition } from './GlobalLauncherSelection'

export const PLUGIN_SURFACE_BACK_EVENT = 'hiven:plugin-surface-back'
export const PLUGIN_SURFACE_CLOSE_EVENT = 'hiven:plugin-surface-close'

export type GlobalLauncherSurfaceFrameTarget = {
  source: PluginSettingsSource
  pluginId: string
  surfaceId: string
  /** Clipboard / Object Block payload (or host-resolved file contents). */
  initialText?: string
}

export function useGlobalLauncherSurfaceFrame({
  open,
  pluginRegistryVersion,
  pluginSurfaceToolTarget,
  closeLauncher,
  onReturnedToList,
}: {
  open: boolean
  pluginRegistryVersion: number
  pluginSurfaceToolTarget: PluginSurfaceOpenTarget | null
  /** Only for explicit close (×). ESC/back must never jump straight to this. */
  closeLauncher: () => void
  /** After ESC/back pops the surface back to the launcher list. */
  onReturnedToList?: () => void
}) {
  const [surfaceFrame, setSurfaceFrame] = useState<GlobalLauncherSurfaceFrameTarget | null>(null)
  const [surfaceFocusVersion, setSurfaceFocusVersion] = useState(0)

  const openPluginSurface = useCallback(async (target: GlobalLauncherSurfaceFrameTarget) => {
    if (!getPluginSurfaceDefinition(target)) {
      console.warn(
        '[hiven] Cannot open plugin surface — definition missing:',
        target.pluginId,
        target.surfaceId,
      )
      return
    }
    setSurfaceFrame(target)
    setSurfaceFocusVersion((version) => version + 1)
  }, [pluginRegistryVersion])

  useEffect(() => {
    if (!open || !pluginSurfaceToolTarget) return
    const timer = window.setTimeout(() => {
      void openPluginSurface(pluginSurfaceToolTarget)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [open, pluginSurfaceToolTarget, openPluginSurface])

  const activeSurfaceFrame = useMemo(() => {
    void pluginRegistryVersion
    if (!surfaceFrame) return null
    return getPluginSurfaceDefinition(surfaceFrame)
  }, [surfaceFrame, pluginRegistryVersion])

  /**
   * System back (ESC / breadcrumb back): pop exactly one navigation layer.
   * Never closes the launcher — only explicit close (×) does that.
   *
   * Order:
   * 1. Leave current plugin surface
   * 2. Restore suspended host (e.g. quick-editor under Diff), if any
   * 3. Otherwise return to the launcher list
   */
  const leaveSurface = useCallback(() => {
    const wasToolSurface = Boolean(
      surfaceFrame &&
      pluginSurfaceToolTarget &&
      samePluginSurfaceTarget(surfaceFrame, pluginSurfaceToolTarget),
    )

    setSurfaceFrame(null)

    if (wasToolSurface) {
      useAppStore.getState().clearPluginSurfaceTool()
    }

    if (useAppStore.getState().restorePreviousLauncherHostSurface()) {
      return
    }

    onReturnedToList?.()
  }, [onReturnedToList, pluginSurfaceToolTarget, surfaceFrame])

  const closeSurface = useCallback(() => {
    setSurfaceFrame(null)
    useAppStore.getState().clearPluginSurfaceTool()
    // Explicit close discards any suspended host surface.
    useAppStore.setState({ previousLauncherHostSurfaceTarget: null })
    closeLauncher()
  }, [closeLauncher])

  const requestSurfaceBack = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PLUGIN_SURFACE_BACK_EVENT))
  }, [])

  const requestSurfaceClose = useCallback(() => {
    window.dispatchEvent(new CustomEvent(PLUGIN_SURFACE_CLOSE_EVENT))
  }, [])

  const leaveCrashedSurface = useCallback(() => {
    setSurfaceFrame(null)
  }, [])

  useEffect(() => {
    if (!open) return
    window.addEventListener(PLUGIN_SURFACE_BACK_EVENT, leaveSurface)
    window.addEventListener(PLUGIN_SURFACE_CLOSE_EVENT, closeSurface)
    return () => {
      window.removeEventListener(PLUGIN_SURFACE_BACK_EVENT, leaveSurface)
      window.removeEventListener(PLUGIN_SURFACE_CLOSE_EVENT, closeSurface)
    }
  }, [closeSurface, leaveSurface, open])

  return {
    surfaceFrame,
    setSurfaceFrame,
    activeSurfaceFrame,
    surfaceFocusVersion,
    openPluginSurface,
    leaveSurface,
    closeSurface,
    requestSurfaceBack,
    requestSurfaceClose,
    leaveCrashedSurface,
  }
}
