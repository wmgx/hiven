import { type Locale } from '../../i18n'
import { resolveDisplaySubtitle, resolveDisplayTitle } from '../../workspace/launcher/display'
import type { LauncherItem as DomainLauncherItem } from '../../workspace/launcher/types'
import { usePluginSurfaceShortcutStore, type PluginSurfaceShortcut } from '../../workspace/pluginSurfaceShortcuts'
import { computeTitleMatchRanges, scoreSearchableFields, searchableFieldsMatch, type SearchableFields } from '../../workspace/searchRanking'
import type { LauncherMixedItem } from './LauncherMixedList'

export type GlobalLauncherItem = LauncherMixedItem

export function buildGlobalLauncherItems({
  rankedLauncherItems,
  query,
  locale,
  recentActionNames,
  actionUsageCounts,
}: {
  rankedLauncherItems: DomainLauncherItem[]
  query: string
  locale: Locale
  recentActionNames: string[]
  actionUsageCounts: Record<string, number>
}): GlobalLauncherItem[] {
  void recentActionNames
  void actionUsageCounts

  const q = query.trim()
  const shortcuts = usePluginSurfaceShortcutStore.getState().shortcuts

  const domainItems: GlobalLauncherItem[] = rankedLauncherItems.map((domainItem) => {
    const title = resolveDisplayTitle(domainItem.display, locale)
    const match = q ? computeTitleMatchRanges(title, q, locale) : undefined
    return {
      kind: 'domain' as const,
      id: domainItem.systemKey,
      title,
      subtitle: resolveDisplaySubtitle(domainItem.display, locale) ?? '',
      icon: domainItem.display.icon,
      aliases: domainItem.display.aliases,
      shortcut: resolveItemShortcutLabel(domainItem.systemKey, shortcuts),
      domainItem,
      matchRanges: match?.ranges,
      matchType: match?.type,
    }
  })

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
    id: item.id,
    title: item.title,
    description: item.subtitle,
    aliases: item.aliases,
    usageKey: item.id,
  }
}

// ─── Shortcut Resolution ────────────────────────────────────────────────────

const PLUGIN_SURFACE_PREFIX = 'plugin-surface:'

/**
 * Given a launcher item's systemKey, look up the bound shortcut and return a
 * formatted mac-symbol label (e.g. "⌘⇧V"). Returns undefined if no shortcut
 * is bound or if the shortcut is disabled.
 */
function resolveItemShortcutLabel(
  systemKey: string,
  shortcuts: Record<string, PluginSurfaceShortcut>,
): string | undefined {
  if (!systemKey.startsWith(PLUGIN_SURFACE_PREFIX)) return undefined
  // systemKey: "plugin-surface:${source}:${pluginId}:${surfaceId}"
  // shortcut store key: "${source}:${pluginId}:${surfaceId}"
  const shortcutKey = systemKey.slice(PLUGIN_SURFACE_PREFIX.length)
  const shortcut = shortcuts[shortcutKey]
  if (!shortcut || !shortcut.enabled || !shortcut.accelerator) return undefined
  return formatAcceleratorToMacSymbols(shortcut.accelerator)
}

/**
 * Convert an Electron/Tauri accelerator string (e.g. "Cmd+Shift+V") to compact
 * mac symbol notation (e.g. "⌘⇧V").
 */
function formatAcceleratorToMacSymbols(accelerator: string): string {
  return accelerator
    .replace(/\bCmdOrCtrl\b/g, '⌘')
    .replace(/\bCommandOrControl\b/g, '⌘')
    .replace(/\bCommand\b/g, '⌘')
    .replace(/\bCmd\b/g, '⌘')
    .replace(/\bCtrl\b/g, '⌃')
    .replace(/\bShift\b/g, '⇧')
    .replace(/\bAlt\b/g, '⌥')
    .replace(/\bOption\b/g, '⌥')
    .replace(/\+/g, '')
}
