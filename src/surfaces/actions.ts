import { getSurfaceInstance, markSurfaceInstanceState, type SurfaceInstance } from './registry'
import { useAppStore } from '../store'
import { usePluginSettingsStore, type PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { showEditorWindow } from '../workspace/windowManager/editorWindow'
import { showLauncherWindow } from '../workspace/windowManager/launcherWindow'
import { showPluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import { requestOpenPluginEditorSurface } from './pluginEditorSurfaceBridge'

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

  if (surface.kind === 'plugin-editor') {
    await showLauncherWindow()
    useAppStore.getState().openLauncherHostSurface('plugins')
    if (surface.pluginId && surface.folderPath) {
      const source = sourceFromPluginEditorSurfaceInstanceId(surface.id)
      requestOpenPluginEditorSurface({
        pluginId: surface.pluginId,
        folderPath: surface.folderPath,
        activeFile: surface.surfaceId === 'plugin-editor' ? undefined : surface.surfaceId,
        source,
        readOnly: source === 'builtin',
      })
    }
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

function sourceFromPluginEditorSurfaceInstanceId(id: string): 'builtin' | 'installed' | 'dev' {
  const source = id.split(':')[2]
  return source === 'builtin' || source === 'dev' ? source : 'installed'
}
