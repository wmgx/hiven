/**
 * browser.chromium DesktopTargetProvider — implemented via host SDK only
 * (no workspace deep imports). Same protocol Feishu / editor adapters will use.
 */

import {
  getPluginHostSdk,
  type DesktopBridgeHistoryDto,
  type DesktopBridgeTargetDto,
  type DesktopTargetProvider,
} from '@hiven/plugin'
import {
  classifyVisitPattern,
  searchableFieldsMatch,
  visitFrecency,
  visitFrecencyFromSummary,
} from '@hiven/plugin'
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
/** Thin history is not enough evidence to turn an open tab into a recommendation. */
const EMPTY_OPEN_MIN_VISITS = 8
/**
 * Maximum frecency-derived bias for empty-open tabs. Kept well under
 * OPEN_TAB_FOCUS_BIAS so explicit intent still outranks passive recommendations.
 */
const EMPTY_OPEN_MAX_BIAS = 60
/**
 * History entries are categorical fallbacks below live tabs. This bias only
 * orders history against other same-band results.
 */
const HISTORY_SCORE_BIAS = -160
/**
 * Per-rank step subtracted from HISTORY_SCORE_BIAS as history entries get
 * older/rarer (see the frecency sort below). Keeps a stale entry from tying
 * with — let alone crowding out — a page visited yesterday, while the whole
 * history list remains strictly ordered at QUERY_HISTORY_LIMIT.
 */
const HISTORY_RANK_STEP_BIAS = 4

let cachedBrowserTargets: DesktopBridgeTargetDto[] = []
let cachedBrowserHistory: DesktopBridgeHistoryDto[] = []
let cachedBrowserHealthy = false
let historySearchDays: BrowserTabsSettings['historySearchDays'] = 5

/** Refresh off the query path; launcher filtering reads these arrays only. */
export async function refreshChromiumBrowserIndex(): Promise<void> {
  const { bridge } = getPluginHostSdk().desktopTargets
  try {
    const [status, targets, history] = await Promise.all([
      bridge.status(),
      bridge.listTargets(CHROMIUM_SOURCE_ID),
      bridge.listHistory(CHROMIUM_SOURCE_ID),
    ])
    cachedBrowserTargets = targets
    cachedBrowserHistory = history
    const source = status?.sources.find((item) => item.sourceId === CHROMIUM_SOURCE_ID)
    cachedBrowserHealthy = Boolean(status?.running && (source?.fresh || (source?.historyCount ?? 0) > 0))
  } catch {
    // Keep the last usable index while the extension is disconnected.
  }
}

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
    const suffix = url.pathname
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
 * a tab carries no visit stats of its own. Thin, stale, and unknown tabs remain
 * searchable but do not become passive recommendations just because they're open.
 */
async function buildEmptyOpenTargets() {
  const tabs = cachedBrowserTargets
  const history = cachedBrowserHistory
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
  const scored = tabs.flatMap((dto) => {
    const key = dto.url ? normalizeUrlForMatch(dto.url) : null
    const stats = key ? statsByUrl.get(key) : undefined
    if (!stats) return []

    const visits = stats.visits.length > 0 ? stats.visits : undefined
    const evidenceCount = visits?.length ?? stats.visitCount
    const patternVisits = visits ?? (stats.lastVisitTime == null ? [] : [stats.lastVisitTime])
    if (
      evidenceCount < EMPTY_OPEN_MIN_VISITS ||
      classifyVisitPattern(patternVisits, now) === 'stale'
    ) return []

    // Real timestamps when the extension provides them — only they carry the
    // visit SPAN that separates a long-running habit from a finished sprint.
    // Older extensions send counts only, so fall back to the approximation.
    const score = visits
      ? visitFrecency(visits, now)
      : visitFrecencyFromSummary(stats.visitCount, stats.lastVisitTime, now)
    return [{ dto, score, visits }]
  })
  scored.sort((a, b) => b.score - a.score)

  return scored.map(({ dto, score, visits }) => {
    const favicon = isRenderableIconUrl(dto.faviconUrl) ? dto.faviconUrl : undefined
    const kind = dto.kind === 'document' ? 'document' : 'tab'
    return {
      // Raw timestamps still let the host decide whether this looks worth keeping.
      visits,
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
      // Use the actual visits/day score as a bounded cross-source nudge: strength,
      // not a fixed tab position, decides whether apps and tabs interleave.
      scoreBias: Math.min(EMPTY_OPEN_MAX_BIAS, score),
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
      return cachedBrowserHealthy
        ? { ok: true }
        : { ok: false, reason: 'extension not connected' }
    },
    async list(ctx) {
      if (ctx.surfaceId !== 'global-launcher') return []
      const q = ctx.query.trim()
      // Empty open: surface the pages worth returning to, ranked by how you
      // actually use them (see buildEmptyOpenTargets).
      if (!q) return buildEmptyOpenTargets()

      const raw = cachedBrowserTargets
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

      const history = historySearchDays === 'all'
        ? cachedBrowserHistory
        : cachedBrowserHistory.filter((item) =>
            item.lastVisitTime == null ||
            item.lastVisitTime >= Date.now() - historySearchDays * 24 * 60 * 60 * 1000,
          )
      // A page already open in a tab shouldn't also show as "history" — the
      // tab above already represents it, ranked higher. Built from `ordered`
      // (every open tab that matched the query, not just the slice actually
      // rendered) so history can't smuggle in a duplicate of a tab the user
      // will see.
      //
      // Query-blind (ignoreQuery: true) on purpose, and for the same-page
      // check within history below: compactHistoryUrl never displays the
      // query, and many sites (this Meego/Lark issue link included) attach a
      // per-visit or tracking query param that changes on every visit. Using
      // the precise identity here would leave rows that render byte-for-byte
      // identical — same title, same visible URL — sitting right next to
      // each other, which is the exact "these look the same" bug this exists
      // to fix. The precise, query-sensitive identity (openHit above) is
      // reserved for "focus this exact open tab", where a different query
      // really does mean a different page state to jump to.
      const openTabUrlKeys = new Set(
        ordered
          .map((dto) => normalizeUrlForMatch(dto.url, { ignoreQuery: true }))
          .filter((key): key is string => key !== null),
      )
      const seenHistoryUrlKeys = new Set<string>()
      const now = Date.now()
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
        .filter((item) => {
          const key = normalizeUrlForMatch(item.url, { ignoreQuery: true })
          if (!key) return true
          if (openTabUrlKeys.has(key)) return false
          if (seenHistoryUrlKeys.has(key)) return false
          seenHistoryUrlKeys.add(key)
          return true
        })
        .map((item) => ({
          item,
          // Recency (and, where the extension reports full visit lists,
          // frequency) decayed score — see visitFrecency for why one decay
          // rate can't express both a returning habit and a finished burst.
          // Older/rarer visits sink toward the bottom of the history tier.
          score:
            item.visits && item.visits.length > 0
              ? visitFrecency(item.visits, now)
              : visitFrecencyFromSummary(item.visitCount ?? 0, item.lastVisitTime, now),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, QUERY_HISTORY_LIMIT)
        .map(({ item }, index) => {
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
            fallback: true,
            scoreBias: HISTORY_SCORE_BIAS - index * HISTORY_RANK_STEP_BIAS,
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
  void refreshChromiumBrowserIndex()
}

export function unregisterChromiumTabsProvider(): void {
  getPluginHostSdk().desktopTargets.unregisterProvider(CHROMIUM_SOURCE_ID)
}

export function pushChromiumBridgeConfig(settings: Partial<BrowserTabsSettings> | null | undefined): void {
  const next = normalizeBrowserTabsSettings(settings ?? DEFAULT_BROWSER_TABS_SETTINGS)
  historySearchDays = next.historySearchDays
  void getPluginHostSdk().desktopTargets.bridge.setSourceConfig(CHROMIUM_SOURCE_ID, {
    historyEnabled: next.historyEnabled,
    autoCloseIdleTabs: next.autoCloseIdleTabs,
    idleTimeoutMinutes: next.idleTimeoutMinutes,
  }).catch(() => {
    // bridge may not be up yet
  })
}
