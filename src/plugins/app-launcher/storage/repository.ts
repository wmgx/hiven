import type { DiscoveredApp, PluginPrivateStorageApi } from '@hiven/plugin'
import {
  APP_LAUNCHER_CACHE_KEY,
  EMPTY_APP_LAUNCHER_CACHE,
  type AppLauncherCache,
  type CachedAppEntry,
} from './model'

export type AppLauncherRepository = {
  readCache(): Promise<AppLauncherCache>
  replaceCache(cache: AppLauncherCache): Promise<void>
  storeDiscoveredApps(apps: DiscoveredApp[]): Promise<AppLauncherCache>
}

export function createAppLauncherRepository(storage: PluginPrivateStorageApi): AppLauncherRepository {
  async function readCache(): Promise<AppLauncherCache> {
    const cache = await storage.kv.get<AppLauncherCache>(APP_LAUNCHER_CACHE_KEY)
    if (!cache || cache.version !== 5 || !Array.isArray(cache.apps)) {
      return EMPTY_APP_LAUNCHER_CACHE
    }
    return cache
  }

  async function replaceCache(cache: AppLauncherCache): Promise<void> {
    await storage.kv.set(APP_LAUNCHER_CACHE_KEY, cache)
  }

  async function storeDiscoveredApps(apps: DiscoveredApp[]): Promise<AppLauncherCache> {
    const entries: CachedAppEntry[] = apps.map((app) => ({
        appId: app.appId,
        name: app.name,
        nameI18n: app.nameI18n,
        aliases: app.aliases,
        platform: app.platform,
        source: app.source,
        displayPath: app.displayPath,
    }))

    const cache: AppLauncherCache = {
      version: 5,
      refreshedAt: Date.now(),
      apps: entries,
    }
    await replaceCache(cache)
    return cache
  }

  return {
    readCache,
    replaceCache,
    storeDiscoveredApps,
  }
}
