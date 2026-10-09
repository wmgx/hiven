import type { PluginBlobSaveResult, PluginPermissionSnapshot, PluginPrivateStorageApi } from './pluginTypes'
import type { PluginSettingsSource } from './pluginSettingsStore'
import { getPluginPermissionSnapshot, requirePluginPermissions, usePluginPermissionStore } from './pluginPermissions'
import { pluginRegistry } from './pluginRegistry'
import { usePluginStore } from './pluginStore'
import { resolvePluginSettingsSource } from './launcher/pluginSource'
import { acquireLauncherNativeDialogFocus } from './launcherBlurGuard'

type PreparedPngExport = { status: 'cancelled' } | { status: 'prepared'; exportId: number }

/** Host-only owner guard. Plugins never receive destination paths or native tickets. */
export type PluginStorageOwner = { capture: () => () => boolean }

export function createPluginPngSaver(
  source: PluginSettingsSource,
  pluginId: string,
  permissions?: PluginPermissionSnapshot,
  owner?: PluginStorageOwner,
): PluginPrivateStorageApi['blob']['savePng'] {
  const lifetime = pluginRegistry.getPluginLifetime(pluginId, source)

  const requireOwner = () => {
    if (!lifetime.active || pluginRegistry.getPluginLifetime(pluginId, source) !== lifetime ||
      resolvePluginSettingsSource(pluginId, source === 'dev' ? 'dev' : 'production') !== source) {
      throw new Error('Plugin image export owner is no longer active')
    }
    const requested = pluginRegistry.getPluginPermissions(pluginId, source)
    if (!requested.includes('storage.blob')) throw new Error('Plugin permission required: storage.blob')
    if (permissions) requirePluginPermissions(permissions, ['storage.blob'])
    requirePluginPermissions(getPluginPermissionSnapshot(source, pluginId, requested), ['storage.blob'])
  }

  return async (blobId, options): Promise<PluginBlobSaveResult> => {
    const isCurrentOwner = owner?.capture()
    let invalidated = false
    const requireCurrent = () => {
      if (invalidated || (isCurrentOwner && !isCurrentOwner())) throw new Error('Plugin image export was interrupted')
      requireOwner()
    }
    requireCurrent()
    if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ || window.__HIVEN_WEB_NATIVE_BRIDGE__) {
      throw Object.assign(new Error('Plugin image export requires the desktop app'), { name: 'NotSupportedError' })
    }

    // Revocation is terminal for this dialog even if permission is granted again.
    const observeOwner = () => {
      try { requireCurrent() } catch { invalidated = true }
    }
    const stops = [
      pluginRegistry.subscribe(observeOwner),
      usePluginPermissionStore.subscribe(observeOwner),
      usePluginStore.subscribe(observeOwner),
    ]
    const releaseFocus = acquireLauncherNativeDialogFocus()
    let exportId: number | undefined
    let discard: (() => Promise<void>) | undefined
    try {
      const { invoke } = await import('@tauri-apps/api/core')
      requireCurrent()
      const prepared = await invoke<PreparedPngExport>('plugin_blob_prepare_png_export', {
        source, pluginId, blobId, suggestedFilename: options?.suggestedFilename,
      })
      if (prepared.status === 'prepared') {
        exportId = prepared.exportId
        discard = () => invoke<void>('plugin_blob_discard_png_export', { exportId })
      }
      requireCurrent()
      if (prepared.status === 'cancelled') return { status: 'cancelled' }
      if (prepared.status !== 'prepared' || typeof exportId !== 'number' || !Number.isSafeInteger(exportId) || exportId < 0) {
        throw new Error('Invalid native image export response')
      }
      // No await between this last authorization check and dispatch. Native owns
      // the one-shot destination ticket; accepting commit is the write boundary.
      requireCurrent()
      const saved = await invoke<PluginBlobSaveResult>('plugin_blob_commit_png_export', { source, pluginId, exportId })
      // Once dispatched, report the real write result even if its owner closes.
      // The surface host separately suppresses messages from an obsolete view.
      if (saved.status !== 'saved') throw new Error('Native image export did not confirm a write')
      return saved
    } finally {
      // Commit consumes its ticket. Discard is idempotent and also covers errors,
      // late prepare replies and owners removed while the dialog was visible.
      try { await discard?.() } catch (error) {
        console.warn('[hiven] Could not release image export ticket:', error)
      }
      for (const stop of stops) stop()
      releaseFocus()
    }
  }
}
