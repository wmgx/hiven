/**
 * host.window DesktopTargetProvider — wraps desktopControl/windows listing.
 */

import type { Locale } from '../../i18n'
import type { LauncherItem, LauncherSurfaceId } from '../launcher/types'
import {
  getHostWindowLauncherDynamicItems,
  listDesktopWindowsCached,
  stripWindowQueryPrefix,
  type DesktopWindow,
} from '../desktopControl/windows'
import { desktopTargetToLauncherItem } from './toLauncherItem'
import type { DesktopTarget, DesktopTargetProvider, DesktopTargetQueryContext } from './types'

function windowDisplayTitle(win: DesktopWindow): string {
  const title = win.title?.trim()
  if (title) return title
  return win.appName || 'Window'
}

function windowToFocusTarget(win: DesktopWindow): DesktopTarget {
  return {
    id: `host.window:focus:native:${win.id}`,
    sourceId: 'host.window',
    kind: 'window',
    title: windowDisplayTitle(win),
    subtitle: win.appName,
    appName: win.appName,
    appStableKey: win.appName || undefined,
    keywords: ['窗口', '切到', 'focus', 'window', win.appName, win.title].filter(Boolean) as string[],
    icon: 'AppWindow',
    actionClass: 'focus',
    secondaryActions: ['close'],
    meta: { windowId: win.id, pid: win.pid },
  }
}

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

    // Reuse existing filtering by converting launcher items is heavy; call list API via getHost…
    // Use existing dynamic items then map ids we control.
    const items = await getHostWindowLauncherDynamicItems({
      query: ctx.query,
      surfaceId: ctx.surfaceId,
      locale: ctx.locale,
    })
    // Prefer native list for clean DesktopTarget mapping when search mode focus-only.
    if (mode === 'search' || mode === 'focus') {
      const focusItems = items.filter((i) => i.systemKey.includes(':focus:'))
      // Reconstruct targets from windows for activate path
      const windows = await listDesktopWindowsCached()
      const byId = new Map(windows.map((w) => [w.id, w]))
      const targets: DesktopTarget[] = []
      for (const item of focusItems) {
        const nativeId = item.systemKey.split(':').pop()
        const win = nativeId ? byId.get(nativeId) : undefined
        if (win) targets.push(windowToFocusTarget(win))
        else {
          targets.push({
            id: item.systemKey,
            sourceId: 'host.window',
            kind: 'window',
            title: item.display.title,
            subtitle: item.display.subtitle,
            actionClass: 'focus',
            icon: item.display.icon,
            keywords: item.display.aliases,
          })
        }
      }
      return targets
    }
    return []
  },
}

/** Convert provider targets for host dynamic list (includes close via legacy helper). */
export async function getWindowLauncherItemsViaProvider(ctx: {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
}): Promise<LauncherItem[]> {
  const { mode } = stripWindowQueryPrefix(ctx.query)
  if (mode === 'close') {
    // Keep L2 close items from existing implementation
    return getHostWindowLauncherDynamicItems(ctx)
  }

  const targets = await hostWindowTargetProvider.list({
    query: ctx.query,
    locale: ctx.locale,
    surfaceId: ctx.surfaceId,
  })

  const windows = await listDesktopWindowsCached()
  const byId = new Map(windows.map((w) => [w.id, w]))

  return targets.map((target) =>
    desktopTargetToLauncherItem(target, {
      locale: ctx.locale,
      provider: hostWindowTargetProvider,
      activate: async (t) => {
        const id = t.meta?.windowId ?? t.id.split(':').pop()
        if (!id) throw new Error('Missing window id')
        const { invoke } = await import('@tauri-apps/api/core')
        await invoke('focus_desktop_window', { id })
        void byId
      },
    }),
  )
}
