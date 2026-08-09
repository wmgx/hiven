/**
 * Map DesktopTarget → LauncherItem.
 * - systemKey === target.id (list identity / dedupe)
 * - usage keys: persistable entities use stable persistKey; else app-level aggregate
 * - surfaces forced to global-launcher only
 */

import type { Locale } from '../../i18n'
import type { PersistableContentKind, PersistableLauncherPayload } from '../launcher/persistableRecents'
import type { LauncherItem } from '../launcher/types'
import { clampProviderPriority } from './constants'
import type { DesktopTarget, DesktopTargetActivateContext, DesktopTargetProvider } from './types'

/** Mirror of ranking SCORE_BIAS_CAP — keep demotion/boost below one match tier. */
const SCORE_BIAS_CAP = 500

function clampTargetScoreBias(bias: number | undefined): number | undefined {
  if (bias == null || !Number.isFinite(bias)) return undefined
  const clamped = Math.max(-SCORE_BIAS_CAP, Math.min(SCORE_BIAS_CAP, bias))
  return clamped === 0 ? undefined : clamped
}

const KIND_LABELS: Record<string, { en: string; zh: string }> = {
  app: { en: 'App', zh: '应用' },
  window: { en: 'Window', zh: '窗口' },
  tab: { en: 'Browser', zh: '浏览器' },
  document: { en: 'Document', zh: '文档' },
  chat: { en: 'Chat', zh: '会话' },
  person: { en: 'Person', zh: '联系人' },
}

/** Protocol default kind pill for a DesktopTargetKind (host vocabulary). */
export function kindLabelFor(kind: string, locale: Locale): string {
  const row = KIND_LABELS[kind]
  if (!row) return kind
  return locale === 'zh' ? row.zh : row.en
}

/**
 * Resolve kind pill: provider override wins, else protocol default.
 */
export function resolveKindLabel(
  target: Pick<DesktopTarget, 'kind' | 'kindLabel' | 'kindLabelI18n'>,
  locale: Locale,
): { kindLabel: string; kindLabelI18n?: Partial<Record<Locale, string>> } {
  const protocol = KIND_LABELS[target.kind]
  const protocolI18n = protocol ? { en: protocol.en, zh: protocol.zh } : undefined

  const overrideI18n = target.kindLabelI18n
  const hasOverrideI18n =
    overrideI18n &&
    (Boolean(overrideI18n.en?.trim()) || Boolean(overrideI18n.zh?.trim()))

  if (hasOverrideI18n || target.kindLabel?.trim()) {
    const mergedI18n = {
      ...(protocolI18n ?? {}),
      ...(overrideI18n ?? {}),
    }
    const kindLabel =
      (locale === 'zh' ? mergedI18n.zh : mergedI18n.en)?.trim() ||
      target.kindLabel?.trim() ||
      kindLabelFor(target.kind, locale)
    return {
      kindLabel,
      kindLabelI18n: Object.keys(mergedI18n).length > 0 ? mergedI18n : undefined,
    }
  }

  return {
    kindLabel: kindLabelFor(target.kind, locale),
    kindLabelI18n: protocolI18n,
  }
}

export function resolvePersistKey(target: DesktopTarget): string | null {
  if (target.persistable !== true) return null
  const key = (target.persistKey ?? target.id).trim()
  return key || null
}

/**
 * Usage aggregation key (may differ from list systemKey).
 * Persistable content uses entity-level keys so each person/chat/doc ranks separately.
 */
export function stableUsageKeyForTarget(target: DesktopTarget): string | null {
  const action = target.actionClass ?? 'focus'
  if (action === 'close' || action === 'terminate') return null

  const persistKey = resolvePersistKey(target)
  if (persistKey) {
    return `host:persistable:${target.kind}:${persistKey}`
  }

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
  if (
    (target.kind === 'document' || target.kind === 'chat' || target.kind === 'person') &&
    (action === 'focus' || action === 'open')
  ) {
    // Non-persistable content: only coarse app-level aggregate (no entity recents).
    const key = target.appStableKey || target.appName
    if (!key) return null
    return `host:${target.kind}:open:app:${key}`
  }
  return null
}

export function shouldRecordUsage(target: DesktopTarget): boolean {
  const action = target.actionClass ?? 'focus'
  if (action === 'close' || action === 'terminate') return false
  if (target.persistable === false) return false
  if (target.persistable === true) return action === 'focus' || action === 'open'
  return (
    target.kind === 'app' ||
    target.kind === 'window' ||
    target.kind === 'tab' ||
    target.kind === 'document' ||
    target.kind === 'chat' ||
    target.kind === 'person'
  )
}

function buildPersistPayload(
  target: DesktopTarget,
  systemKey: string,
): PersistableLauncherPayload | undefined {
  if (target.persistable !== true) return undefined
  const persistKey = resolvePersistKey(target)
  const url = target.meta?.url?.trim()
  if (!persistKey || !url) return undefined
  if (target.kind !== 'document' && target.kind !== 'chat' && target.kind !== 'person') {
    return undefined
  }
  return {
    persistKey,
    systemKey,
    kind: target.kind as PersistableContentKind,
    title: target.title,
    subtitle: target.subtitle,
    icon: target.icon,
    url,
    appName: target.appName,
    appStableKey: target.appStableKey,
    scoreBias: target.scoreBias,
    keywords: target.keywords,
    sourceId: target.sourceId,
  }
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
  const usageKey = stableUsageKeyForTarget(target)
  const recordUsage = shouldRecordUsage(target)
  const providerBoost = clampProviderPriority(options.provider?.priority)
  const scoreBias = clampTargetScoreBias(target.scoreBias)
  const persistPayload = buildPersistPayload(target, target.id)
  const persistable = Boolean(persistPayload)

  const { kindLabel, kindLabelI18n } = resolveKindLabel(target, locale)

  const activate = options.activate ?? options.provider?.activate

  const ranking =
    providerBoost > 0 || scoreBias != null
      ? {
          ...(providerBoost > 0 ? { providerPriorityBoost: providerBoost } : {}),
          ...(scoreBias != null ? { scoreBias } : {}),
        }
      : undefined

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
    ranking,
    persistable: persistable || undefined,
    persistPayload,
    execute: async () => {
      if (activate) {
        try {
          console.info('[desktop-target:execute]', {
            id: target.id,
            sourceId: target.sourceId,
            kind: target.kind,
            title: target.title,
            url: target.meta?.url ?? null,
          })
          await activate(target, { locale, surfaceId: 'global-launcher' })
          console.info('[desktop-target:execute] ok', { id: target.id })
          return { ok: true as const }
        } catch (error) {
          console.warn('[desktop-target:execute] error', {
            id: target.id,
            message: error instanceof Error ? error.message : String(error),
          })
          return {
            ok: false as const,
            message: error instanceof Error ? error.message : String(error),
          }
        }
      }
      console.warn('[desktop-target:execute] no activate handler', { id: target.id })
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
