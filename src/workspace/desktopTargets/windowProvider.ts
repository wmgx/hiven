/**
 * host.window DesktopTargetProvider — wraps desktopControl/windows listing.
 */

import {
  getHostWindowLauncherDynamicItems,
  stripWindowQueryPrefix,
} from '../desktopControl/windows'
import type { DesktopTarget, DesktopTargetProvider, DesktopTargetQueryContext } from './types'

/**
 * Provider that lists focus targets only (close stays on prefix path via getHostWindowLauncherDynamicItems).
 */
export const hostWindowTargetProvider: DesktopTargetProvider = {
  id: 'host.window',
  title: 'Windows',
  titleI18n: { en: 'Windows', zh: '窗口' },
  priority: 0,
  async list(ctx: DesktopTargetQueryContext): Promise<DesktopTarget[]> {
    if (ctx.surfaceId !== 'global-launcher') return []
    const { mode } = stripWindowQueryPrefix(ctx.query)
    // Close mode handled by legacy path that emits L2 items (not primary nav targets).
    if (mode === 'close') return []

    // Single list path — no double fetch.
    const items = await getHostWindowLauncherDynamicItems({
      query: ctx.query,
      surfaceId: ctx.surfaceId,
      locale: ctx.locale,
    })
    if (mode === 'search' || mode === 'focus') {
      return items
        .filter((i) => i.systemKey.includes(':focus:'))
        .map((item) => ({
          id: item.systemKey,
          sourceId: 'host.window' as const,
          kind: 'window' as const,
          title: item.display.title,
          subtitle: item.display.subtitle,
          appName: item.display.subtitle,
          actionClass: 'focus' as const,
          icon: item.display.icon,
          keywords: item.display.aliases,
        }))
    }
    return []
  },
}
