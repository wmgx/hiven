/**
 * Host-owned recents for plugin-declared persistable launcher content.
 *
 * Plugins opt in via DesktopTarget.persistable + stable identity.
 * Host stores a small snapshot so the next session can recommend without
 * re-running remote search (contacts / chats / docs).
 */

import { pickLocale, type Locale } from '../../i18n'
import { openExternalUrl } from '../effectRunner'
import type { LauncherItem } from './types'

export type PersistableContentKind = 'document' | 'chat' | 'person'

export type PersistableLauncherPayload = {
  /** Stable cross-session identity (usage + recents key). */
  persistKey: string
  /** List identity; should match the live target systemKey when rehydrated. */
  systemKey: string
  kind: PersistableContentKind
  title: string
  subtitle?: string
  icon?: string
  /** Open URL (https / lark / feishu scheme). */
  url: string
  appName?: string
  appStableKey?: string
  scoreBias?: number
  keywords?: string[]
  sourceId?: string
}

export type PersistableRecentEntry = PersistableLauncherPayload & {
  count: number
  lastSelectedAt: number
}

export const PERSISTABLE_RECENTS_MAX = 48
/** Empty Global Launcher query: keep recents short so static tools stay scannable. */
export const PERSISTABLE_RECENTS_EMPTY_QUERY_MAX = 8
/** Non-empty query: allow a few more filtered matches. */
export const PERSISTABLE_RECENTS_QUERY_MAX = 12
/** Empty-query boost — max host providerPriorityBoost is 50. */
export const PERSISTABLE_RECENTS_EMPTY_BOOST = 40
/** Weak match boost when user is typing. */
export const PERSISTABLE_RECENTS_QUERY_BOOST = 20

/** Host bridge: plugin settings may dispatch this to clear recents without importing store. */
export const CLEAR_PERSISTABLE_RECENTS_EVENT = 'hiven:launcher-clear-persistable-recents'

const KIND_LABELS: Record<PersistableContentKind, { en: string; zh: string }> = {
  document: { en: 'Recently visited', zh: '最近访问' },
  chat: { en: 'Recent chat', zh: '最近会话' },
  person: { en: 'Recent person', zh: '最近联系人' },
}

export function emptyPersistableRecents(): PersistableRecentEntry[] {
  return []
}

/**
 * Upsert a selection into the recents ring (most-recent first, capped).
 */
export function recordPersistableRecent(
  recents: PersistableRecentEntry[],
  payload: PersistableLauncherPayload,
  now = Date.now(),
): PersistableRecentEntry[] {
  const key = payload.persistKey.trim()
  const url = payload.url.trim()
  if (!key || !url || !payload.systemKey.trim() || !payload.title.trim()) {
    return recents
  }

  const prev = recents.find((row) => row.persistKey === key)
  const nextEntry: PersistableRecentEntry = {
    ...payload,
    persistKey: key,
    url,
    count: (prev?.count ?? 0) + 1,
    lastSelectedAt: now,
  }

  const rest = recents.filter((row) => row.persistKey !== key)
  return [nextEntry, ...rest].slice(0, PERSISTABLE_RECENTS_MAX)
}

export function filterPersistableRecents(
  recents: PersistableRecentEntry[],
  query: string,
): PersistableRecentEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return recents
  return recents.filter((row) => {
    const hay = [row.title, row.subtitle, ...(row.keywords ?? []), row.persistKey]
      .filter(Boolean)
      .join(' ')
      .toLowerCase()
    return hay.includes(q)
  })
}

/**
 * Turn persisted snapshots into host launcher items (open URL on activate).
 */
export function buildPersistableRecentLauncherItems(options: {
  recents: PersistableRecentEntry[]
  query: string
  locale: Locale
  max?: number
  openUrl?: (url: string) => Promise<void>
}): LauncherItem[] {
  const openUrl = options.openUrl ?? openExternalUrl
  const q = options.query.trim()
  const emptyQuery = !q
  const max =
    options.max ??
    (emptyQuery ? PERSISTABLE_RECENTS_EMPTY_QUERY_MAX : PERSISTABLE_RECENTS_QUERY_MAX)
  // Prefer frequent + recent when empty; filter already keeps order for typed query.
  const matched = (
    emptyQuery
      ? [...filterPersistableRecents(options.recents, options.query)].sort((a, b) => {
          if (b.count !== a.count) return b.count - a.count
          return b.lastSelectedAt - a.lastSelectedAt
        })
      : filterPersistableRecents(options.recents, options.query)
  ).slice(0, max)
  const locale = options.locale
  const boost = emptyQuery ? PERSISTABLE_RECENTS_EMPTY_BOOST : PERSISTABLE_RECENTS_QUERY_BOOST

  return matched.map((row, index) => {
    const labels = KIND_LABELS[row.kind]
    // Slight within-list decay so order stays stable under equal usage scores.
    const orderNudge = Math.max(0, 8 - index)
    return {
      systemKey: row.systemKey,
      kind: 'host' as const,
      display: {
        title: row.title,
        subtitle: row.subtitle,
        icon: row.icon,
        aliases: [row.title, ...(row.keywords ?? []), row.persistKey].filter(Boolean),
        kindLabel: pickLocale(locale, labels.zh, labels.en),
        kindLabelI18n: { en: labels.en, zh: labels.zh },
      },
      behavior: { type: 'perform' as const },
      surfaces: ['global-launcher' as const],
      recordUsage: true,
      legacyUsageKeys:
        row.persistKey && row.persistKey !== row.systemKey
          ? [`host:persistable:${row.kind}:${row.persistKey}`]
          : undefined,
      ranking: {
        ...(row.scoreBias != null ? { scoreBias: row.scoreBias } : {}),
        providerPriorityBoost: Math.min(50, boost + orderNudge),
      },
      persistable: true,
      persistPayload: {
        persistKey: row.persistKey,
        systemKey: row.systemKey,
        kind: row.kind,
        title: row.title,
        subtitle: row.subtitle,
        icon: row.icon,
        url: row.url,
        appName: row.appName,
        appStableKey: row.appStableKey,
        scoreBias: row.scoreBias,
        keywords: row.keywords,
        sourceId: row.sourceId,
      },
      execute: async () => {
        try {
          await openUrl(row.url)
          return { ok: true as const }
        } catch (error) {
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      },
    }
  })
}

export function payloadFromLauncherItem(
  item: LauncherItem,
): PersistableLauncherPayload | null {
  if (!item.persistable || !item.persistPayload) return null
  const p = item.persistPayload
  if (!p.persistKey?.trim() || !p.url?.trim() || !p.systemKey?.trim()) return null
  return p
}
