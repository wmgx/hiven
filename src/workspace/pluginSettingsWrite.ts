/**
 * Plugin-initiated settings writes.
 *
 * Plugins could previously only READ their settings — everything that wrote them
 * went through the settings dialog. That left a plugin no way to persist
 * something it derived at runtime, which is exactly what claiming a learned rule
 * requires (see learning/ruleSink.ts).
 *
 * This routes such a write down the SAME path the settings UI uses: resolve
 * (with migration) → set (versioned, persisted) → onChange (write-through). The
 * onChange leg matters more than it looks: web-open re-registers its coverage
 * test there, so skipping it would let the learner re-learn a rule it just
 * handed over.
 */

import { pluginRegistry } from './pluginRegistry'
import { createPluginNetwork } from './pluginNetwork'
import { getPluginPermissionSnapshot } from './pluginPermissions'
import { createPluginShell } from './pluginShell'
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
      }),
    ).catch((error) => {
      console.warn(`[hiven] settings onChange failed for "${pluginId}":`, error)
    })
  } catch (error) {
    console.warn(`[hiven] plugin settings update failed for "${pluginId}":`, error)
  }
}
