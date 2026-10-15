import { saveClipboardImageFromShortcut } from './clipboardImageSaveHandoff'
import { installRegisteredSurfaceShortcutHandler } from './hotkeys/pluginSurfaceShortcuts'
import { isCurrentBundledDefinition } from './workspace/bundledPluginIdentity'
import { getPluginPermissionSnapshot, missingPluginPermissions } from './workspace/pluginPermissions'
import { pluginRegistry } from './workspace/pluginRegistry'
import { pluginSurfaceShortcutKey, usePluginSurfaceShortcutStore } from './workspace/pluginSurfaceShortcuts'

const TARGET = { source: 'builtin' as const, pluginId: 'encode-decode', surfaceId: 'image-save' }
const REQUIRED = ['clipboard.read', 'clipboard.image', 'storage.blob', 'clipboard.write'] as const
let installedStop: (() => void) | null = null

function readyDefinition(): object | null {
  const definition = pluginRegistry.getPluginDefinition(TARGET.pluginId, 'production')
  if (!definition || !isCurrentBundledDefinition(TARGET.pluginId, TARGET.source, definition)) return null
  const requested = pluginRegistry.getPluginPermissions(TARGET.pluginId, TARGET.source)
  if (!REQUIRED.every((permission) => requested.includes(permission))) return null
  const snapshot = getPluginPermissionSnapshot(TARGET.source, TARGET.pluginId, requested)
  return missingPluginPermissions(snapshot, [...REQUIRED]).length ? null : definition
}

/** Narrow app-composition host for the bundled Save Screenshot action. */
export function installClipboardImageSaveShortcut(): () => void {
  if (installedStop || new URLSearchParams(window.location.search).get('window') !== 'launcher'
    || !(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return () => {}
  let alive = true
  const key = pluginSurfaceShortcutKey(TARGET)

  const current = (definition: object) => {
    const shortcut = usePluginSurfaceShortcutStore.getState().shortcuts[key]
    return alive && shortcut?.enabled === true && shortcut.registrationStatus === 'registered'
      && readyDefinition() === definition
  }
  const release = installRegisteredSurfaceShortcutHandler(TARGET, async () => {
    const definition = readyDefinition()
    if (!definition || !current(definition)) return true
    await saveClipboardImageFromShortcut(() => current(definition), definition)
    return true
  })

  const stop = () => {
    if (!alive) return
    alive = false
    release()
    installedStop = null
  }
  installedStop = stop
  return stop
}
