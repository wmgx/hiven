import type { PluginDefinition, PluginHooksContribution, PluginPermission, PluginStartupHookContext } from './pluginTypes'
import { pluginRegistry } from './pluginRegistry'
import type { PluginSettingsSource } from './pluginSettingsStore'
import { resolvePluginSettings } from './pluginSettingsStore'
import { createPluginPrivateStorage } from './pluginStorage'
import { createPluginClipboard } from './pluginClipboard'
import { createPluginPaste } from './pluginPaste'
import { createPluginNetwork } from './pluginNetwork'
import { useAppStore } from '../store'
import { getPluginPermissionSnapshot, missingPluginPermissions } from './pluginPermissions'
import { resolvePluginSettingsSource } from './launcher/pluginSource'
import { createPluginLauncherApi } from './launcher/pluginApi'
import { makePluginT } from '../i18n/pluginI18nRegistry'

const completedStartupHooks = new Set<string>()
const runningStartupHooks = new Set<string>()

function hookKey(source: PluginSettingsSource, pluginId: string): string {
  return `${source}:${pluginId}:startup`
}

function getPluginSettings(source: PluginSettingsSource, pluginId: string, definition: PluginDefinition<unknown>): unknown {
  const settingsContribution = definition.settings
  if (!settingsContribution) return {}
  return resolvePluginSettings(source, pluginId, settingsContribution).value
}

function buildStartupHookContext(
  source: PluginSettingsSource,
  pluginId: string,
  settings: unknown,
  requestedPermissions: readonly PluginPermission[],
): PluginStartupHookContext<unknown> {
  const locale = useAppStore.getState().locale
  const permissions = getPluginPermissionSnapshot(source, pluginId, requestedPermissions)
  const storage = createPluginPrivateStorage(source, pluginId, permissions)

  return {
    pluginId,
    source,
    locale,
    settings,
    permissions,
    storage,
    clipboard: createPluginClipboard(pluginId, permissions, storage),
    paste: createPluginPaste(permissions, storage),
    network: createPluginNetwork(permissions),
    api: createPluginLauncherApi({ pluginId, source, requestedPermissions }),
    t: makePluginT(pluginId, locale),
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

async function runStartupHook(
  source: PluginSettingsSource,
  pluginId: string,
  hooks: PluginHooksContribution<unknown>,
  settings: unknown,
  requestedPermissions: readonly PluginPermission[],
): Promise<void> {
  if (!hooks.startup) return
  const key = hookKey(source, pluginId)
  if (completedStartupHooks.has(key)) return
  if (runningStartupHooks.has(key)) return

  const permissions = getPluginPermissionSnapshot(source, pluginId, requestedPermissions)
  const missing = missingPluginPermissions(permissions, requestedPermissions)
  if (missing.length > 0) {
    console.warn(`[hooks] Not running startup hook for plugin "${pluginId}": missing permissions ${missing.join(', ')}`)
    return
  }

  runningStartupHooks.add(key)
  try {
    await hooks.startup(buildStartupHookContext(source, pluginId, settings, requestedPermissions))
    completedStartupHooks.add(key)
  } catch (error) {
    console.error(`[hooks] Startup hook failed for plugin "${pluginId}":`, error)
  } finally {
    runningStartupHooks.delete(key)
  }
}

export function runPluginStartupHooks(): void {
  for (const { definition, pluginId, source, permissions } of pluginRegistry.getAllPluginDefinitions()) {
    if (!definition.hooks?.startup) continue

    const settingsSource = resolvePluginSettingsSource(pluginId, source)
    const settings = getPluginSettings(settingsSource, pluginId, definition)
    void runStartupHook(settingsSource, pluginId, definition.hooks, settings, permissions)
  }
}

export function clearCompletedStartupHooksForTests(): void {
  completedStartupHooks.clear()
  runningStartupHooks.clear()
}
