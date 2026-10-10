/**
 * host.window DesktopTargetProvider — wraps desktopControl/windows listing.
 */

import {
  getHostWindowLauncherDynamicItems,
  focusDesktopWindow,
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
      signal: ctx.signal,
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
          // Linux identities belong to one live search, never to recents/usage.
          persistable: item.recordUsage === false ? false : undefined,
        }))
    }
    return []
  },
  async activate(target, ctx): Promise<void> {
    const prefix = 'host.window:focus:native:'
    // Mac's existing direct launcher path is unchanged; this adapter only adds X11.
    if (!target.id.startsWith(`${prefix}x11:`)) throw new Error('No activate handler')
    await focusDesktopWindow(target.id.slice(prefix.length), ctx.locale)
  },
}
