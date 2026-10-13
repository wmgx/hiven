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
export async function updateOwnPluginSettings<T>(
  pluginId: string,
  settingsSource: PluginSettingsSource,
  updater: (current: T) => T,
): Promise<void> {
  try {
    const definition = pluginRegistry.getPluginDefinition(pluginId, settingsSource)
    const lifetime = pluginRegistry.getPluginLifetime(pluginId, settingsSource)
    const contribution = definition?.settings
    const isCurrent = () => lifetime.active && pluginRegistry.getPluginDefinition(pluginId, settingsSource) === definition
    if (!contribution) return

    const { value, migrationError } = resolvePluginSettings<T>(settingsSource, pluginId, {
      version: contribution.version,
      defaultValue: contribution.defaultValue as T,
      migrate: contribution.migrate as ((stored: unknown, from: number) => T) | undefined,
    })

    if (migrationError) throw new Error(migrationError)
    const expected = usePluginSettingsStore.getState().getPluginSettings(settingsSource, pluginId) ?? null
    const next = updater(structuredClone(value))
    if (next == null || next === value) return

    const version = contribution.version ?? 1
    await usePluginSettingsStore.getState().setPluginSettings(settingsSource, pluginId, next, version, {
      expected, isCurrent,
      validate() {
        if (contribution.confirmChange?.(structuredClone(value), structuredClone(next))) throw new Error('Settings change requires confirmation in Settings')
      },
    })

    if (!isCurrent() || !contribution.onChange) return
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
