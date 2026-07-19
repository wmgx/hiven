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

const WINDOW_LIST_TTL_MS = 2000
const EMPTY_QUERY_WINDOW_LIMIT = 8
const QUERY_WINDOW_LIMIT = 40

const FOCUS_PREFIXES = ['切到', '窗口', 'focus', 'window', 'switch to', 'switch'] as const
const CLOSE_PREFIXES = ['关闭', '关掉', 'close'] as const

type WindowListCache = {
  fetchedAt: number
  windows: DesktopWindow[]
}

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

export async function listDesktopWindowsCached(options: { force?: boolean } = {}): Promise<DesktopWindow[]> {
  const now = Date.now()
  if (
    options.force !== true &&
    windowListCache &&
    now - windowListCache.fetchedAt < WINDOW_LIST_TTL_MS
  ) {
    return windowListCache.windows
  }
  if (!isTauriRuntime()) {
    windowListCache = { fetchedAt: now, windows: [] }
    return []
  }
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const windows = (await invoke('list_desktop_windows')) as DesktopWindow[]
    const list = Array.isArray(windows) ? windows : []
    windowListCache = { fetchedAt: Date.now(), windows: list }
    return list
  } catch {
    // Probe failure: hide entry rather than error-spam launcher.
    windowListCache = { fetchedAt: Date.now(), windows: [] }
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

function windowDisplayTitle(win: DesktopWindow): string {
  const title = win.title?.trim()
  if (title) return title
  return win.appName || 'Window'
}

function buildFocusItem(win: DesktopWindow): LauncherItem {
  const title = windowDisplayTitle(win)
  return {
    systemKey: `host:window:focus:${win.id}`,
    kind: 'host',
    display: {
      title,
      titleI18n: { en: title, zh: title },
      subtitle: win.appName,
      subtitleI18n: { en: `${win.appName} · Window`, zh: `${win.appName} · 窗口` },
      icon: 'AppWindow',
      aliases: ['窗口', '切到', 'focus', 'window', win.appName, win.title].filter(Boolean),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['desktop-windows'],
    recordUsage: true,
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
  return {
    systemKey: `host:window:close:${win.id}`,
    kind: 'host',
    display: {
      title: `Close: ${title}`,
      titleI18n: { en: `Close: ${title}`, zh: `关闭：${title}` },
      subtitle: win.appName,
      subtitleI18n: { en: `${win.appName} · Close window`, zh: `${win.appName} · 关闭窗口` },
      icon: 'X',
      aliases: ['关闭', '关掉', 'close', '窗口', win.appName, win.title].filter(Boolean),
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['desktop-windows'],
    recordUsage: true,
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
  // Empty query: at most a few windows (avoid flooding). Non-empty: filter.
  if (!q && mode === 'search') {
    const windows = await listDesktopWindowsCached()
    return windows.slice(0, EMPTY_QUERY_WINDOW_LIMIT).map(buildFocusItem)
  }

  const filter = rest.trim()
  // Prefix-only query like "切到" / "focus" / "关闭" with empty rest: list limited windows.
  const windows = await listDesktopWindowsCached()
  const matched = windows
    .filter((win) => windowMatchesFilter(win, filter, locale))
    .slice(0, QUERY_WINDOW_LIMIT)

  if (mode === 'close') {
    return matched.map(buildCloseItem)
  }
  return matched.map(buildFocusItem)
}
