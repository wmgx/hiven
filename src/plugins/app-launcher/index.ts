import { definePlugin } from '@hiven/plugin'
import type { LauncherItemContribution, LauncherDynamicContext, LauncherExecutionContext, PluginStartupHookContext } from '@hiven/plugin'
import { pinyin } from 'pinyin-pro'
import { createAppLauncherRepository } from './storage/repository'
import type { CachedAppEntry } from './storage/model'

const REFRESH_ICON = 'RefreshCw'
const REFRESH_ALIASES = [
  'app',
  'apps',
  'application',
  'refresh apps',
  'scan apps',
  '应用',
  '刷新应用',
  '扫描应用',
]
const MAX_DYNAMIC_APP_ITEMS = 20
const APP_INDEX_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000
const APP_ICON_PREWARM_DELAY_MS = 1200

type AppIndexContext = Pick<LauncherExecutionContext, 'locale' | 'storage' | 'api' | 't'> | Pick<PluginStartupHookContext, 'locale' | 'storage' | 'api' | 't'>

function normalizeAppName(name: string): string {
  return name.trim().toLowerCase()
}

function basenameForSearch(displayPath?: string): string | undefined {
  if (!displayPath) return undefined
  const normalized = displayPath.replace(/\\/g, '/')
  const base = normalized.split('/').filter(Boolean).pop()
  if (!base) return undefined
  return base.replace(/\.(app|lnk|desktop)$/i, '')
}

function sourceLabel(app: CachedAppEntry, ctx: LauncherDynamicContext): string {
  return ctx.t(`app.source.${app.source}`)
}

function duplicateNameSubtitles(apps: CachedAppEntry[], ctx: LauncherDynamicContext): Map<string, string> {
  const counts = new Map<string, number>()
  for (const app of apps) {
    const key = normalizeAppName(app.name)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const subtitles = new Map<string, string>()
  for (const app of apps) {
    const sameName = (counts.get(normalizeAppName(app.name)) ?? 0) >= 2
    subtitles.set(app.appId, sameName ? app.displayPath || sourceLabel(app, ctx) : ctx.t('app.subtitle'))
  }
  return subtitles
}

function searchAliases(app: CachedAppEntry): string[] {
  const base = basenameForSearch(app.displayPath)
  const aliases = [...(app.aliases ?? [])]
  if (base && normalizeAppName(base) !== normalizeAppName(app.name)) {
    aliases.push(base)
  }
  return Array.from(new Set(aliases.filter(Boolean)))
}

function localizedNames(app: CachedAppEntry): string[] {
  return Object.values(app.nameI18n ?? {})
    .filter((value): value is string => Boolean(value))
}

function appMatchesQuery(app: CachedAppEntry, query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return false
  const fields = [app.appId, app.name, app.displayPath, basenameForSearch(app.displayPath), ...localizedNames(app), ...searchAliases(app)]
    .filter((value): value is string => Boolean(value))
  return fields.some((value) => {
    const normalized = value.toLowerCase()
    if (normalized.includes(q)) return true
    if (!/^[a-z]+$/.test(q)) return false
    const full = pinyin(value, { toneType: 'none', separator: '' }).toLowerCase()
    const initials = pinyin(value, { pattern: 'initial', toneType: 'none', separator: '' }).toLowerCase()
    return full.includes(q) || initials.startsWith(q)
  })
}

function appIconRef(appId: string): string {
  return `app-icon:${appId}`
}

function permissionErrorMessage(error: unknown, permission: string): boolean {
  return error instanceof Error && error.message.includes(permission)
}

function shouldRefreshApplicationIndex(refreshedAt: number): boolean {
  return refreshedAt <= 0 || Date.now() - refreshedAt > APP_INDEX_CACHE_MAX_AGE_MS
}

function prewarmAppIcons(ctx: AppIndexContext, apps: CachedAppEntry[]): void {
  const appIds = apps.slice(0, MAX_DYNAMIC_APP_ITEMS).map((app) => app.appId)
  if (appIds.length === 0) return
  setTimeout(() => {
    void ctx.api.apps.cacheAppIcons(appIds).catch((error) => {
      if (import.meta.env.DEV) console.warn('[app-launcher] App icon cache warmup failed:', error)
    })
  }, APP_ICON_PREWARM_DELAY_MS)
}

async function refreshApplicationIndex(ctx: AppIndexContext, options: { notify?: boolean; force?: boolean } = { notify: true }) {
  const repository = createAppLauncherRepository(ctx.storage)
  if (options.force !== true) {
    const cache = await repository.readCache()
    if (cache.apps.length > 0 && !shouldRefreshApplicationIndex(cache.refreshedAt)) {
      prewarmAppIcons(ctx, cache.apps)
      return { ok: true as const, skipped: true as const }
    }
  }

  let apps
  try {
    apps = await ctx.api.apps.discoverApps()
  } catch (error) {
    if (permissionErrorMessage(error, 'app.discover')) {
      return { ok: false as const, code: 'permission-denied' as const, message: ctx.t('refresh.permissionDenied') }
    }
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false as const, message: ctx.t('refresh.failed', { message }) }
  }

  try {
    const cache = await repository.storeDiscoveredApps(apps)
    const message = ctx.t('refresh.success', { count: cache.apps.length })
    if (options.notify !== false) ctx.api.showMessage(message, 'success')
    prewarmAppIcons(ctx, cache.apps)
    return { ok: true as const }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false as const, message: ctx.t('refresh.failed', { message }) }
  }
}

function refreshItem(): LauncherItemContribution {
  return {
    id: 'refresh-app-index',
    display: {
      title: 'refresh.title',
      subtitle: 'refresh.subtitle',
      icon: REFRESH_ICON,
      aliases: REFRESH_ALIASES,
    },
    surfaces: ['global-launcher'],
    pinnable: false,
    execute: (ctx) => refreshApplicationIndex(ctx, { force: true }),
  }
}

async function startup(ctx: PluginStartupHookContext): Promise<void> {
  const result = await refreshApplicationIndex(ctx, { notify: false })
  if (!result.ok && (!('code' in result) || result.code !== 'permission-denied')) {
    console.warn('[app-launcher] Startup application index refresh failed:', result.message)
  }
}

async function dynamicItems(ctx: LauncherDynamicContext): Promise<LauncherItemContribution[]> {
  if (ctx.surfaceId !== 'global-launcher') return []
  const repository = createAppLauncherRepository(ctx.storage)
  const cache = await repository.readCache()
  const apps = cache.apps
    .filter((app) => appMatchesQuery(app, ctx.query))
    .slice(0, MAX_DYNAMIC_APP_ITEMS)
  const subtitles = duplicateNameSubtitles(apps, ctx)

  return apps.map((app) => ({
    id: `app-${app.appId}`,
    display: {
      title: app.name,
      subtitle: subtitles.get(app.appId) ?? ctx.t('app.subtitle'),
      icon: appIconRef(app.appId),
      aliases: searchAliases(app),
    },
    surfaces: ['global-launcher'],
    pinnable: false,
    execute: async (ctx) => {
      try {
        await ctx.api.apps.launchApp(app.appId)
        return { ok: true }
      } catch (error) {
        if (permissionErrorMessage(error, 'app.launch')) {
          return { ok: false, message: ctx.t('launch.permissionDenied') }
        }
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }))
}

export default definePlugin({
  hooks: {
    startup,
  },
  launcher: {
    items: [refreshItem()],
    dynamicItems,
  },
})
