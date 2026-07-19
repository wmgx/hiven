/**
 * Soft navigation de-duplication helpers.
 *
 * Host must NOT know "Edge" / "browser.chromium" product rules.
 * It only understands generic signals already on LauncherItem:
 *   - requiredCapabilities (desktop-browser-tabs vs desktop-windows)
 *   - display title similarity
 *
 * Soft policy: when two navigation items have near-identical titles, demote
 * the coarser surface (window) relative to a finer one (tab/document). Both
 * can still appear; ranking decides order.
 */

import type { LauncherHostCapability, LauncherItem } from '../launcher/types'

/** Finer page-level nav outranks coarser window/app nav when titles collide. */
const NAV_SURFACE_TIER: Partial<Record<LauncherHostCapability, number>> = {
  'desktop-browser-tabs': 30,
  'desktop-windows': 20,
  'app-search': 10,
}

/** Score penalty applied to the lower-tier item in a near-title pair (soft, not hard drop). */
export const NAV_NEAR_DUP_DEMOTION = 700

export function isBrowserTabLauncherItem(item: LauncherItem): boolean {
  if (item.requiredCapabilities?.includes('desktop-browser-tabs')) return true
  if (item.systemKey.startsWith('browser.chromium:')) return true
  if (
    item.display.kindLabelI18n?.en === 'Browser' ||
    item.display.kindLabel === 'Browser' ||
    item.display.kindLabelI18n?.zh === '浏览器' ||
    item.display.kindLabel === '浏览器' ||
    // legacy label before rename
    item.display.kindLabelI18n?.en === 'Tab' ||
    item.display.kindLabel === 'Tab'
  ) return true
  if (/^browser\.chromium:tab:/.test(item.systemKey)) return true
  return false
}

export function isWindowFocusLauncherItem(item: LauncherItem): boolean {
  if (item.systemKey.startsWith('host.window:focus:')) return true
  if (item.systemKey.startsWith('host.window:') && item.systemKey.includes(':focus:')) return true
  return item.requiredCapabilities?.includes('desktop-windows') === true
    && !item.systemKey.includes(':close:')
}

export function navigationSurfaceTier(item: LauncherItem): number {
  const caps = item.requiredCapabilities ?? []
  let best = 0
  for (const cap of caps) {
    const tier = NAV_SURFACE_TIER[cap]
    if (tier != null && tier > best) best = tier
  }
  // Fallback: systemKey heuristics without product names
  if (best === 0) {
    if (isBrowserTabLauncherItem(item)) return 30
    if (isWindowFocusLauncherItem(item)) return 20
  }
  return best
}

/** Normalize title for near-dup compare: lower, collapse space, strip common chrome. */
export function normalizeNavTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[\u2013\u2014|·•]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * True when titles are "about the same page" — enough to soft-demote, not hard-hide.
 * Uses inclusion / prefix after normalize (browser window titles often wrap tab titles).
 */
export function navTitlesNearDuplicate(a: string, b: string): boolean {
  const na = normalizeNavTitle(a)
  const nb = normalizeNavTitle(b)
  if (!na || !nb) return false
  if (na === nb) return true
  // One contains the other with enough length to avoid short false positives.
  const shorter = na.length <= nb.length ? na : nb
  const longer = na.length <= nb.length ? nb : na
  if (shorter.length < 4) return false
  if (longer.includes(shorter)) return true
  // Shared prefix (e.g. "docs - google docs" vs "docs")
  let i = 0
  while (i < shorter.length && shorter[i] === longer[i]) i += 1
  return i >= Math.min(12, Math.floor(shorter.length * 0.7))
}

/**
 * Soft demotion amount for `item` given the full candidate list.
 * If a higher-tier nav item shares a near-duplicate title, demote this item.
 * Returns 0 when no conflict — never removes items.
 */
export function navNearDuplicateDemotion(item: LauncherItem, peers: LauncherItem[]): number {
  const tier = navigationSurfaceTier(item)
  if (tier <= 0) return 0
  const title = item.display.title ?? ''
  if (!title.trim()) return 0

  for (const peer of peers) {
    if (peer === item || peer.systemKey === item.systemKey) continue
    const peerTier = navigationSurfaceTier(peer)
    if (peerTier <= tier) continue
    const peerTitle = peer.display.title ?? ''
    if (!navTitlesNearDuplicate(title, peerTitle)) continue
    return NAV_NEAR_DUP_DEMOTION
  }
  return 0
}

/**
 * @deprecated Hard filter removed — kept as no-op identity for any stale callers/tests.
 * Prefer {@link navNearDuplicateDemotion} in ranking.
 */
export function filterWindowItemsWhenBrowserTabsPresent(
  windowItems: LauncherItem[],
  _tabOrBridgeItems: LauncherItem[],
): LauncherItem[] {
  return windowItems
}
