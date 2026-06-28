import { useCallback, useEffect, useMemo, useState } from 'react'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import type { PluginSurfaceOpenTarget } from '../../store'
import { samePluginSurfaceTarget } from './GlobalLauncherSurfaceRegistry'
import { getPluginSurfaceDefinition } from './GlobalLauncherSelection'

export const PLUGIN_SURFACE_BACK_EVENT = 'hiven:plugin-surface-back'
export const PLUGIN_SURFACE_CLOSE_EVENT = 'hiven:plugin-surface-close'

export type GlobalLauncherSurfaceFrameTarget = {
  source: PluginSettingsSource
  pluginId: string
  surfaceId: string
}

export function useGlobalLauncherSurfaceFrame({
  open,
  pluginRegistryVersion,
  pluginSurfaceToolTarget,
  closeLauncher,
}: {
  open: boolean
  pluginRegistryVersion: number
  pluginSurfaceToolTarget: PluginSurfaceOpenTarget | null
  closeLauncher: () => void
}) {
  const [surfaceFrame, setSurfaceFrame] = useState<GlobalLauncherSurfaceFrameTarget | null>(null)
  const [surfaceFocusVersion, setSurfaceFocusVersion] = useState(0)

  const openPluginSurface = useCallback(async (target: GlobalLauncherSurfaceFrameTarget) => {
    if (!getPluginSurfaceDefinition(target)) return
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

  const leaveSurface = useCallback(() => {
    if (surfaceFrame && pluginSurfaceToolTarget && samePluginSurfaceTarget(surfaceFrame, pluginSurfaceToolTarget)) {
      closeLauncher()
      return
    }
    setSurfaceFrame(null)
  }, [closeLauncher, pluginSurfaceToolTarget, surfaceFrame])

  const closeSurface = useCallback(() => {
    setSurfaceFrame(null)
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
