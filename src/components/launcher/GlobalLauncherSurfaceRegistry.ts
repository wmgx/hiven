import { useEffect } from 'react'
import type { PluginSurfaceOpenTarget } from '../../store'
import type { PluginSettingsSource } from '../../workspace/pluginSettingsStore'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../../surfaces/registry'
import { pluginSurfaceInstanceId } from '../../workspace/pluginSurfaceWindows'
import { LAUNCHER_WINDOW_LABEL } from '../../workspace/windowManager/windowLabels'
import type { PluginSurfaceTarget } from './GlobalLauncherSelection'

type LauncherHostSurfaceTarget = 'settings' | 'plugins' | null

type LauncherSettingsTarget = {
  source: PluginSettingsSource
  pluginId: string
} | null

type ActivePluginSurfaceFrame = {
  surface: {
    title?: string
  }
} | null

export function useGlobalLauncherSurfaceRegistry({
  open,
  standaloneLauncher,
  launcherSettingsTarget,
  hostSurfaceTarget,
  surfaceFrame,
  activeSurfaceFrame,
  controllerReset,
}: {
  open: boolean
  standaloneLauncher: boolean
  launcherSettingsTarget: LauncherSettingsTarget
  hostSurfaceTarget: LauncherHostSurfaceTarget
  surfaceFrame: PluginSurfaceTarget | null
  activeSurfaceFrame: ActivePluginSurfaceFrame
  controllerReset: () => void
}) {
  useEffect(() => {
    if (!open) return
    upsertSurfaceInstance({
      id: LAUNCHER_WINDOW_LABEL,
      kind: 'launcher',
      windowLabel: LAUNCHER_WINDOW_LABEL,
      title: 'Hiven Launcher',
      state: 'visible',
      canReceiveText: true,
    })
  }, [open, standaloneLauncher])

  useEffect(() => {
    if (open) return
    markSurfaceInstanceState(LAUNCHER_WINDOW_LABEL, 'hidden')
    controllerReset()
  }, [controllerReset, open])

  useEffect(() => {
    if (!open || !launcherSettingsTarget) return
    upsertSurfaceInstance({
      id: `settings:${launcherSettingsTarget.source}:${launcherSettingsTarget.pluginId}`,
      kind: 'settings',
      windowLabel: LAUNCHER_WINDOW_LABEL,
      title: 'Plugin Settings',
      pluginId: launcherSettingsTarget.pluginId,
      state: 'visible',
      canReceiveText: false,
      canProvideText: false,
    })
  }, [launcherSettingsTarget, open, standaloneLauncher])

  useEffect(() => {
    if (!open || !hostSurfaceTarget) return
    upsertSurfaceInstance({
      id: `host-surface:${hostSurfaceTarget}`,
      kind: hostSurfaceTarget === 'plugins' ? 'plugins' : 'settings',
      windowLabel: LAUNCHER_WINDOW_LABEL,
      title: hostSurfaceTarget === 'plugins' ? 'Plugins' : 'Settings',
      state: 'visible',
      canReceiveText: false,
      canProvideText: false,
    })
  }, [hostSurfaceTarget, open, standaloneLauncher])

  useEffect(() => {
    if (!open || !surfaceFrame) return
    upsertSurfaceInstance({
      id: pluginSurfaceInstanceId(surfaceFrame),
      kind: 'plugin-surface',
      windowLabel: LAUNCHER_WINDOW_LABEL,
      title: activeSurfaceFrame?.surface.title ?? surfaceFrame.surfaceId,
      pluginId: surfaceFrame.pluginId,
      surfaceId: surfaceFrame.surfaceId,
      state: 'visible',
      canReceiveText: true,
      canProvideText: true,
      canAttachToEditor: true,
    })
  }, [activeSurfaceFrame?.surface.title, open, standaloneLauncher, surfaceFrame])
}

export function samePluginSurfaceTarget(
  a: PluginSurfaceOpenTarget,
  b: PluginSurfaceOpenTarget,
): boolean {
  return a.source === b.source && a.pluginId === b.pluginId && a.surfaceId === b.surfaceId
}
