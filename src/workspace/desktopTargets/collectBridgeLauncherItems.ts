/**
 * Collect D3/D4 desktop targets → LauncherItem for host dynamic path.
 * Isolated from process mode and does not re-list host windows/apps.
 */

import type { Locale } from '../../i18n'
import type { LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { collectDesktopTargets, listDesktopTargetProviders } from './registry'
import { desktopTargetToLauncherItem } from './toLauncherItem'
import type { DesktopTargetQueryContext } from './types'
import { vscodeDocumentsProvider } from './vscodeDocuments'

const FALLBACK_BRIDGE_PROVIDERS = [vscodeDocumentsProvider] as const

export async function getDesktopBridgeLauncherDynamicItems(ctx: {
  query: string
  locale: Locale
  surfaceId: LauncherSurfaceId
}): Promise<LauncherItem[]> {
  if (ctx.surfaceId !== 'global-launcher') return []
  // Empty open: no tabs/docs (design empty-search = 0 for new sources).
  if (!ctx.query.trim()) return []

  const queryCtx: DesktopTargetQueryContext = {
    query: ctx.query,
    locale: ctx.locale,
    surfaceId: ctx.surfaceId,
  }

  try {
    const targets = await collectDesktopTargets(queryCtx, {
      // Only wait a short time; failure isolation is inside collect.
      timeoutMs: 120,
      maxPerSource: 40,
      maxGlobal: 60,
    })
    // Window provider may also be registered; keep only tab/document from bridge sources.
    const bridgeOnly = targets.filter(
      (t) =>
        (t.kind === 'tab' || t.kind === 'document') &&
        (t.sourceId === 'browser.chromium' || t.sourceId.startsWith('editor.')),
    )
    if (bridgeOnly.length === 0) return []

    const registered = listDesktopTargetProviders()
    return bridgeOnly.map((target) => {
      const provider =
        registered.find((p) => p.id === target.sourceId) ??
        FALLBACK_BRIDGE_PROVIDERS.find((p) => p.id === target.sourceId)
      return desktopTargetToLauncherItem(target, {
        locale: ctx.locale,
        provider,
        activate: provider?.activate
          ? (t, c) => provider.activate!(t, c)
          : undefined,
      })
    })
  } catch {
    return []
  }
}
