import { pickLocale, type Locale } from '../../i18n'
import { resolveInstalledAppIdByName } from '../appLauncher/hostAppLauncher'
import type { LauncherExecuteResult, LauncherItem, LauncherSurfaceId } from '../launcher/types'
import { scheduleIdleWork } from '../scheduleIdleWork'
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

type DesktopWindowPlatform = 'macos' | 'linux' | 'unsupported'
type WindowSearchRequest = { explicit: true; session: number; instance: number }
type LinuxWindowSearch = {
  generation: number
  request: Promise<WindowSearchRequest>
  windows: DesktopWindow[] | null
  fetchedAt: number
  loading: Promise<DesktopWindow[]> | null
}

let platformPromise: Promise<DesktopWindowPlatform> | null = null
let resolvedPlatform: DesktopWindowPlatform | null = null
let linuxRootSearchEnabled = false
let isDesktopWindowSearchVisible: () => boolean = () => false
let linuxSearch: LinuxWindowSearch | null = null
let linuxSearchGeneration = 0
let linuxReleaseBarrier: Promise<void> = Promise.resolve()

/** Pure platform information: this command never opens an X11 connection. */
export function getDesktopWindowPlatform(): Promise<DesktopWindowPlatform> {
  if (!isTauriRuntime()) return Promise.resolve('unsupported')
  platformPromise ??= import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<DesktopWindowPlatform>('get_desktop_window_platform'))
    .catch(() => 'unsupported' as const)
    .then((platform) => { resolvedPlatform = platform; return platform })
  return platformPromise
}

/** The root query can stay in memory while another command is visible. */
export function setDesktopWindowRootSearchEnabled(enabled: boolean): void {
  const changed = linuxRootSearchEnabled !== enabled
  linuxRootSearchEnabled = enabled
  if (changed && enabled && resolvedPlatform === 'linux') notifyDesktopWindowsUpdated()
}

/** Host-owned live visibility; tool/settings/permission overlays can cover the root frame. */
export function setDesktopWindowSearchVisibilityGuard(isVisible: () => boolean): void {
  isDesktopWindowSearchVisible = isVisible
}

/** Linux only accepts an explicit window search, never ordinary text or close. */
export function isExplicitWindowSearch(query: string): boolean {
  return /^(?:window|窗口|切到)(?:$|[\s:：])/i.test(query.trim())
}

export function isLinuxWindowId(id: string): boolean {
  return id.startsWith('x11:')
}

export function hasLinuxDesktopWindowSearch(): boolean {
  return linuxSearch !== null
}

/** Invalidate locally before awaiting native release so late replies cannot revive a search. */
export function releaseDesktopWindowSearch(): Promise<void> {
  linuxSearchGeneration += 1
  const previous = linuxSearch
  linuxSearch = null
  if (!previous) return linuxReleaseBarrier
  return releaseLinuxSnapshot(previous)
}

function releaseLinuxSnapshot(previous: LinuxWindowSearch): Promise<void> {
  previous.windows = null
  linuxReleaseBarrier = linuxReleaseBarrier.then(async () => {
    try {
      const request = await previous.request
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('release_desktop_window_search_session', { request })
    } catch {
      // Native close/reopen also revokes the session. Never log a target/token.
    }
  })
  return linuxReleaseBarrier
}

export function desktopWindowErrorMessage(error: unknown, locale: Locale): string {
  const code = error instanceof Error ? error.message : String(error)
  if (code.includes('x11-window-unsupported')) {
    return pickLocale(locale, '窗口搜索仅支持 X11 桌面；当前会话不支持（包括 Wayland）。', 'Window search requires an X11 desktop. This session is unsupported, including Wayland.')
  }
  if (code.includes('x11-window-expired')) {
    return pickLocale(locale, '窗口列表已过期，请重新搜索后选择。', 'The window list expired. Search again and choose a window.')
  }
  if (code.includes('x11-window-unavailable')) {
    return pickLocale(locale, '该窗口已关闭、隐藏或不可用，请重新搜索。', 'This window was closed, hidden, or became unavailable. Search again.')
  }
  return pickLocale(locale, '无法切换到该窗口，请重新搜索后重试。', 'Could not switch to this window. Search again and retry.')
}

function linuxSearchIsCurrent(search: LinuxWindowSearch): boolean {
  return linuxSearch === search && search.generation === linuxSearchGeneration
}

/** Called only from explicit root intent or the selected Switch Window command. */
async function listLinuxWindows(): Promise<DesktopWindow[]> {
  if (!isDesktopWindowSearchVisible()) return []
  let search = linuxSearch
  if (!search) {
    const generation = linuxSearchGeneration
    const request = linuxReleaseBarrier.then(async (): Promise<WindowSearchRequest> => {
      if (generation !== linuxSearchGeneration) throw new Error('x11-window-expired')
      const { invoke } = await import('@tauri-apps/api/core')
      if (generation !== linuxSearchGeneration || !isDesktopWindowSearchVisible()) throw new Error('x11-window-expired')
      const session = await invoke<{ session: number; instance: number }>('get_desktop_window_search_session')
      return { explicit: true, ...session }
    })
    search = { generation, request, windows: null, fetchedAt: 0, loading: null }
    linuxSearch = search
  }
  if (search.windows && Date.now() - search.fetchedAt < WINDOW_LIST_TTL_MS) return search.windows
  if (search.loading) return search.loading
  const current = search
  const loading = (async () => {
    const request = await current.request
    if (!linuxSearchIsCurrent(current)) return []
    const { invoke } = await import('@tauri-apps/api/core')
    if (!linuxSearchIsCurrent(current) || !isDesktopWindowSearchVisible()) return []
    const raw = await invoke<DesktopWindow[]>('list_desktop_windows', { query: null, request })
    if (!linuxSearchIsCurrent(current) || !isDesktopWindowSearchVisible()) return []
    // No enrichment, remembered title, app/PID cache, or background refresh on Linux.
    current.windows = Array.isArray(raw) ? raw.filter((win) => isLinuxWindowId(win.id)) : []
    current.fetchedAt = Date.now()
    return current.windows
  })()
  current.loading = loading
  try {
    return await loading
  } catch (error) {
    if (linuxSearchIsCurrent(current)) {
      // One shared failure invalidates this snapshot, not the user's intent.
      // Every still-current query awaiting it must receive the same error.
      linuxSearch = null
      void releaseLinuxSnapshot(current)
    }
    throw error
  } finally {
    if (current.loading === loading) current.loading = null
  }
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
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
  if (isLinuxWindowId(win.id)) return win.appId
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
  if (await getDesktopWindowPlatform() !== 'macos') return []
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
  // This generic cache is also called on startup/empty search: never enumerate Linux here.
  if (await getDesktopWindowPlatform() !== 'macos') return []
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
  void getDesktopWindowPlatform().then((platform) => {
    if (platform !== 'macos') return
    // Idle after boot — do not compete with plugin load / app index.
    scheduleIdleWork(() => {
      void listDesktopWindowsCached({ immediate: true })
    }, 4000)
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

export async function focusDesktopWindow(id: string, locale: Locale = 'en'): Promise<void> {
  if (!isTauriRuntime()) throw new Error('Window focus is only available in the desktop runtime.')
  const { invoke } = await import('@tauri-apps/api/core')
  if (isLinuxWindowId(id)) {
    const search = linuxSearch
    try {
      if (!search || !search.windows?.some((win) => win.id === id)) throw new Error('x11-window-expired')
      const request = await search.request
      if (!linuxSearchIsCurrent(search) || !isDesktopWindowSearchVisible()) throw new Error('x11-window-expired')
      await invoke('focus_desktop_window', { id, request })
    } catch (error) {
      if (search && linuxSearch === search) void releaseDesktopWindowSearch()
      throw new Error(desktopWindowErrorMessage(error, locale))
    }
    return
  }
  await invoke('focus_desktop_window', { id })
}

/**
 * Blocking window list for collect-input L2 (Switch Window).
 * Respects TTL so keystrokes do not re-hit CG; cold cache waits for one load.
 */
export async function listSwitchableWindowsForFilter(
  filter: string,
  locale: Locale,
  limit = QUERY_WINDOW_LIMIT,
): Promise<Array<{ win: DesktopWindow; title: string; subtitle: string; icon: string }>> {
  const generation = linuxSearchGeneration
  const platform = await getDesktopWindowPlatform()
  let windows: DesktopWindow[]
  if (platform === 'linux') {
    if (generation !== linuxSearchGeneration) return []
    try {
      windows = await listLinuxWindows()
    } catch (error) {
      if (generation !== linuxSearchGeneration || !isDesktopWindowSearchVisible()) return []
      throw error
    }
    if (generation !== linuxSearchGeneration) return []
  } else if (platform !== 'macos') {
    throw new Error('x11-window-unsupported')
  } else if (windowListCache && isCacheFresh(windowListCache)) {
    windows = windowListCache.windows
  } else if (listInflight) {
    windows = await listInflight
  } else {
    windows = await ensureWindowListLoading()
  }

  return windows
    .filter(isSwitchableDesktopWindow)
    .filter((win) => windowMatchesFilter(win, filter, locale))
    .slice(0, limit)
    .map((win) => ({
      win,
      title: windowDisplayTitle(win),
      subtitle: windowSubtitle(win),
      icon: windowIcon(win),
    }))
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

function buildFocusItem(win: DesktopWindow, locale: Locale, matchedQuery?: string): LauncherItem {
  const title = windowDisplayTitle(win)
  const subtitle = windowSubtitle(win)
  const listId = `host.window:focus:native:${win.id}`
  const transient = isLinuxWindowId(win.id)
  const usageKey = !transient && win.appName
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
      // Linux has already matched the text after its explicit intent prefix.
      // Keep that exact query as a transient alias so the shared host ranker
      // does not drop the row when it rechecks the full prefixed query.
      aliases: ['窗口', '切到', 'focus', 'window', win.appName, win.title, title,
        ...(transient && matchedQuery ? [matchedQuery] : []),
      ].filter(Boolean) as string[],
      kindLabel: 'Window',
      kindLabelI18n: { en: 'Window', zh: '窗口' },
    },
    behavior: { type: 'perform' },
    surfaces: ['global-launcher'],
    requiredCapabilities: ['desktop-windows'],
    recordUsage: !transient,
    experienceRecord: transient ? false : undefined,
    legacyUsageKeys: usageKey ? [usageKey] : undefined,
    execute: async () => {
      try {
        await focusDesktopWindow(win.id, locale)
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
  signal,
}: {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
  signal?: AbortSignal
}): Promise<LauncherItem[]> {
  if (surfaceId !== 'global-launcher') return []
  const generation = linuxSearchGeneration
  const platform = await getDesktopWindowPlatform()
  if (signal?.aborted) return []
  const { rest, mode } = stripWindowQueryPrefix(query)
  const q = normalizeQuery(query)
  if (platform === 'linux' || platform === 'unsupported') {
    if (!linuxRootSearchEnabled || !isDesktopWindowSearchVisible() || !isExplicitWindowSearch(query) || generation !== linuxSearchGeneration) return []
    try {
      if (platform === 'unsupported') throw new Error('x11-window-unsupported')
      const windows = await listLinuxWindows()
      if (!linuxRootSearchEnabled || !isDesktopWindowSearchVisible() || signal?.aborted || generation !== linuxSearchGeneration) return []
      return windows.filter(isSwitchableDesktopWindow)
        .filter((win) => windowMatchesFilter(win, rest, locale))
        .slice(0, QUERY_WINDOW_LIMIT)
        .map((win) => buildFocusItem(win, locale, query.trim()))
    } catch (error) {
      if (!linuxRootSearchEnabled || !isDesktopWindowSearchVisible() || signal?.aborted || generation !== linuxSearchGeneration) return []
      const message = desktopWindowErrorMessage(error, locale)
      return [{
        systemKey: 'host:window:unavailable',
        kind: 'host',
        display: { title: message, titleI18n: { en: desktopWindowErrorMessage(error, 'en'), zh: desktopWindowErrorMessage(error, 'zh') }, icon: 'AppWindow' },
        behavior: { type: 'perform' },
        surfaces: ['global-launcher'],
        directAnswer: {},
        disabledReason: { code: 'window-search-unavailable', message },
        recordUsage: false,
        experienceRecord: false,
        execute: async () => ({ ok: false, message }),
      }]
    }
  }
  const windows = (await listDesktopWindowsCached()).filter(isSwitchableDesktopWindow)

  if (!q && mode === 'search') {
    return windows.slice(0, EMPTY_QUERY_WINDOW_LIMIT).map((win) => buildFocusItem(win, locale))
  }

  const filter = rest.trim()
  const matched = windows
    .filter((win) => windowMatchesFilter(win, filter, locale))
    .slice(0, QUERY_WINDOW_LIMIT)

  if (mode === 'close') {
    return matched.map(buildCloseItem)
  }
  return matched.map((win) => buildFocusItem(win, locale))
}
