/**
 * browser.chromium DesktopTargetProvider — implemented via host SDK only
 * (no workspace deep imports). Same protocol Feishu / editor adapters will use.
 */

import { getPluginHostSdk, type DesktopTargetProvider } from '@hiven/plugin'
import { searchableFieldsMatch, visitFrecency, visitFrecencyFromSummary } from '@hiven/plugin'
import {
  DEFAULT_BROWSER_TABS_SETTINGS,
  normalizeBrowserTabsSettings,
  type BrowserTabsSettings,
} from './browserTabsModel'
import { findOpenTabForUrl, normalizeUrlForMatch } from './urlTabMatch'

export const CHROMIUM_SOURCE_ID = 'browser.chromium' as const
const QUERY_TAB_LIMIT = 24
const QUERY_HISTORY_LIMIT = 16
/**
 * Copied a link that's already open? Focus beats "open a new tab". Strong
 * positive bias (clamped ≤500 by the host) so the existing tab is the primary
 * recommendation over web-open's generic direct-open.
 */
const OPEN_TAB_FOCUS_BIAS = 200
/** How many tabs the empty-open recommendation shows before it becomes a wall. */
const EMPTY_OPEN_TAB_LIMIT = 6
/**
 * Bias for empty-open tabs that have real visit history behind them. Kept well
 * under OPEN_TAB_FOCUS_BIAS so an explicit "I copied this link" intent still
 * outranks a passive recommendation.
 */
const EMPTY_OPEN_BASE_BIAS = 60
/** Tabs we know nothing about: still shown (they're open), but after the rest. */
const EMPTY_OPEN_UNRANKED_BIAS = 10
/**
 * History entries are a weaker signal than anything currently open — demote
 * them clearly below the open-tab biases above (which sit at 0..200) so a
 * closed page never crowds out a tab you can actually switch to.
 */
const HISTORY_SCORE_BIAS = -160

function nativeIdFromTargetId(sourceId: string, kind: string, id: string): string {
  const prefix = `${sourceId}:${kind}:`
  if (id.startsWith(prefix)) return id.slice(prefix.length)
  return id
}

function isRenderableIconUrl(url: string | null | undefined): url is string {
  if (!url) return false
  return url.startsWith('https://') || url.startsWith('http://') || url.startsWith('data:image/')
}

function compactHistoryUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl)
    const suffix = `${url.pathname}${url.search}${url.hash}`
    const full = `${url.host}${suffix}`
    if (full.length <= 72) return full
    const tailBudget = Math.max(24, 69 - url.host.length)
    return `${url.host}/…${suffix.slice(-tailBudget)}`
  } catch {
    return rawUrl
  }
}

/**
 * Empty-open recommendations: the open tabs you're most likely to want back.
 *
 * Ranked by visit frecency rather than tab order, so the list reflects two
 * different reasons a page matters:
 *   - a site you return to for months (habit)
 *   - the doc/MR you're hammering this week and will drop after it ships (burst)
 * See visitFrecency in the host SDK for why one decay rate can't express both.
 *
 * Frequency data comes from browser history joined onto the open tabs by URL —
 * a tab carries no visit stats of its own. Tabs with no history match still
 * appear (they're open, that counts for something) but rank below known ones.
 */
async function buildEmptyOpenTargets() {
  const { desktopTargets } = getPluginHostSdk()
  const [tabs, history] = await Promise.all([
    desktopTargets.bridge.listTargets(CHROMIUM_SOURCE_ID),
    desktopTargets.bridge.listHistory(CHROMIUM_SOURCE_ID),
  ])
  if (tabs.length === 0) return []

  const statsByUrl = new Map<
    string,
    { visitCount: number; lastVisitTime: number | null; visits: number[] }
  >()
  for (const item of history) {
    const key = normalizeUrlForMatch(item.url)
    if (!key) continue
    const prev = statsByUrl.get(key)
    const visitCount = (prev?.visitCount ?? 0) + (item.visitCount ?? 0)
    const lastVisitTime = Math.max(prev?.lastVisitTime ?? 0, item.lastVisitTime ?? 0) || null
    const visits = [...(prev?.visits ?? []), ...(item.visits ?? [])]
    statsByUrl.set(key, { visitCount, lastVisitTime, visits })
  }

  const now = Date.now()
  const scored = tabs.map((dto) => {
    const key = dto.url ? normalizeUrlForMatch(dto.url) : null
    const stats = key ? statsByUrl.get(key) : undefined
    // Real timestamps when the extension provides them — only they carry the
    // visit SPAN that separates a long-running habit from a finished sprint.
    // Older extensions send counts only, so fall back to the approximation.
    const score = !stats
      ? 0
      : stats.visits.length > 0
        ? visitFrecency(stats.visits, now)
        : visitFrecencyFromSummary(stats.visitCount, stats.lastVisitTime, now)
    return { dto, score }
  })
  scored.sort((a, b) => b.score - a.score)

  return scored.slice(0, EMPTY_OPEN_TAB_LIMIT).map(({ dto, score }, index) => {
    const favicon = isRenderableIconUrl(dto.faviconUrl) ? dto.faviconUrl : undefined
    const kind = dto.kind === 'document' ? 'document' : 'tab'
    const key = dto.url ? normalizeUrlForMatch(dto.url) : null
    const visits = key ? statsByUrl.get(key)?.visits : undefined
    return {
      // Raw signal for the host: it decides both ordering and whether this looks
      // like a habit worth keeping. No policy on this side.
      visits: visits && visits.length > 0 ? visits : undefined,
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
      icon: favicon ?? 'Globe',
      actionClass: 'focus' as const,
      // Rank within our own slice; the host clamps this to ±500. Descending by
      // position keeps our frecency order intact after host-side merging, while
      // staying below the copied-link focus bias so an explicit intent wins.
      scoreBias: score > 0 ? EMPTY_OPEN_BASE_BIAS - index : EMPTY_OPEN_UNRANKED_BIAS - index,
      kindLabelI18n: { en: 'Browser tab', zh: '浏览器标签页' },
    }
  })
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
        if (!src?.fresh && (src?.historyCount ?? 0) === 0) {
          return { ok: false, reason: 'extension not connected' }
        }
        return { ok: true }
      } catch {
        return { ok: false, reason: 'bridge unavailable' }
      }
    },
    async list(ctx) {
      if (ctx.surfaceId !== 'global-launcher') return []
      const q = ctx.query.trim()
      // Empty open: surface the pages worth returning to, ranked by how you
      // actually use them (see buildEmptyOpenTargets).
      if (!q) return buildEmptyOpenTargets()

      const { desktopTargets } = getPluginHostSdk()
      const raw = await desktopTargets.bridge.listTargets(CHROMIUM_SOURCE_ID)
      // When the query is a link already open in the browser, focus that tab
      // (primary) instead of opening a duplicate. Precise page identity, not a
      // fuzzy substring; the identity hit is kept + surfaced first regardless of
      // the text filter so a full-URL query can't drop or truncate it away.
      const openHit = normalizeUrlForMatch(q) ? findOpenTabForUrl(q, raw) : null
      const matched = raw.filter(
        (t) =>
          t.id === openHit?.id ||
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
      const ordered = openHit
        ? [...matched.filter((t) => t.id === openHit.id), ...matched.filter((t) => t.id !== openHit.id)]
        : matched
      const tabs = ordered
        .slice(0, QUERY_TAB_LIMIT)
        .map((dto) => {
          const kind = dto.kind === 'document' ? 'document' : 'tab'
          const favicon = isRenderableIconUrl(dto.faviconUrl) ? dto.faviconUrl : undefined
          const isOpenHit = dto.id === openHit?.id
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
            icon: favicon ?? 'Globe',
            actionClass: 'focus' as const,
            // Every open tab gets the same pill, not just the identity hit —
            // otherwise only the exact-URL match reads as "already open" and the
            // rest look indistinguishable from history entries below.
            kindLabelI18n: { en: 'Browser tab', zh: '浏览器标签页' },
            ...(isOpenHit ? { scoreBias: OPEN_TAB_FOCUS_BIAS } : {}),
          }
        })

      const history = await desktopTargets.bridge.listHistory(CHROMIUM_SOURCE_ID)
      const historyTargets = history
        .filter((item) =>
          searchableFieldsMatch(
            {
              id: item.id,
              title: item.title,
              aliases: [item.url, item.appName].filter(Boolean) as string[],
            },
            q.toLowerCase(),
            ctx.locale,
          ),
        )
        .slice(0, QUERY_HISTORY_LIMIT)
        .map((item) => {
          const favicon = isRenderableIconUrl(item.faviconUrl) ? item.faviconUrl : undefined
          return {
            id: `${item.sourceId}:document:${item.id}`,
            sourceId: item.sourceId,
            kind: 'document' as const,
            title: item.title,
            subtitle: compactHistoryUrl(item.url),
            appName: item.appName ?? undefined,
            appStableKey: item.appName ?? item.sourceId,
            keywords: [item.title, item.url, item.appName ?? ''].filter(Boolean),
            meta: {
              url: item.url,
              faviconKey: favicon,
            },
            icon: favicon ?? 'Globe',
            actionClass: 'open' as const,
            persistable: true,
            persistKey: item.url,
            scoreBias: HISTORY_SCORE_BIAS,
            kindLabelI18n: { en: 'Browser history', zh: '浏览器历史' },
          }
        })

      return [...tabs, ...historyTargets]
    },
    async activate(target) {
      const { desktopTargets } = getPluginHostSdk()
      if (target.actionClass === 'open' && target.meta?.url) {
        await desktopTargets.bridge.openUrl(CHROMIUM_SOURCE_ID, target.meta.url)
        desktopTargets.bridge.invalidateCache()
        return
      }
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

export function pushChromiumBridgeConfig(settings: Partial<BrowserTabsSettings> | null | undefined): void {
  const next = normalizeBrowserTabsSettings(settings ?? DEFAULT_BROWSER_TABS_SETTINGS)
  void getPluginHostSdk().desktopTargets.bridge.setSourceConfig(CHROMIUM_SOURCE_ID, {
    historyEnabled: next.historyEnabled,
    autoCloseIdleTabs: next.autoCloseIdleTabs,
    idleTimeoutMinutes: next.idleTimeoutMinutes,
  }).catch(() => {
    // bridge may not be up yet
  })
}
