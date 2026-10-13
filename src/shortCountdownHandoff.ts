/** App composition: only the bundled time assistant's explicit countdown entries. */
import { invoke } from '@tauri-apps/api/core'
import type { LauncherItem, PluginLauncherApi } from './workspace/launcher/types'
import { isCurrentBundledDefinition } from './workspace/bundledPluginIdentity'
import { pluginRegistry } from './workspace/pluginRegistry'
import { useAppStore } from './store'
import { nativeToastRoutingAvailable } from './workspace/toastRouting'

export function withShortCountdown(api: PluginLauncherApi, item?: LauncherItem): PluginLauncherApi {
  if (!nativeToastRoutingAvailable() || item?.source !== 'builtin' || item.pluginId !== 'date-time-assistant' || !['plugin:date-time-assistant:launcher:countdown-status', 'plugin:date-time-assistant:dynamic:countdown-start'].includes(item.systemKey ?? '')) return api
  const definition = pluginRegistry.getPluginDefinition('date-time-assistant', 'production')
  if (!isCurrentBundledDefinition('date-time-assistant', 'builtin', definition)) return api
  const session = useAppStore.getState().globalLauncherSessionId
  const check = () => {
    if (!useAppStore.getState().globalLauncherOpen || useAppStore.getState().globalLauncherSessionId !== session || item.pluginLifetime?.active === false || !isCurrentBundledDefinition('date-time-assistant', 'builtin', definition)) throw new Error('countdown-unavailable')
  }
  return { ...api, shortCountdown: async (request) => {
    check()
    if (request.action === 'start') {
      if (item.systemKey !== 'plugin:date-time-assistant:dynamic:countdown-start') throw new Error('countdown-unavailable')
      const id = crypto.randomUUID()
      const snapshot = await invoke<Awaited<ReturnType<NonNullable<PluginLauncherApi['shortCountdown']>>>>('short_countdown_start', { id, seconds: request.seconds })
      check()
      return { ...snapshot, started: snapshot.record?.id === id }
    }
    const snapshot = await invoke<Awaited<ReturnType<NonNullable<PluginLauncherApi['shortCountdown']>>>>(request.action === 'status' ? 'short_countdown_status' : 'short_countdown_cancel', request.action === 'cancel' ? { id: request.id } : {})
    check()
    return snapshot
  } }
}
