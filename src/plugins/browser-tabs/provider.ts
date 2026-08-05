/**
 * browser.chromium DesktopTargetProvider — implemented via host SDK only
 * (no workspace deep imports). Same protocol Feishu / editor adapters will use.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { searchableFieldsMatch } from '@hiven/plugin'

export const CHROMIUM_SOURCE_ID = 'browser.chromium' as const
const QUERY_TAB_LIMIT = 40

function nativeIdFromTargetId(sourceId: string, kind: string, id: string): string {
  const prefix = `${sourceId}:${kind}:`
  if (id.startsWith(prefix)) return id.slice(prefix.length)
  return id
}

export function createChromiumTabsProvider(): DesktopTargetProvider {
  return {
    id: CHROMIUM_SOURCE_ID,
    title: 'Browser Tabs',
    titleI18n: { en: 'Browser Tabs', zh: '浏览器标签' },
    priority: 10,
    async health() {
      try {
        const { desktopTargets } = getPluginHostSdk()
        const status = await desktopTargets.bridge.status()
        if (!status?.running) return { ok: false, reason: 'bridge not running' }
        const src = status.sources.find((s) => s.sourceId === CHROMIUM_SOURCE_ID)
        if (!src?.fresh) return { ok: false, reason: 'extension not connected' }
        return { ok: true }
      } catch {
        return { ok: false, reason: 'bridge unavailable' }
      }
    },
    async list(ctx) {
      if (ctx.surfaceId !== 'global-launcher') return []
      const q = ctx.query.trim()
      // Empty search: 0 tabs (product design).
      if (!q) return []

      const { desktopTargets } = getPluginHostSdk()
      const raw = await desktopTargets.bridge.listTargets(CHROMIUM_SOURCE_ID)
      if (raw.length === 0) return []

      const filtered = raw
        .filter((t) =>
          searchableFieldsMatch(
            {
              id: t.id,
              title: t.title,
              aliases: [t.subtitle, t.url, t.appName].filter(Boolean) as string[],
            },
            q.toLowerCase(),
            ctx.locale,
          ),
        )
        .slice(0, QUERY_TAB_LIMIT)

      return filtered.map((dto) => {
        const kind = dto.kind === 'document' ? 'document' : 'tab'
        const favicon =
          typeof dto.faviconUrl === 'string' &&
          (dto.faviconUrl.startsWith('https://') ||
            dto.faviconUrl.startsWith('http://') ||
            dto.faviconUrl.startsWith('data:image/'))
            ? dto.faviconUrl
            : undefined
        return {
          id: `${dto.sourceId}:${kind}:${dto.id}`,
          sourceId: dto.sourceId,
          kind: kind as 'tab' | 'document',
          title: dto.title,
          subtitle: dto.subtitle ?? dto.appName ?? undefined,
          appName: dto.appName ?? undefined,
          appStableKey: dto.appName ?? dto.sourceId,
          keywords: [dto.title, dto.url ?? '', dto.appName ?? ''].filter(Boolean),
          meta: {
            url: dto.url ?? undefined,
            windowId: dto.windowId ?? undefined,
            faviconKey: favicon,
          },
          // https/data favicon; resolveIcon renders remote URLs. Fallback Globe.
          icon: favicon ?? 'Globe',
          actionClass: 'focus' as const,
        }
      })
    },
    async activate(target) {
      const { desktopTargets } = getPluginHostSdk()
      const nativeId = nativeIdFromTargetId(target.sourceId, target.kind, target.id)
      await desktopTargets.bridge.focusTarget(
        CHROMIUM_SOURCE_ID,
        nativeId,
        target.meta?.windowId,
      )
      desktopTargets.bridge.invalidateCache()
    },
  }
}

export function registerChromiumTabsProvider(): void {
  getPluginHostSdk().desktopTargets.registerProvider(createChromiumTabsProvider())
}

export function unregisterChromiumTabsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(CHROMIUM_SOURCE_ID)
}
