/**
 * Plugin-initiated settings writes use the same validated persistence and
 * onChange path as explicit settings UI edits.
 */

import { pluginRegistry } from './pluginRegistry'
import { createPluginNetwork } from './pluginNetwork'
import { getPluginPermissionSnapshot } from './pluginPermissions'
import { createPluginShell } from './pluginShell'
import { createPluginAi } from './ai/runtime'
import { createPluginLauncherStorage } from './launcher/pluginApi'
import {
  resolvePluginSettings,
  usePluginSettingsStore,
  type PluginSettingsSource,
} from './pluginSettingsStore'

/**
 * Read-modify-write one plugin's own settings.
 *
 * `pluginId` / `source` must come from the host-provided plugin context — this
 * is a capability handed to a plugin about itself, not a general write API.
 * Fails soft: a plugin that cannot persist must not break the app.
 */
export function updateOwnPluginSettings<T>(
  pluginId: string,
  settingsSource: PluginSettingsSource,
  updater: (current: T) => T,
): void {
  try {
    // Matched on pluginId alone: a definition's `source` is the narrower
    // production/dev origin, not the builtin/installed/dev settings bucket the
    // caller passes, so comparing the two would never match.
    const entry = pluginRegistry
      .getAllPluginDefinitions()
      .find((candidate) => candidate.pluginId === pluginId)
    const contribution = entry?.definition?.settings
    if (!contribution) return

    const { value } = resolvePluginSettings<T>(settingsSource, pluginId, {
      version: contribution.version,
      defaultValue: contribution.defaultValue as T,
      migrate: contribution.migrate as ((stored: unknown, from: number) => T) | undefined,
    })

    const next = updater(value)
    if (next == null || next === value) return

    const version = contribution.version ?? 1
    usePluginSettingsStore.getState().setPluginSettings(settingsSource, pluginId, next, version)

    if (!contribution.onChange) return
    const permissions = pluginRegistry.getPluginPermissions(pluginId, settingsSource)
    const snapshot = getPluginPermissionSnapshot(settingsSource, pluginId, permissions)
    void Promise.resolve(
      contribution.onChange({
        value: next,
        pluginId,
        source: settingsSource,
        storage: createPluginLauncherStorage({
          pluginId,
          source: settingsSource,
          requestedPermissions: permissions,
        }),
        network: createPluginNetwork(snapshot),
        shell: createPluginShell(snapshot),
        ai: createPluginAi(pluginId, settingsSource, snapshot),
      }),
    ).catch((error) => {
      console.warn(`[hiven] settings onChange failed for "${pluginId}":`, error)
    })
  } catch (error) {
    console.warn(`[hiven] plugin settings update failed for "${pluginId}":`, error)
  }
}
