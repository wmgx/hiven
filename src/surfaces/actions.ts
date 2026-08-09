import { getSurfaceInstance, markSurfaceInstanceState, type SurfaceInstance } from './registry'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { showLauncherWindow } from '../workspace/windowManager/launcherWindow'
import { showPluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import { requestOpenLauncherHostSurface, requestOpenLauncherPluginSettingsSurface } from '../workspace/launcherHostSurfaceBridge'
import { showQuickEditorSurface } from '../workspace/quickEditor/quickEditorRequests'

/**
 * Focus / restore a surface instance.
 *
 * Plugin Editor as a first-class surface was retired (no IDE-in-app product).
 * Legacy `plugin-editor` kinds open Plugins host surface and, when possible,
 * the plugin's settings dialog.
 */
export async function focusSurfaceInstance(surfaceOrId: SurfaceInstance | string): Promise<boolean> {
  const surface = typeof surfaceOrId === 'string' ? getSurfaceInstance(surfaceOrId) : surfaceOrId
  if (!surface) return false

  if (surface.kind === 'editor') {
    await showQuickEditorSurface()
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  if (surface.kind === 'launcher') {
    await showLauncherWindow()
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  if (surface.kind === 'settings') {
    if (surface.pluginId) {
      await requestOpenLauncherPluginSettingsSurface(
        sourceFromSettingsSurfaceInstanceId(surface.id),
        surface.pluginId,
      )
    } else {
      await requestOpenLauncherHostSurface('system-settings')
    }
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  if (surface.kind === 'plugins') {
    await requestOpenLauncherHostSurface('system-plugins')
    markSurfaceInstanceState(surface.id, 'visible')
    return true
  }

  if (surface.kind === 'plugin-editor') {
    // Retired surface: land on Plugins manager; open settings when we know the plugin.
    await requestOpenLauncherHostSurface('system-plugins')
    if (surface.pluginId) {
      const source = sourceFromPluginEditorSurfaceInstanceId(surface.id)
      await requestOpenLauncherPluginSettingsSurface(source, surface.pluginId)
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

function sourceFromPluginEditorSurfaceInstanceId(id: string): PluginSettingsSource {
  const source = id.split(':')[2]
  return source === 'builtin' || source === 'dev' ? source : 'installed'
}
