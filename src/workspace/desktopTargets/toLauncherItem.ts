/**
 * Map DesktopTarget → LauncherItem.
 * - systemKey === target.id (list identity / dedupe)
 * - usage via legacyUsageKeys with stable app key when recordUsage
 * - surfaces forced to global-launcher only
 */

import type { Locale } from '../../i18n'
import type { LauncherItem } from '../launcher/types'
import { clampProviderPriority } from './constants'
import type { DesktopTarget, DesktopTargetActivateContext, DesktopTargetProvider } from './types'

const KIND_LABELS: Record<string, { en: string; zh: string }> = {
  app: { en: 'App', zh: '应用' },
  window: { en: 'Window', zh: '窗口' },
  tab: { en: 'Tab', zh: '标签' },
  document: { en: 'Document', zh: '文档' },
}

export function kindLabelFor(kind: string, locale: Locale): string {
  const row = KIND_LABELS[kind]
  if (!row) return kind
  return locale === 'zh' ? row.zh : row.en
}

export function stableUsageKeyForTarget(target: DesktopTarget): string | null {
  const action = target.actionClass ?? 'focus'
  if (action === 'close' || action === 'terminate') return null
  if (target.kind === 'app') {
    return target.appStableKey
      ? `host:app-launcher:app:${target.appStableKey}`
      : target.id
  }
  if (target.kind === 'window' && action === 'focus') {
    const key = target.appStableKey || target.appName
    if (!key) return null
    return `host:window:focus:app:${key}`
  }
  if (target.kind === 'tab' && action === 'focus') {
    const key = target.appStableKey || target.appName
    if (!key) return null
    return `host:tab:focus:app:${key}`
  }
  return null
}

export function shouldRecordUsage(target: DesktopTarget): boolean {
  const action = target.actionClass ?? 'focus'
  if (action === 'close' || action === 'terminate') return false
  return target.kind === 'app' || target.kind === 'window' || target.kind === 'tab'
}

export type ToLauncherItemOptions = {
  locale: Locale
  provider?: DesktopTargetProvider
  activate?: (target: DesktopTarget, ctx: DesktopTargetActivateContext) => Promise<void>
}

/**
 * Convert one target to a host launcher item.
 * `systemKey` is always `target.id`.
 */
export function desktopTargetToLauncherItem(
  target: DesktopTarget,
  options: ToLauncherItemOptions,
): LauncherItem {
  const locale = options.locale
  const action = target.actionClass ?? 'focus'
  const usageKey = stableUsageKeyForTarget(target)
  const recordUsage = shouldRecordUsage(target)
  const providerBoost = clampProviderPriority(options.provider?.priority)

  const kindLabel = kindLabelFor(target.kind, locale)
  const kindLabelI18n = KIND_LABELS[target.kind]
    ? { en: KIND_LABELS[target.kind].en, zh: KIND_LABELS[target.kind].zh }
    : undefined

  const activate = options.activate ?? options.provider?.activate

  return {
    systemKey: target.id,
    kind: 'host',
    display: {
      title: target.title,
      titleI18n: target.titleI18n,
      subtitle: target.subtitle,
      subtitleI18n: target.subtitleI18n,
      icon: target.icon,
      aliases: [
        ...(target.keywords ?? []),
        target.appName,
        target.title,
      ].filter((v): v is string => Boolean(v)),
      kindLabel,
      kindLabelI18n,
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities:
      target.kind === 'window'
        ? ['desktop-windows']
        : target.kind === 'tab'
          ? ['desktop-browser-tabs']
          : target.kind === 'app'
            ? ['app-search']
            : undefined,
    recordUsage: recordUsage ? true : false,
    legacyUsageKeys: recordUsage && usageKey && usageKey !== target.id ? [usageKey] : undefined,
    ranking: providerBoost > 0 ? { providerPriorityBoost: providerBoost } : undefined,
    execute: async () => {
      if (activate) {
        try {
          await activate(target, { locale, surfaceId: 'global-launcher' })
          return { ok: true as const }
        } catch (error) {
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
      return { ok: false as const, message: 'No activate handler' }
    },
  }
}

export function desktopTargetsToLauncherItems(
  targets: DesktopTarget[],
  options: ToLauncherItemOptions,
): LauncherItem[] {
  return targets.map((t) => desktopTargetToLauncherItem(t, options))
}
