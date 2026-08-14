// Type-only import: keeps this module free of runtime imports (naive test loaders
// transpile it standalone). Browser defaults are applied at read time via
// normalizeBrowserTabsSettings, so the default value below can omit `browser`.
import type { BrowserTabsSettings } from '../browserTabsModel'

export type WebQuickOpenEntry = {
  id: string
  title: string
  aliases: string[]
  placeholder: string
  urlTemplate: string
  encodeQuery: boolean
  emptyQueryBehavior: 'block' | 'open'
  matchPattern?: string
  /** When true, successful queries are stored per entry for reuse. Default false. */
  recordQueryHistory?: boolean
  /** Max history items for this entry. Default 20. */
  maxQueryHistory?: number
}

export type WebQuickOpenSettings = {
  enabled: boolean
  entries: WebQuickOpenEntry[]
  /**
   * Optional live-browser capability (Chromium extension bridge): tab / history
   * search, focus-open-tab, idle-close. Nested so its `enabled` never collides
   * with the plugin-level `enabled`. Absent → defaults apply (see browserTabsModel).
   */
  browser?: BrowserTabsSettings
}

export const DEFAULT_MAX_QUERY_HISTORY = 20

export const DEFAULT_WEB_QUICK_OPEN_SETTINGS: WebQuickOpenSettings = {
  enabled: true,
  // `browser` omitted → normalizeBrowserTabsSettings applies defaults on read.
  entries: [
    {
      id: 'google',
      title: 'Google 搜索',
      aliases: ['g', 'google'],
      placeholder: '输入搜索关键词',
      urlTemplate: 'https://www.google.com/search?q={query}',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
      recordQueryHistory: false,
      maxQueryHistory: DEFAULT_MAX_QUERY_HISTORY,
    },
    {
      id: 'github',
      title: 'GitHub 仓库',
      aliases: ['gh', 'github'],
      placeholder: 'owner/repo 或关键词',
      urlTemplate: 'https://github.com/search?q={query}',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
      recordQueryHistory: false,
      maxQueryHistory: DEFAULT_MAX_QUERY_HISTORY,
    },
    {
      id: 'mdn',
      title: 'MDN 文档',
      aliases: ['mdn'],
      placeholder: '输入 Web API 或 CSS 关键词',
      urlTemplate: 'https://developer.mozilla.org/search?q={query}',
      encodeQuery: true,
      emptyQueryBehavior: 'block',
      recordQueryHistory: false,
      maxQueryHistory: DEFAULT_MAX_QUERY_HISTORY,
    },
  ],
}

/**
 * Expand a quick-open URL template.
 * - `{query}` → query (optionally URI-encoded)
 * - `{clipboard}` → extras.clipboard when provided, otherwise same as query
 *   (object-block / resolved input often lands in `query`; callers may still
 *   pass a distinct clipboard snapshot via extras).
 */
export function buildWebQuickOpenUrl(
  template: string,
  query: string,
  encode: boolean,
  extras?: { clipboard?: string },
): string {
  const queryValue = encode ? encodeURIComponent(query) : query
  const clipboardRaw = extras?.clipboard ?? query
  const clipboardValue = encode ? encodeURIComponent(clipboardRaw) : clipboardRaw
  return template
    .split('{query}').join(queryValue)
    .split('{clipboard}').join(clipboardValue)
}
