/**
 * Plugin Background Lifecycle Manager
 *
 * Manages the start/stop lifecycle of plugin background contributions.
 * - Starts background when plugin is enabled and settings.enabled is true
 * - Stops and restarts on settings changes
 * - Stops on plugin disable/unload
 */

import type { PluginBackgroundContribution, PluginBackgroundContext, PluginBackgroundStop, PluginPermission } from './pluginTypes'
import type { PluginDefinition } from './pluginTypes'
import { pluginRegistry } from './pluginRegistry'
import type { PluginSettingsSource } from './pluginSettingsStore'
import { resolvePluginSettings, usePluginSettingsStore } from './pluginSettingsStore'
import { createPluginPrivateStorage } from './pluginStorage'
import { createPluginClipboard } from './pluginClipboard'
import { createPluginPaste } from './pluginPaste'
import { createPluginNetwork } from './pluginNetwork'
import { useAppStore } from '../store'
import { getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from './pluginPermissions'
import { resolvePluginSettingsSource } from './launcher/pluginSource'

type BackgroundInstance = {
  key: string
  source: PluginSettingsSource
  pluginId: string
  stop: PluginBackgroundStop | null
}

const activeBackgrounds = new Map<string, BackgroundInstance>()

function backgroundKey(source: PluginSettingsSource, pluginId: string): string {
  return `${source}:${pluginId}`
}

function buildBackgroundContext(
  source: PluginSettingsSource,
  pluginId: string,
  settings: unknown,
  requestedPermissions: readonly PluginPermission[],
): PluginBackgroundContext<unknown> {
  const locale = useAppStore.getState().locale
  const permissions = getPluginPermissionSnapshot(source, pluginId, requestedPermissions)
  const storage = createPluginPrivateStorage(source, pluginId, permissions)

  return {
    pluginId,
    locale,
    settings,
    permissions,
    storage,
    clipboard: createPluginClipboard(pluginId, permissions, storage),
    paste: createPluginPaste(permissions, storage),
    network: createPluginNetwork(permissions),
    showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error') {
      useAppStore.getState().setLastCommandStatus({
        title: message,
        status: level === 'error' ? 'error' : 'success',
        message,
        updatedAt: Date.now(),
      })
    },
  }
}

async function startBackground(
  source: PluginSettingsSource,
  pluginId: string,
  background: PluginBackgroundContribution<unknown>,
  settings: unknown,
  requestedPermissions: readonly PluginPermission[],
): Promise<void> {
  // Stop existing if any
  await stopBackground(source, pluginId)

  const permissions = getPluginPermissionSnapshot(source, pluginId, requestedPermissions)
  const missing = missingPluginPermissions(permissions, requestedPermissions)
  if (missing.length > 0) {
    console.warn(`[background] Not starting background for plugin "${pluginId}": missing permissions ${missing.join(', ')}`)
    return
  }

  const ctx = buildBackgroundContext(source, pluginId, settings, requestedPermissions)

  try {
    const stopFn = await background.start(ctx)
    const key = backgroundKey(source, pluginId)
    activeBackgrounds.set(key, {
      key,
      source,
      pluginId,
      stop: stopFn ?? null,
    })
  } catch (error) {
    console.error(`[background] Failed to start background for plugin "${pluginId}":`, error)
  }
}

async function stopBackground(source: PluginSettingsSource, pluginId: string): Promise<void> {
  const key = backgroundKey(source, pluginId)
  const instance = activeBackgrounds.get(key)
  if (!instance) return

  try {
    if (instance.stop) {
      await instance.stop()
    }
  } catch (error) {
    console.error(`[background] Failed to stop background for plugin "${pluginId}":`, error)
  }
  activeBackgrounds.delete(key)
}

function getPluginSettings(source: PluginSettingsSource, pluginId: string, definition: PluginDefinition<unknown>): unknown {
  const settingsContribution = definition.settings
  if (!settingsContribution) return {}
  const resolved = resolvePluginSettings(source, pluginId, settingsContribution)
  return resolved.value
}

/**
 * Initialize all plugin backgrounds. Call after bundled plugins are registered.
 */
export function initializePluginBackgrounds(): void {
  for (const { definition, pluginId, source, permissions } of pluginRegistry.getAllPluginDefinitions()) {
    const def = definition as PluginDefinition<unknown>
    if (!def.background) continue

    const settingsSource = resolvePluginSettingsSource(pluginId, source)
    const settings = getPluginSettings(settingsSource, pluginId, def)
    void startBackground(settingsSource, pluginId, def.background, settings, permissions)
  }
}

/**
 * Restart a specific plugin's background (called on settings change).
 */
export async function restartPluginBackground(pluginId: string, source?: PluginSettingsSource): Promise<void> {
  const allDefs = pluginRegistry.getAllPluginDefinitions()
  const entry = allDefs.find((e) => {
    if (e.pluginId !== pluginId) return false
    return source == null || resolvePluginSettingsSource(e.pluginId, e.source) === source
  })
  if (!entry) return

  const def = entry.definition as PluginDefinition<unknown>
  if (!def.background) return

  const settingsSource = resolvePluginSettingsSource(entry.pluginId, entry.source)
  const settings = getPluginSettings(settingsSource, entry.pluginId, def)
  await startBackground(settingsSource, entry.pluginId, def.background, settings, entry.permissions)
}

/**
 * Stop a specific plugin's background (called on plugin disable/unload).
 */
export async function stopPluginBackground(pluginId: string, source: PluginSettingsSource = 'builtin'): Promise<void> {
  await stopBackground(source, pluginId)
}

export async function stopAllPluginBackgrounds(): Promise<void> {
  await Promise.all(
    Array.from(activeBackgrounds.values()).map((instance) =>
      stopBackground(instance.source, instance.pluginId)
    ),
  )
}

/**
 * Subscribe to settings changes and restart backgrounds as needed.
 */
export function setupBackgroundSettingsWatcher(): () => void {
  return usePluginSettingsStore.subscribe((state, prevState) => {
    // Check if any plugin settings changed
    for (const source of ['builtin', 'installed', 'dev'] as const) {
      const current = state.pluginSettings[source]
      const previous = prevState.pluginSettings[source]
      if (current === previous) continue

      for (const pluginId of Object.keys(current)) {
        if (current[pluginId] !== previous[pluginId]) {
          // Settings for this plugin changed — restart background if active
          if (activeBackgrounds.has(backgroundKey(source, pluginId))) {
            void restartPluginBackground(pluginId, source)
          }
        }
      }
    }
  })
}

/**
 * Subscribe to permission changes and stop active backgrounds immediately when
 * their declared permissions are revoked.
 */
export function setupBackgroundPermissionWatcher(): () => void {
  return usePluginPermissionStore.subscribe((state, prevState) => {
    if (state.permissions === prevState.permissions) return

    for (const { definition, pluginId, source, permissions: requestedPermissions } of pluginRegistry.getAllPluginDefinitions()) {
      const def = definition as PluginDefinition<unknown>
      if (!def.background || requestedPermissions.length === 0) continue

      const settingsSource = resolvePluginSettingsSource(pluginId, source)
      const snapshot = getPluginPermissionSnapshot(settingsSource, pluginId, requestedPermissions)
      const missing = missingPluginPermissions(snapshot, requestedPermissions)
      const key = backgroundKey(settingsSource, pluginId)
      const isActive = activeBackgrounds.has(key)

      if (missing.length > 0 && isActive) {
        void stopBackground(settingsSource, pluginId)
      } else if (missing.length === 0 && !isActive) {
        const settings = getPluginSettings(settingsSource, pluginId, def)
        void startBackground(settingsSource, pluginId, def.background, settings, requestedPermissions)
      }
    }
  })
}
