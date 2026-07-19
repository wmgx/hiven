/**
 * Collect D3 desktop bridge targets (browser tabs) → LauncherItem for host dynamic path.
 * Isolated from process mode and does not re-list host windows/apps.
 */

import type { Locale } from '../../i18n'
import type { LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { collectDesktopTargets, listDesktopTargetProviders } from './registry'
import { desktopTargetToLauncherItem } from './toLauncherItem'
import type { DesktopTargetQueryContext } from './types'

export async function getDesktopBridgeLauncherDynamicItems(ctx: {
  query: string
  locale: Locale
  surfaceId: LauncherSurfaceId
}): Promise<LauncherItem[]> {
  if (ctx.surfaceId !== 'global-launcher') return []
  // Empty open: no tabs (design empty-search = 0 for bridge sources).
  if (!ctx.query.trim()) return []

  const queryCtx: DesktopTargetQueryContext = {
    query: ctx.query,
    locale: ctx.locale,
    surfaceId: ctx.surfaceId,
  }

  try {
    const targets = await collectDesktopTargets(queryCtx, {
      timeoutMs: 120,
      maxPerSource: 40,
      maxGlobal: 60,
    })
    // Keep only browser.chromium tabs from the bridge plugin path.
    const bridgeOnly = targets.filter(
      (t) => t.kind === 'tab' && t.sourceId === 'browser.chromium',
    )
    if (bridgeOnly.length === 0) return []

    const registered = listDesktopTargetProviders()
    return bridgeOnly.map((target) => {
      const provider = registered.find((p) => p.id === target.sourceId)
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
