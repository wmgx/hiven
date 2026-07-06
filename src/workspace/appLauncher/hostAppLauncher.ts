import { searchableFieldsMatch, type SearchableFields } from '../searchRanking'
import type { Locale } from '../../i18n'
import type { DiscoveredApp, LauncherItem, LauncherSurfaceId } from '../launcher/types'
import type { AppWorkObject } from '../../workflow/workObject'
import { logLauncherPerfDuration, launcherPerfNow } from '../launcher/perf'
import { normalizeHostAppEntries } from './hostAppIndex'

const HOST_APP_INDEX_CACHE_KEY = 'hiven:host-app-launcher:index:v1'
const APP_INDEX_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000

type HostAppEntry = DiscoveredApp

type HostAppLauncherCache = {
  version: 1
  refreshedAt: number
  apps: HostAppEntry[]
}

const EMPTY_CACHE: HostAppLauncherCache = {
  version: 1,
  refreshedAt: 0,
  apps: [],
}

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function readCache(): HostAppLauncherCache {
  const raw = storage()?.getItem(HOST_APP_INDEX_CACHE_KEY)
  if (!raw) return EMPTY_CACHE
  try {
    const parsed = JSON.parse(raw) as HostAppLauncherCache
    if (parsed.version !== 1 || !Array.isArray(parsed.apps)) return EMPTY_CACHE
    return {
      ...parsed,
      apps: normalizeHostAppEntries(parsed.apps),
    }
  } catch {
    return EMPTY_CACHE
  }
}

function writeCache(apps: HostAppEntry[]): HostAppLauncherCache {
  const cache: HostAppLauncherCache = {
    version: 1,
    refreshedAt: Date.now(),
    apps: normalizeHostAppEntries(apps),
  }
  storage()?.setItem(HOST_APP_INDEX_CACHE_KEY, JSON.stringify(cache))
  return cache
}

function shouldRefreshApplicationIndex(refreshedAt: number): boolean {
  return refreshedAt <= 0 || Date.now() - refreshedAt > APP_INDEX_CACHE_MAX_AGE_MS
}

async function discoverInstalledApps(): Promise<DiscoveredApp[]> {
  if (!isTauriRuntime()) throw new Error('Application discovery is only available in the desktop runtime.')
  const { invoke } = await import('@tauri-apps/api/core')
  return await invoke('discover_installed_apps') as DiscoveredApp[]
}

async function launchInstalledApp(appId: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Application launch is only available in the desktop runtime.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('launch_installed_app', { appId })
}

export async function launchHostAppObject(appId: string): Promise<void> {
  await launchInstalledApp(appId)
}

function sourceLabel(app: HostAppEntry): string {
  switch (app.source) {
    case 'applications':
      return 'Application'
    case 'start-menu':
      return 'Start menu'
    case 'app-paths':
      return 'App paths'
    case 'desktop-entry':
      return 'Desktop entry'
  }
}

function appSearchFields(app: HostAppEntry): SearchableFields {
  // Use a synthetic internal ID that won't accidentally match user queries.
  // App matching should only rely on title (with i18n support).
  return {
    id: `host:app-launcher:app:${app.appId}`,
    title: app.name,
    titleI18n: app.nameI18n,
  }
}

function appMatchesQuery(app: HostAppEntry, query: string, locale: Locale): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return searchableFieldsMatch(appSearchFields(app), q, locale)
}

function appIconRef(appId: string): string {
  return `app-icon:${appId}`
}

async function refreshApplicationIndex(options: { force?: boolean } = {}): Promise<{ ok: true; count: number } | { ok: false; message: string }> {
  if (options.force !== true) {
    const cache = readCache()
    if (cache.apps.length > 0 && !shouldRefreshApplicationIndex(cache.refreshedAt)) {
      return { ok: true, count: cache.apps.length }
    }
  }

  try {
    const apps = await discoverInstalledApps()
    const cache = writeCache(apps)
    return { ok: true, count: cache.apps.length }
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : String(error) }
  }
}

export function refreshHostApplicationIndexOnStartup(): void {
  if (!isTauriRuntime()) return
  void refreshApplicationIndex({ force: true }).then((result) => {
    if (!result.ok) console.warn('[app-launcher] Startup application index refresh failed:', result.message)
  })
}

export function getHostAppLauncherStaticItems(): LauncherItem[] {
  return [
    {
      systemKey: 'host:app-launcher:refresh',
      kind: 'host',
      display: {
        title: 'Refresh Applications Index',
        titleI18n: { zh: '刷新应用索引' },
        subtitle: 'Scan installed applications',
        subtitleI18n: { zh: '扫描已安装应用' },
        icon: 'RefreshCw',
        aliases: ['app', 'apps', 'application', 'refresh apps', 'scan apps', '应用', '刷新应用', '扫描应用'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['app-search'],
      pinnable: false,
      execute: async () => {
        const result = await refreshApplicationIndex({ force: true })
        if (!result.ok) return { ok: false, message: result.message }
        return { ok: true }
      },
    },
  ]
}

export async function getHostAppLauncherDynamicItems({
  query,
  surfaceId,
  locale,
}: {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
}): Promise<LauncherItem[]> {
  if (surfaceId !== 'global-launcher') return []
  const startedAt = launcherPerfNow()
  const cache = readCache()
  const apps = cache.apps
    .filter((app) => appMatchesQuery(app, query, locale))

  const items = apps.map((app) => ({
    systemKey: `host:app-launcher:app:${app.appId}`,
    kind: 'host',
    display: {
      title: app.name,
      titleI18n: app.nameI18n,
      subtitle: app.displayPath || sourceLabel(app),
      icon: appIconRef(app.appId),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['app-search'],
    pinnable: false,
    ranking: {
      installedAt: app.installedAt,
    },
    execute: async () => {
      try {
        await launchInstalledApp(app.appId)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }))
  logLauncherPerfDuration('app-launcher:dynamic-items', startedAt, {
    queryLength: query.trim().length,
    cacheCount: cache.apps.length,
    matchedCount: apps.length,
    itemCount: items.length,
  })
  return items
}

export function getHostAppWorkObjects(query: string, locale: Locale): AppWorkObject[] {
  return readCache().apps
    .filter((app) => appMatchesQuery(app, query, locale))
    .map((app) => ({
      id: `app:${app.appId}`,
      type: 'app',
      title: app.name,
      subtitle: app.displayPath || sourceLabel(app),
      icon: appIconRef(app.appId),
      source: 'host.app-index',
      bundleId: app.appId,
      executablePath: app.displayPath,
      createdAt: app.installedAt,
    }))
}
