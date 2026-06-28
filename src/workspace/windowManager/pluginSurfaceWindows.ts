import { getCurrentWindow } from '@tauri-apps/api/window'

export {
  getPluginSurfaceShortcutPresentation,
  pluginSurfaceInstanceId,
  pluginSurfaceWindowLabel,
  requestHidePluginSurfaceWindow as hidePluginSurfaceWindow,
  requestOpenPluginSurfaceWindow as showPluginSurfaceWindow,
} from '../pluginSurfaceWindows'

export async function hideCurrentPluginSurfaceWindow(): Promise<void> {
  await getCurrentWindow().hide()
}
