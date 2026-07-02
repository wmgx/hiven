import { t, type Locale } from '../../i18n'
import { resolveDisplaySubtitle, resolveDisplayTitle } from '../../workspace/launcher/display'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import { scoreSearchableFields, searchableFieldsMatch, type SearchableFields } from '../../workspace/searchRanking'
import type { LauncherMixedItem } from './LauncherMixedList'

export type GlobalLauncherItem = LauncherMixedItem

export function buildGlobalLauncherItems({
  pinnedActions,
  rankedLauncherItems,
  query,
  locale,
  recentActionNames,
  actionUsageCounts,
}: {
  pinnedActions: PinnedAction[]
  rankedLauncherItems: DomainLauncherItem[]
  query: string
  locale: Locale
  recentActionNames: string[]
  actionUsageCounts: Record<string, number>
}): GlobalLauncherItem[] {
  void pinnedActions
  void query
  void recentActionNames
  void actionUsageCounts

  const domainItems: GlobalLauncherItem[] = rankedLauncherItems.map((domainItem) => ({
    kind: 'domain' as const,
    id: domainItem.systemKey,
    title: resolveDisplayTitle(domainItem.display, locale),
    subtitle: resolveDisplaySubtitle(domainItem.display, locale) ?? '',
    icon: domainItem.display.icon,
    aliases: domainItem.display.aliases,
    domainItem,
  }))

  return domainItems
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
