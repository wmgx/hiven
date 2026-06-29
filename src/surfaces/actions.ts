import { getSurfaceInstance, markSurfaceInstanceState, type SurfaceInstance } from './registry'
import { useAppStore } from '../store'
import { usePluginSettingsStore, type PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { showEditorWindow } from '../workspace/windowManager/editorWindow'
import { showLauncherWindow } from '../workspace/windowManager/launcherWindow'
import { showPluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'

export async function focusSurfaceInstance(surfaceOrId: SurfaceInstance | string): Promise<boolean> {
  const surface = typeof surfaceOrId === 'string' ? getSurfaceInstance(surfaceOrId) : surfaceOrId
  if (!surface) return false

  if (surface.kind === 'editor') {
    await showEditorWindow()
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  if (surface.kind === 'launcher') {
    await showLauncherWindow()
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  if (surface.kind === 'settings') {
    await showLauncherWindow()
    if (surface.pluginId) {
      usePluginSettingsStore.getState().openSettingsDialog({
        source: sourceFromSettingsSurfaceInstanceId(surface.id),
        pluginId: surface.pluginId,
        presentation: 'global-launcher',
        context: { surfaceId: 'global-launcher' },
      })
    } else {
      useAppStore.getState().openLauncherHostSurface('settings')
    }
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  if (surface.kind === 'plugins') {
    await showLauncherWindow()
    useAppStore.getState().openLauncherHostSurface('plugins')
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  if (surface.kind === 'plugin-surface' && surface.pluginId && surface.surfaceId) {
    const source = sourceFromPluginSurfaceInstanceId(surface.id)
    await showPluginSurfaceWindow({
      source,
      pluginId: surface.pluginId,
      surfaceId: surface.surfaceId,
    })
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  return false
}

function sourceFromPluginSurfaceInstanceId(id: string): 'builtin' | 'installed' | 'dev' {
  const source = id.split(':')[1]
  return source === 'installed' || source === 'dev' ? source : 'builtin'
}

function sourceFromSettingsSurfaceInstanceId(id: string): PluginSettingsSource {
  const source = id.split(':')[1]
  return source === 'installed' || source === 'dev' ? source : 'builtin'
}
