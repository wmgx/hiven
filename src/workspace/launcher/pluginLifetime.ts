import type { LauncherItem, PluginLauncherApi } from './types'

/**
 * Standard launcher host calls belong to the registration that produced them,
 * including API references retained by a dynamic provider or async action.
 * This cannot cancel a dispatched host call or sandbox arbitrary plugin code.
 */
export function bindPluginLauncherApi(
  api: PluginLauncherApi,
  lifetime: LauncherItem['pluginLifetime'],
  unavailableMessage: () => string,
): PluginLauncherApi {
  if (!lifetime) return api
  const guard = <T extends object>(target: T): T => new Proxy(target, {
    get: (object, key) => {
      const value = Reflect.get(object, key)
      if (key === 'apps' && value) return guard(value)
      if (typeof value !== 'function') return value
      return (...args: unknown[]) => {
        if (!lifetime.active) throw new Error(unavailableMessage())
        return Reflect.apply(value, object, args)
      }
    },
  })
  return guard(api)
}
