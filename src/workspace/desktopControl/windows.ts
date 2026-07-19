import type { Locale } from '../../i18n'
import { resolveInstalledAppIdByName } from '../appLauncher/hostAppLauncher'
import type { LauncherExecuteResult, LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { searchableFieldsMatch } from '../searchRanking'
import { auditL2Action } from './audit'

export type DesktopWindow = {
  id: string
  appName: string
  title: string
  pid: number
  /** Stable installed-app id for `app-icon:` when available. */
  appId?: string
}

/** Longer TTL: listing is native and must not re-hit every keystroke. */
const WINDOW_LIST_TTL_MS = 8000
const EMPTY_QUERY_WINDOW_LIMIT = 8
const QUERY_WINDOW_LIMIT = 40
const DESKTOP_WINDOWS_UPDATED_EVENT = 'hiven:desktop-windows-updated'

type WindowListCache = {
  fetchedAt: number
  /** Cache key: '' for shared snapshot; client filters by query. */
  queryKey: string
  windows: DesktopWindow[]
  /** Whether offline AX enrich has been applied to this snapshot. */
  enriched: boolean
}

const FOCUS_PREFIXES = ['切到', '窗口', 'focus', 'window', 'switch to', 'switch'] as const
const CLOSE_PREFIXES = ['关闭', '关掉', 'close'] as const

let windowListCache: WindowListCache | null = null
/** In-flight CG(+enrich) list. Shared so open does not re-enter native. */
let listInflight: Promise<DesktopWindow[]> | null = null
/** Deferred cold-load timer — keep first launcher open free of native CG work. */
let deferredListTimer: ReturnType<typeof setTimeout> | null = null
/** After open paint: delay before starting native window list if cache is cold. */
const COLD_LOAD_DEFER_MS = 700
/**
 * Remember real document titles by window id so reopen paints final names first
 * (no "App · 窗口 1" → real title flash).
 */
const titleMemoryById = new Map<string, string>()
/** Remember appId by window id / pid so icons stay stable across list refreshes. */
const appIdMemoryByWindowId = new Map<string, string>()
const appIdMemoryByPid = new Map<number, string>()

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function isCacheFresh(cache: WindowListCache, now = Date.now()): boolean {
  return cache.queryKey === '' && now - cache.fetchedAt < WINDOW_LIST_TTL_MS
}

function normalizeQuery(query: string): string {
  return query.trim().toLowerCase()
}

function notifyDesktopWindowsUpdated(): void {
  try {
    window.dispatchEvent(new CustomEvent(DESKTOP_WINDOWS_UPDATED_EVENT))
  } catch {
    // ignore (non-DOM test env)
  }
}

/** Subscribe to cache updates after offline title enrich. */
export function subscribeDesktopWindowsUpdated(listener: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  const handler = () => listener()
  window.addEventListener(DESKTOP_WINDOWS_UPDATED_EVENT, handler)
  return () => window.removeEventListener(DESKTOP_WINDOWS_UPDATED_EVENT, handler)
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

function isPlaceholderWindowTitle(title: string, appName: string): boolean {
  const t = title.trim()
  const app = appName.trim()
  if (!t) return true
  if (/·\s*窗口\s*\d+$/.test(t)) return true
  if (/·\s*Untitled$/i.test(t)) return true
  // "Chrome (2)" style ordinals from native empty-title multi-window fallback
  if (app && new RegExp(`^${escapeRegExp(app)}(?:\\s*\\(\\d+\\))?$`, 'i').test(t)) return true
  return false
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function isRealDocumentTitle(title: string, appName: string): boolean {
  const t = title.trim()
  if (!t) return false
  return !isPlaceholderWindowTitle(t, appName)
}

function rememberTitles(windows: DesktopWindow[]): void {
  for (const win of windows) {
    if (isRealDocumentTitle(win.title, win.appName)) {
      titleMemoryById.set(win.id, win.title.trim())
    }
    if (win.appId) {
      appIdMemoryByWindowId.set(win.id, win.appId)
      appIdMemoryByPid.set(win.pid, win.appId)
    }
  }
}

function resolveWindowAppId(win: DesktopWindow): string | undefined {
  if (win.appId) return win.appId
  const byId = appIdMemoryByWindowId.get(win.id)
  if (byId) return byId
  const byPid = appIdMemoryByPid.get(win.pid)
  if (byPid) return byPid
  return resolveInstalledAppIdByName(win.appName)
}

/**
 * Prefer: real CG/AX title → remembered title → stable app name.
 * Also attach appId for app-icon: whenever possible.
 */
function applyStableTitles(windows: DesktopWindow[]): DesktopWindow[] {
  return windows.map((win) => {
    const appId = resolveWindowAppId(win)
    if (appId) {
      appIdMemoryByWindowId.set(win.id, appId)
      appIdMemoryByPid.set(win.pid, appId)
    }
    const incoming = win.title?.trim() ?? ''
    if (isRealDocumentTitle(incoming, win.appName)) {
      titleMemoryById.set(win.id, incoming)
      return { ...win, title: incoming, appId: appId ?? win.appId }
    }
    const remembered = titleMemoryById.get(win.id)
    if (remembered) {
      return { ...win, title: remembered, appId: appId ?? win.appId }
    }
    // Stable first paint: app name only (no 窗口 N ordinal flash).
    return {
      ...win,
      title: win.appName?.trim() || incoming || 'Window',
      appId: appId ?? win.appId,
    }
  })
}

function needsTitleEnrich(windows: DesktopWindow[]): boolean {
  return windows.some((w) => !isRealDocumentTitle(w.title, w.appName))
}

function titlesSignature(windows: DesktopWindow[]): string {
  return windows.map((w) => `${w.id}\0${w.title}`).join('\n')
}

/**
 * One-shot load: CG list + optional AX enrich, then a **single** UI notify.
 * Prevents "App · 窗口 1" → real title remount flicker.
 */
async function loadWindowsWithStableTitles(): Promise<DesktopWindow[]> {
  const { invoke } = await import('@tauri-apps/api/core')
  const raw = (await invoke('list_desktop_windows', { query: null })) as DesktopWindow[]
  let list = applyStableTitles(Array.isArray(raw) ? raw : [])

  if (needsTitleEnrich(list)) {
    try {
      const enriched = (await invoke('list_desktop_windows_enriched')) as DesktopWindow[]
      list = applyStableTitles(Array.isArray(enriched) ? enriched : list)
    } catch {
      // Keep CG+memory titles
    }
  }

  rememberTitles(list)
  return list
}

/**
 * Native CG(+enrich) fetch. Single-flight; notifies once when final titles are ready.
 */
function ensureWindowListLoading(options: { force?: boolean } = {}): Promise<DesktopWindow[]> {
  if (!isTauriRuntime()) {
    windowListCache = { fetchedAt: Date.now(), queryKey: '', windows: [], enriched: true }
    return Promise.resolve([])
  }
  if (listInflight && options.force !== true) return listInflight

  const run = (async () => {
    try {
      const previousSig = windowListCache ? titlesSignature(windowListCache.windows) : ''
      const list = await loadWindowsWithStableTitles()
      windowListCache = {
        fetchedAt: Date.now(),
        queryKey: '',
        windows: list,
        enriched: true,
      }
      // Notify only when content actually changes (or first load).
      if (previousSig !== titlesSignature(list)) {
        notifyDesktopWindowsUpdated()
      } else if (!previousSig) {
        notifyDesktopWindowsUpdated()
      }
      return list
    } catch {
      windowListCache = {
        fetchedAt: Date.now(),
        queryKey: '',
        windows: windowListCache?.windows ?? [],
        enriched: true,
      }
      return windowListCache.windows
    } finally {
      listInflight = null
    }
  })()

  listInflight = run
  return run
}

/**
 * Schedule a cold CG load without starting it on this tick.
 * First Global Launcher open must not compete with window show / IME / focus.
 */
function scheduleDeferredWindowListLoad(delayMs = COLD_LOAD_DEFER_MS): void {
  if (!isTauriRuntime()) return
  if (listInflight) return
  if (windowListCache && isCacheFresh(windowListCache)) return
  if (deferredListTimer != null) return
  deferredListTimer = setTimeout(() => {
    deferredListTimer = null
    void ensureWindowListLoading()
  }, delayMs)
}

/**
 * **Non-blocking by default** (lazy):
 * - Fresh cache → return immediately (no native call).
 * - Cold / expired → return last known list (or []) and **defer** native load
 *   so first open paint is not contending with CGWindowList.
 * - `force: true` → wait for a fresh native list (e.g. after close).
 * - `immediate: true` → start background load now (prefetch / idle warm).
 *
 * Filtering by search text is done in JS — never re-invoke native per keystroke.
 */
export async function listDesktopWindowsCached(
  options: { force?: boolean; immediate?: boolean } = {},
): Promise<DesktopWindow[]> {
  const now = Date.now()
  if (options.force === true) {
    if (deferredListTimer != null) {
      clearTimeout(deferredListTimer)
      deferredListTimer = null
    }
    return ensureWindowListLoading({ force: true })
  }
  if (windowListCache && isCacheFresh(windowListCache, now)) {
    return windowListCache.windows
  }
  // Stale or cold: never block; only optionally start native work.
  if (options.immediate === true) {
    void ensureWindowListLoading()
  } else {
    scheduleDeferredWindowListLoad()
  }
  return windowListCache?.windows ?? []
}

/**
 * Warm the CG window list after app startup so the first Global Launcher open
 * usually hits cache. Safe to call multiple times (single-flight).
 */
export function prefetchDesktopWindowsOnStartup(): void {
  if (!isTauriRuntime()) return
  // Idle after boot — do not compete with plugin load / app index.
  const schedule =
    typeof window !== 'undefined' && 'requestIdleCallback' in window
      ? (cb: () => void) => {
          ;(window as unknown as { requestIdleCallback: (fn: () => void, opts?: { timeout: number }) => void })
            .requestIdleCallback(cb, { timeout: 4000 })
        }
      : (cb: () => void) => window.setTimeout(cb, 2000)
  schedule(() => {
    void listDesktopWindowsCached({ immediate: true })
  })
}

/** Test helper: reset in-memory TTL cache. */
export function clearDesktopWindowListCache(): void {
  windowListCache = null
  listInflight = null
  // Keep titleMemoryById across clears so reopen still paints stable names.
  if (deferredListTimer != null) {
    clearTimeout(deferredListTimer)
    deferredListTimer = null
  }
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
 * Switchable window = real on-screen window (native already drops zero-size /
 * non-layer-0 / self). Empty CG titles are OK — macOS often omits kCGWindowName
 * without Screen Recording; native fills "App · 窗口 N" as a readable fallback.
 */
export function isSwitchableDesktopWindow(win: DesktopWindow): boolean {
  const app = win.appName?.trim() ?? ''
  const title = win.title?.trim() ?? ''
  // Need at least an app name or title after native normalize.
  return Boolean(app || title)
}

/**
 * Primary line: document/page title when known; otherwise app name.
 * Subtitle always carries the app for context (Mission Control style).
 */
function windowDisplayTitle(win: DesktopWindow): string {
  const title = win.title?.trim()
  const app = win.appName?.trim() || 'Window'
  if (title && isRealDocumentTitle(title, app)) return title
  if (title) return title
  return app
}

function windowSubtitle(win: DesktopWindow): string {
  const app = win.appName?.trim() || 'App'
  const title = win.title?.trim() ?? ''
  // When primary is already the app name, skip redundant subtitle noise.
  if (!title || title.toLowerCase() === app.toLowerCase() || isPlaceholderWindowTitle(title, app)) {
    return app
  }
  return app
}

function windowIcon(win: DesktopWindow): string {
  const appId = resolveWindowAppId(win)
  if (appId) return `app-icon:${appId}`
  return 'AppWindow'
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
      icon: windowIcon(win),
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
          title: 'Close window',
          titleI18n: { en: 'Close window', zh: '确认关闭窗口' },
          subtitle: summary,
          subtitleI18n: { en: summary, zh: summary },
          icon: windowIcon(win),
          tone: 'danger',
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
          subtitle: 'Keep the window open',
          subtitleI18n: { en: 'Keep the window open', zh: '不关闭，返回列表' },
          icon: 'X',
          tone: 'muted',
          primaryAction: async () => ({ ok: true, keepOpen: true as const }),
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
  const windows = (await listDesktopWindowsCached()).filter(isSwitchableDesktopWindow)

  if (!q && mode === 'search') {
    return windows.slice(0, EMPTY_QUERY_WINDOW_LIMIT).map(buildFocusItem)
  }

  const filter = rest.trim()
  const matched = windows
    .filter((win) => windowMatchesFilter(win, filter, locale))
    .slice(0, QUERY_WINDOW_LIMIT)

  if (mode === 'close') {
    return matched.map(buildCloseItem)
  }
  return matched.map(buildFocusItem)
}
