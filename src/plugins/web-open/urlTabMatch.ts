/**
 * Browser Tabs · already-open URL matcher (plugin-internal, pure — no imports).
 *
 * When the user copies a link that is *already open* in the browser, the
 * recommended action should be "focus that tab", not "open a new one". This
 * module decides, deterministically, whether a copied URL identifies an open
 * tab — tolerant of the differences that don't change page identity (trailing
 * slash, #fragment, http/https), strict on the ones that do (host, path, query).
 *
 * Pure and framework-free so it is headless-testable
 * (scripts/test-url-tab-match.mjs) and boundary-safe (lives inside the plugin,
 * never leaks tab semantics into the host).
 */

/** Minimal shape of an open tab needed to match + focus. */
export interface OpenTabLike {
  id: string
  url?: string | null
  windowId?: string | null
}

/** The tab a copied URL resolves to (enough to call bridge.focusTarget). */
export interface OpenTabMatch {
  id: string
  windowId?: string | null
}

/**
 * Canonical page-identity key for a URL, or null when it isn't an http(s) URL.
 * Folds http/https to one scheme, lowercases host, strips a trailing slash and
 * the #fragment, and by default keeps the query verbatim (it usually changes
 * page identity — a different search or tab param is a different page).
 *
 * Pass `ignoreQuery: true` for the coarser "is this the same page" grouping
 * used to declutter history/recents (see compactHistoryUrl in
 * browserProvider.ts, which never displays the query either) — many sites
 * append per-visit or tracking query params that don't change what the user
 * would consider "the same page", and keeping them distinct there just
 * produces visually-identical duplicate rows.
 */
export function normalizeUrlForMatch(
  url: string | null | undefined,
  options?: { ignoreQuery?: boolean },
): string | null {
  if (typeof url !== 'string') return null
  const trimmed = url.trim()
  if (!/^https?:\/\//i.test(trimmed)) return null
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    return null
  }
  const host = parsed.host.toLowerCase()
  if (!host) return null
  // Root path collapses to empty; other paths drop a single trailing slash.
  let path = parsed.pathname
  if (path === '/') path = ''
  else if (path.endsWith('/')) path = path.slice(0, -1)
  const query = options?.ignoreQuery ? '' : parsed.search
  // scheme folded (web://) so an https tab matches an http copy and vice versa.
  return `web://${host}${path}${query}`
}

/**
 * Find the open tab a copied URL already points at, or null. First match wins;
 * tabs with no / non-http url are skipped.
 */
export function findOpenTabForUrl(
  url: string | null | undefined,
  tabs: readonly OpenTabLike[],
): OpenTabMatch | null {
  const key = normalizeUrlForMatch(url)
  if (!key) return null
  for (const tab of tabs) {
    if (normalizeUrlForMatch(tab.url) === key) {
      return { id: tab.id, windowId: tab.windowId ?? undefined }
    }
  }
  return null
}
