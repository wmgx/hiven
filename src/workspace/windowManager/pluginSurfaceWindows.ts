export {
  getPluginSurfaceShortcutPresentation,
  pluginSurfaceInstanceId,
  pluginSurfaceWindowLabel,
  requestHidePluginSurfaceWindow as hidePluginSurfaceWindow,
  requestOpenPluginSurfaceWindow as showPluginSurfaceWindow,
} from '../pluginSurfaceWindows'

export async function hideCurrentPluginSurfaceWindow(): Promise<void> {
  const { getCurrentWindow } = await import('@tauri-apps/api/window')
  await getCurrentWindow().hide()
}
