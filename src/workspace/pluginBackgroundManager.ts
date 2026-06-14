/**
 * Plugin Background Lifecycle Manager
 *
 * Manages the start/stop lifecycle of plugin background contributions.
 * - Starts background when plugin is enabled and settings.enabled is true
 * - Stops and restarts on settings changes
 * - Stops on plugin disable/unload
 */

import type { PluginBackgroundContribution, PluginBackgroundContext, PluginBackgroundStop, PluginPermissionSnapshot, PluginPermission } from './pluginTypes'
import type { PluginDefinition } from './pluginTypes'
import { pluginRegistry } from './pluginRegistry'
import { resolvePluginSettings, usePluginSettingsStore } from './pluginSettingsStore'
import { createPluginPrivateStorage } from './pluginStorage'
import { createPluginClipboard } from './pluginClipboard'
import { createPluginPaste } from './pluginPaste'
import { useAppStore } from '../store'
import { makePluginT } from '../i18n/pluginI18nRegistry'

type BackgroundInstance = {
  pluginId: string
  stop: PluginBackgroundStop | null
}

const activeBackgrounds = new Map<string, BackgroundInstance>()

function getAllPermissionsGranted(): PluginPermissionSnapshot {
  // First version: builtin plugins get all permissions granted
  const permissions: PluginPermission[] = [
    'clipboard.read', 'clipboard.write', 'clipboard.watch',
    'clipboard.image', 'clipboard.files',
    'storage.private', 'storage.blob',
    'globalShortcut.register', 'accessibility.paste',
  ]
  const snapshot = {} as PluginPermissionSnapshot
  for (const p of permissions) {
    snapshot[p] = { granted: true, grantedAt: Date.now() }
  }
  return snapshot
}

function buildBackgroundContext(pluginId: string, settings: unknown): PluginBackgroundContext<unknown> {
  const locale = useAppStore.getState().locale
  const t = makePluginT(pluginId, locale)

  return {
    pluginId,
    locale,
    settings,
    permissions: getAllPermissionsGranted(),
    storage: createPluginPrivateStorage(pluginId),
    clipboard: createPluginClipboard(pluginId),
    paste: createPluginPaste(),
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

async function startBackground(pluginId: string, background: PluginBackgroundContribution<unknown>, settings: unknown): Promise<void> {
  // Stop existing if any
  await stopBackground(pluginId)

  const ctx = buildBackgroundContext(pluginId, settings)

  try {
    const stopFn = await background.start(ctx)
    activeBackgrounds.set(pluginId, {
      pluginId,
      stop: stopFn ?? null,
    })
  } catch (error) {
    console.error(`[background] Failed to start background for plugin "${pluginId}":`, error)
  }
}

async function stopBackground(pluginId: string): Promise<void> {
  const instance = activeBackgrounds.get(pluginId)
  if (!instance) return

  try {
    if (instance.stop) {
      await instance.stop()
    }
  } catch (error) {
    console.error(`[background] Failed to stop background for plugin "${pluginId}":`, error)
  }
  activeBackgrounds.delete(pluginId)
}

function getPluginSettings(pluginId: string, definition: PluginDefinition<unknown>): unknown {
  const settingsContribution = definition.settings
  if (!settingsContribution) return {}
  // Builtin plugins use 'builtin' source
  const resolved = resolvePluginSettings('builtin', pluginId, settingsContribution)
  return resolved.value
}

/**
 * Initialize all plugin backgrounds. Call after bundled plugins are registered.
 */
export function initializePluginBackgrounds(): void {
  for (const { definition, pluginId } of pluginRegistry.getAllPluginDefinitions()) {
    const def = definition as PluginDefinition<unknown>
    if (!def.background) continue

    const settings = getPluginSettings(pluginId, def)
    void startBackground(pluginId, def.background, settings)
  }
}

/**
 * Restart a specific plugin's background (called on settings change).
 */
export async function restartPluginBackground(pluginId: string): Promise<void> {
  const allDefs = pluginRegistry.getAllPluginDefinitions()
  const entry = allDefs.find((e) => e.pluginId === pluginId)
  if (!entry) return

  const def = entry.definition as PluginDefinition<unknown>
  if (!def.background) return

  const settings = getPluginSettings(pluginId, def)
  await startBackground(pluginId, def.background, settings)
}

/**
 * Stop a specific plugin's background (called on plugin disable/unload).
 */
export async function stopPluginBackground(pluginId: string): Promise<void> {
  await stopBackground(pluginId)
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
          if (activeBackgrounds.has(pluginId)) {
            void restartPluginBackground(pluginId)
          }
        }
      }
    }
  })
}
