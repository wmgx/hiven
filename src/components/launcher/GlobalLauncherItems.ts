import { localized } from '../../store'
import { t, type Locale } from '../../i18n'
import { resolveDisplaySubtitle, resolveDisplayTitle } from '../../workspace/launcher/display'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import { scoreSearchableFields, searchableFieldsMatch, type SearchableFields } from '../../workspace/searchRanking'
import type { PinnedAction } from '../../store'
import type { LauncherMixedItem } from './LauncherMixedList'

export type GlobalLauncherItem = LauncherMixedItem

export function buildGlobalLauncherItems({
  mode,
  pinnedActions,
  rankedLauncherItems,
  query,
  locale,
  recentActionNames,
  actionUsageCounts,
}: {
  mode: string
  pinnedActions: PinnedAction[]
  rankedLauncherItems: DomainLauncherItem[]
  query: string
  locale: Locale
  recentActionNames: string[]
  actionUsageCounts: Record<string, number>
}): GlobalLauncherItem[] {
  const pinnedItems = buildPinnedItems({ mode, pinnedActions, locale })
  const q = query.trim().toLowerCase()
  const pinnedBase = q ? pinnedItems.filter((item) => launcherItemMatchesQuery(item, q, locale)) : pinnedItems
  const sortedPinned = [...pinnedBase].sort((a, b) =>
    scoreLauncherItem(b, q, locale, recentActionNames, actionUsageCounts) -
    scoreLauncherItem(a, q, locale, recentActionNames, actionUsageCounts)
  )

  const domainItems: GlobalLauncherItem[] = rankedLauncherItems.map((domainItem) => ({
    kind: 'domain' as const,
    id: domainItem.systemKey,
    title: resolveDisplayTitle(domainItem.display, locale),
    subtitle: resolveDisplaySubtitle(domainItem.display, locale) ?? '',
    icon: domainItem.display.icon,
    aliases: domainItem.display.aliases,
    domainItem,
  }))

  return [...domainItems, ...sortedPinned]
}

function buildPinnedItems({
  mode,
  pinnedActions,
  locale,
}: {
  mode: string
  pinnedActions: PinnedAction[]
  locale: Locale
}): GlobalLauncherItem[] {
  const pinnedLabel = t(locale, 'palette.globalPinned')
  const pinned = pinnedActions.map((item) => ({
    kind: 'pinned' as const,
    id: item.id,
    title: localized(item.title, item.titleI18n, locale),
    subtitle: pinnedLabel,
    icon: item.icon,
    actionId: item.actionId,
  }))

  if ('pinned-only' === mode) return pinned
  return pinned
}

function launcherItemMatchesQuery(item: GlobalLauncherItem, q: string, locale: Locale): boolean {
  return searchableFieldsMatch(launcherItemSearchFields(item), q, locale)
}

function scoreLauncherItem(
  item: GlobalLauncherItem,
  q: string,
  locale: Locale,
  recentNames: string[],
  usageCounts: Record<string, number>,
): number {
  return scoreSearchableFields(launcherItemSearchFields(item), q, locale, recentNames, usageCounts)
}

function launcherItemSearchFields(item: GlobalLauncherItem): SearchableFields {
  return {
    id: launcherItemSearchId(item),
    title: item.title,
    description: item.subtitle,
    aliases: item.aliases,
    usageKey: launcherItemUsageKey(item),
  }
}

function launcherItemSearchId(item: GlobalLauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  return item.id
}

function launcherItemUsageKey(item: GlobalLauncherItem): string {
  if (item.kind === 'pinned') return item.actionId
  return item.id
}
