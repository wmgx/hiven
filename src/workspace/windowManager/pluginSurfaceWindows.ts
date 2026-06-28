import type { PluginSurfaceOpenTarget } from '../../store'
import {
  getPluginSurfaceShortcutPresentation,
  pluginSurfaceInstanceId,
  pluginSurfaceWindowLabel,
  requestHidePluginSurfaceWindow,
  requestOpenPluginSurfaceWindow,
} from '../pluginSurfaceWindows'

export {
  getPluginSurfaceShortcutPresentation,
  pluginSurfaceInstanceId,
  pluginSurfaceWindowLabel,
}

export async function showPluginSurfaceWindow(target: PluginSurfaceOpenTarget): Promise<void> {
  await requestOpenPluginSurfaceWindow(target)
}

export async function hidePluginSurfaceWindow(target: PluginSurfaceOpenTarget): Promise<void> {
  await requestHidePluginSurfaceWindow(target)
}

export async function hideCurrentPluginSurfaceWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().hide()
}
