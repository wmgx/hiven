/**
 * Host-owned recents for plugin-declared persistable launcher content.
 *
 * Plugins opt in via DesktopTarget.persistable + stable identity.
 * Host stores a small snapshot so the next session can recommend without
 * re-running remote search (contacts / chats / docs).
 */

import type { Locale } from '../../i18n'
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

const KIND_LABELS: Record<PersistableContentKind, { en: string; zh: string }> = {
  document: { en: 'Recent doc', zh: '最近文档' },
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
  const max = options.max ?? 12
  const matched = filterPersistableRecents(options.recents, options.query).slice(0, max)
  const locale = options.locale

  return matched.map((row) => {
    const labels = KIND_LABELS[row.kind]
    return {
      systemKey: row.systemKey,
      kind: 'host' as const,
      display: {
        title: row.title,
        subtitle: row.subtitle,
        icon: row.icon,
        aliases: [row.title, ...(row.keywords ?? []), row.persistKey].filter(Boolean),
        kindLabel: locale === 'zh' ? labels.zh : labels.en,
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
        // Mild boost so recents surface when query is empty / weak match.
        providerPriorityBoost: 20,
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
