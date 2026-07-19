import type { Locale } from '../../i18n'
import type { LauncherExecuteResult, LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { searchableFieldsMatch } from '../searchRanking'
import { auditL2Action } from './audit'

export type DesktopWindow = {
  id: string
  appName: string
  title: string
  pid: number
}

/** Longer TTL: listing is native and must not re-hit every keystroke. */
const WINDOW_LIST_TTL_MS = 8000
const EMPTY_QUERY_WINDOW_LIMIT = 8
const QUERY_WINDOW_LIMIT = 40

type WindowListCache = {
  fetchedAt: number
  /** Cache key: '' for fast empty-query list; non-empty for filtered+AX enrich. */
  queryKey: string
  windows: DesktopWindow[]
}

const FOCUS_PREFIXES = ['切到', '窗口', 'focus', 'window', 'switch to', 'switch'] as const
const CLOSE_PREFIXES = ['关闭', '关掉', 'close'] as const

let windowListCache: WindowListCache | null = null

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

/** Strip known intent prefixes (longest first) for filter text. */
export function stripWindowQueryPrefix(query: string): { rest: string; mode: 'focus' | 'close' | 'search' } {
  const trimmed = query.trim()
  const lower = trimmed.toLowerCase()

  for (const prefix of CLOSE_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix} `) || lower.startsWith(`${prefix}:`) || lower.startsWith(`${prefix}：`)) {
      const rest = trimmed.slice(prefix.length).replace(/^[\s:：]+/, '')
      return { rest, mode: 'close' }
    }
  }
  for (const prefix of FOCUS_PREFIXES) {
    if (lower === prefix || lower.startsWith(`${prefix} `) || lower.startsWith(`${prefix}:`) || lower.startsWith(`${prefix}：`)) {
      const rest = trimmed.slice(prefix.length).replace(/^[\s:：]+/, '')
      return { rest, mode: 'focus' }
    }
  }
  return { rest: trimmed, mode: 'search' }
}

function windowMatchesFilter(win: DesktopWindow, filter: string, locale: Locale): boolean {
  const q = filter.trim()
  if (!q) return true
  return searchableFieldsMatch(
    {
      id: '',
      title: win.title || win.appName,
      aliases: [win.appName, win.title].filter(Boolean),
    },
    q.toLowerCase(),
    locale,
  )
}

/**
 * @param filterQuery When non-empty, native may AX-enrich titles for matching apps
 * (slow path, capped). Empty query is CG-only and must stay fast for launcher open.
 */
export async function listDesktopWindowsCached(
  options: { force?: boolean; filterQuery?: string } = {},
): Promise<DesktopWindow[]> {
  const now = Date.now()
  const queryKey = (options.filterQuery ?? '').trim().toLowerCase()
  if (
    options.force !== true &&
    windowListCache &&
    windowListCache.queryKey === queryKey &&
    now - windowListCache.fetchedAt < WINDOW_LIST_TTL_MS
  ) {
    return windowListCache.windows
  }
  if (!isTauriRuntime()) {
    windowListCache = { fetchedAt: now, queryKey, windows: [] }
    return []
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const windows = (await invoke('list_desktop_windows', {
      query: queryKey || null,
    })) as DesktopWindow[]
    const list = Array.isArray(windows) ? windows : []
    windowListCache = { fetchedAt: Date.now(), queryKey, windows: list }
    return list
  } catch {
    // Probe failure: hide entry rather than error-spam launcher.
    windowListCache = { fetchedAt: Date.now(), queryKey, windows: [] }
    return []
  }
}

/** Test helper: reset in-memory TTL cache. */
export function clearDesktopWindowListCache(): void {
  windowListCache = null
}

async function focusDesktopWindow(id: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Window focus is only available in the desktop runtime.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('focus_desktop_window', { id })
}

async function closeDesktopWindow(id: string): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Window close is only available in the desktop runtime.')
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('close_desktop_window', { id })
}

/**
 * Primary line: window title (document / page name).
 * Never fall back to bare appName when title is empty — native layer should
 * already enrich; last resort is "App · Untitled window".
 */
function windowDisplayTitle(win: DesktopWindow): string {
  const title = win.title?.trim()
  const app = win.appName?.trim() || 'Window'
  if (title && title.toLowerCase() !== app.toLowerCase()) {
    // Prefer real window / page title over bare app name.
    return title
  }
  if (title) return title
  return `${app} · Untitled`
}

function windowSubtitle(win: DesktopWindow): string {
  const app = win.appName?.trim() || 'App'
  // Always show app as context under the window title.
  return app
}

function buildFocusItem(win: DesktopWindow): LauncherItem {
  const title = windowDisplayTitle(win)
  const subtitle = windowSubtitle(win)
  const listId = `host.window:focus:native:${win.id}`
  const usageKey = win.appName
    ? `host:window:focus:app:${win.appName}`
    : null
  return {
    systemKey: listId,
    kind: 'host',
    display: {
      title,
      titleI18n: { en: title, zh: title },
      subtitle,
      subtitleI18n: { en: subtitle, zh: subtitle },
      icon: 'AppWindow',
      aliases: ['窗口', '切到', 'focus', 'window', win.appName, win.title, title].filter(Boolean) as string[],
      kindLabel: 'Window',
      kindLabelI18n: { en: 'Window', zh: '窗口' },
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['desktop-windows'],
    recordUsage: true,
    legacyUsageKeys: usageKey ? [usageKey] : undefined,
    execute: async () => {
      try {
        await focusDesktopWindow(win.id)
        return { ok: true }
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : String(error) }
      }
    },
  }
}

function buildCloseConfirmResult(win: DesktopWindow): LauncherExecuteResult {
  const title = windowDisplayTitle(win)
  const summary = `${win.appName} — ${title}`
  return {
    ok: true,
    output: {
      choices: [
        {
          id: 'confirm-close-window',
          title: 'Confirm close',
          titleI18n: { en: 'Confirm close', zh: '确认关闭' },
          subtitle: summary,
          subtitleI18n: { en: summary, zh: summary },
          primaryAction: async () => {
            try {
              auditL2Action({ action: 'window.close', targetSummary: summary })
              await closeDesktopWindow(win.id)
              clearDesktopWindowListCache()
              return { ok: true }
            } catch (error) {
              return { ok: false, message: error instanceof Error ? error.message : String(error) }
            }
          },
        },
        {
          id: 'cancel-close-window',
          title: 'Cancel',
          titleI18n: { en: 'Cancel', zh: '取消' },
          primaryAction: async () => ({ ok: true }),
        },
      ],
    },
  }
}

function buildCloseItem(win: DesktopWindow): LauncherItem {
  const title = windowDisplayTitle(win)
  const subtitle = windowSubtitle(win)
  return {
    systemKey: `host.window:close:native:${win.id}`,
    kind: 'host',
    display: {
      title: `Close: ${title}`,
      titleI18n: { en: `Close: ${title}`, zh: `关闭：${title}` },
      subtitle,
      subtitleI18n: { en: subtitle, zh: subtitle },
      icon: 'X',
      aliases: ['关闭', '关掉', 'close', '窗口', win.appName, win.title, title].filter(Boolean) as string[],
      kindLabel: 'Window',
      kindLabelI18n: { en: 'Window', zh: '窗口' },
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['desktop-windows'],
    recordUsage: false,
    execute: async () => buildCloseConfirmResult(win),
  }
}

export async function getHostWindowLauncherDynamicItems({
  query,
  surfaceId,
  locale,
}: {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
}): Promise<LauncherItem[]> {
  if (surfaceId !== 'global-launcher') return []

  const { rest, mode } = stripWindowQueryPrefix(query)
  const q = normalizeQuery(query)
  // Empty query: fast CG-only list, few rows (avoid flooding + avoid AX).
  if (!q && mode === 'search') {
    const windows = await listDesktopWindowsCached({ filterQuery: '' })
    return windows.slice(0, EMPTY_QUERY_WINDOW_LIMIT).map(buildFocusItem)
  }

  const filter = rest.trim()
  // Non-empty filter: allow limited AX title enrich for matching apps (capped on native side).
  const windows = await listDesktopWindowsCached({ filterQuery: filter || q })
  const matched = windows
    .filter((win) => windowMatchesFilter(win, filter, locale))
    .slice(0, QUERY_WINDOW_LIMIT)

  if (mode === 'close') {
    return matched.map(buildCloseItem)
  }
  return matched.map(buildFocusItem)
}
