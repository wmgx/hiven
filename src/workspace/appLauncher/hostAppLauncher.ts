import { searchableFieldsMatch, type SearchableFields } from '../searchRanking'
import type { Locale } from '../../i18n'
import type { DiscoveredApp, LauncherItem, LauncherSurfaceId } from '../launcher/types'
import type { AppWorkObject } from '../../workflow/workObject'
import { logLauncherPerfDuration, launcherPerfNow } from '../launcher/perf'
import { normalizeHostAppEntries } from './hostAppIndex'

// v2: drop stale caches that used path-hash appIds (binary Info.plist parse failures)
// and avoid matching internal ids/paths in search.
const HOST_APP_INDEX_CACHE_KEY = 'hiven:host-app-launcher:index:v2'
const APP_INDEX_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
/** Empty query: only surface a few recent apps so they do not flood the mixed list. */
const EMPTY_QUERY_APP_LIMIT = 5
/** Query-present: hard cap after filter to keep dynamic provider cheap. */
const QUERY_APP_LIMIT = 50

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

/** Avoid JSON.parse(localStorage) on every keystroke — search hits memory first. */
let memoryAppIndex: HostAppLauncherCache | null = null

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
  if (memoryAppIndex) return memoryAppIndex
  const raw = storage()?.getItem(HOST_APP_INDEX_CACHE_KEY)
  if (!raw) {
    memoryAppIndex = EMPTY_CACHE
    return EMPTY_CACHE
  }
  try {
    const parsed = JSON.parse(raw) as HostAppLauncherCache
    if (parsed.version !== 1 || !Array.isArray(parsed.apps)) {
      memoryAppIndex = EMPTY_CACHE
      return EMPTY_CACHE
    }
    const cache: HostAppLauncherCache = {
      ...parsed,
      apps: normalizeHostAppEntries(parsed.apps),
    }
    memoryAppIndex = cache
    return cache
  } catch {
    memoryAppIndex = EMPTY_CACHE
    return EMPTY_CACHE
  }
}

function writeCache(apps: HostAppEntry[]): HostAppLauncherCache {
  const cache: HostAppLauncherCache = {
    version: 1,
    refreshedAt: Date.now(),
    apps: normalizeHostAppEntries(apps),
  }
  memoryAppIndex = cache
  emptyQueryTopApps = null
  emptyQueryTopSourceRefreshedAt = -1
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

/** Internal app ids / filesystem paths must never participate in query matching. */
function isInternalAppSearchToken(value: string): boolean {
  const v = value.trim().toLowerCase()
  if (!v) return true
  if (v.startsWith('macos:') || v.startsWith('windows:') || v.startsWith('linux:')) return true
  if (v.startsWith('host:app-launcher:')) return true
  if (v.startsWith('/') || v.includes('\\')) return true
  if (v.endsWith('.app') || v.includes('.app/')) return true
  return false
}

function humanAppAliases(app: HostAppEntry): string[] {
  const values = [
    app.name,
    ...Object.values(app.nameI18n ?? {}),
    ...(app.aliases ?? []),
  ]
  const aliases: string[] = []
  for (const value of values) {
    if (!value || isInternalAppSearchToken(value)) continue
    if (aliases.some((existing) => existing.toLowerCase() === value.toLowerCase())) continue
    aliases.push(value)
  }
  return aliases
}

function appSearchFields(app: HostAppEntry): SearchableFields {
  // Empty id: never match macos:path:<hex> / bundle path system keys.
  // Aliases are human display names only (no path, no appId).
  return {
    id: '',
    title: app.name,
    titleI18n: app.nameI18n,
    aliases: humanAppAliases(app),
  }
}

function appMatchesQuery(app: HostAppEntry, query: string, locale: Locale): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return searchableFieldsMatch(appSearchFields(app), q, locale)
}

/** Empty-query order: newest installedAt first; missing timestamps last; then name. */
function compareAppsForEmptyQuery(a: HostAppEntry, b: HostAppEntry): number {
  const aTime = typeof a.installedAt === 'number' ? a.installedAt : 0
  const bTime = typeof b.installedAt === 'number' ? b.installedAt : 0
  if (aTime !== bTime) return bTime - aTime
  return a.name.localeCompare(b.name)
}

/** Memo empty-query top apps — avoid O(n log n) sort on every launcher open. */
let emptyQueryTopApps: HostAppEntry[] | null = null
let emptyQueryTopSourceRefreshedAt = -1

function getEmptyQueryTopApps(apps: HostAppEntry[], refreshedAt: number): HostAppEntry[] {
  if (emptyQueryTopApps && emptyQueryTopSourceRefreshedAt === refreshedAt) {
    return emptyQueryTopApps
  }
  emptyQueryTopApps = apps.slice().sort(compareAppsForEmptyQuery).slice(0, EMPTY_QUERY_APP_LIMIT)
  emptyQueryTopSourceRefreshedAt = refreshedAt
  return emptyQueryTopApps
}

function limitMatchedApps(apps: HostAppEntry[], query: string, refreshedAt: number): HostAppEntry[] {
  const q = query.trim()
  if (!q) {
    return getEmptyQueryTopApps(apps, refreshedAt)
  }
  // Query path: filter then hard-cap (do not sort entire catalog).
  const matched: HostAppEntry[] = []
  for (const app of apps) {
    // Caller already filtered; keep this as a safety cap only when used directly.
    matched.push(app)
    if (matched.length >= QUERY_APP_LIMIT) break
  }
  return matched
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

/**
 * Resolve an installed-app id from a display / process / window owner name.
 * Used by desktop window rows to load the same app-icon: assets as the app list.
 */
export function resolveInstalledAppIdByName(name: string): string | undefined {
  const needle = name.trim().toLowerCase()
  if (!needle) return undefined
  const apps = readCache().apps
  for (const app of apps) {
    if (app.name.trim().toLowerCase() === needle) return app.appId
    for (const localized of Object.values(app.nameI18n ?? {})) {
      if (localized?.trim().toLowerCase() === needle) return app.appId
    }
    for (const alias of app.aliases ?? []) {
      if (alias.trim().toLowerCase() === needle) return app.appId
    }
  }
  // Soft contains for owner names like "Google Chrome Helper" → "Google Chrome"
  let best: { appId: string; len: number } | undefined
  for (const app of apps) {
    const n = app.name.trim().toLowerCase()
    if (n.length >= 3 && (needle.includes(n) || n.includes(needle))) {
      if (!best || n.length > best.len) best = { appId: app.appId, len: n.length }
    }
  }
  return best?.appId
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
  const q = query.trim()
  // Empty open: only top-N (memoized). Never filter/sort the whole catalog on open.
  const apps = !q
    ? getEmptyQueryTopApps(cache.apps, cache.refreshedAt)
    : limitMatchedApps(
      cache.apps.filter((app) => appMatchesQuery(app, query, locale)),
      query,
      cache.refreshedAt,
    )

  const items = apps.map((app) => ({
    systemKey: `host:app-launcher:app:${app.appId}`,
    kind: 'host',
    display: {
      title: app.name,
      titleI18n: app.nameI18n,
      subtitle: app.displayPath || sourceLabel(app),
      icon: appIconRef(app.appId),
      // Human names only — ranking must not match path/appId via aliases.
      aliases: humanAppAliases(app),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['app-search'],
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
