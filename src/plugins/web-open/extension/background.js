/**
 * Hiven Chromium tabs bridge (MV3).
 * Pushes tab snapshots, history, and page events to 127.0.0.1:19246,
 * and polls focus / open / config commands.
 */

const SOURCE_ID = 'browser.chromium'
const BRIDGE = 'http://127.0.0.1:19246'
const PUSH_ALARM = 'hiven-tabs-push'
const POLL_ALARM = 'hiven-tabs-poll'
const HISTORY_ALARM = 'hiven-history-push'
const IDLE_ALARM = 'hiven-idle-close'
const HISTORY_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000
const MIN_IDLE_TIMEOUT_MINUTES = 5
const HISTORY_MAX = 200
const HISTORY_IMPORT_MAX = 5_000
const HISTORY_IMPORT_BATCH_SIZE = 500
/** Fallback only: the alarm restarts the long-poll loop if the worker was evicted. */
const POLL_ALARM_MINUTES = 0.5
/** Desktop parks `/commands?wait=` up to this long; must stay under MV3's 30 s fetch limit. */
const COMMAND_WAIT_MS = 20_000
const COMMAND_FETCH_TIMEOUT_MS = COMMAND_WAIT_MS + 5_000
/** Floor between polls when the desktop answers instantly (older build without long-poll). */
const COMMAND_MIN_INTERVAL_MS = 1_000
/** Pages enriched with per-visit timestamps (one getVisits call each). */
const VISITS_DETAIL_MAX_URLS = 60
/** Timestamps kept per page — enough to establish span without bloating the POST. */
const VISITS_PER_URL_MAX = 80
const CONFIG_KEY = 'hivenBridgeConfig'
/** Reported with every snapshot so Hiven can tell when the loaded copy is outdated. */
const EXTENSION_VERSION = chrome.runtime.getManifest().version

/** @type {{ historyEnabled: boolean, autoCloseIdleTabs: boolean, idleTimeoutMinutes: number }} */
let config = {
  historyEnabled: true,
  autoCloseIdleTabs: false,
  idleTimeoutMinutes: 60,
}

/** @type {Map<number, { url?: string, lastAccess: number }>} */
const tabState = new Map()

function browserLabel() {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Brave/i.test(ua) || /Brave/.test(navigator.vendor || '')) return 'Brave'
  if (/OPR\//.test(ua)) return 'Opera'
  return 'Chrome'
}

function isHttpUrl(url) {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

function isProtectedUrl(url) {
  if (!url) return true
  return /^(chrome|edge|brave|opera|about|chrome-extension|devtools):/i.test(url)
}

/** Prefer real page favicon; fall back to public favicon service by domain. */
function faviconForTab(tab) {
  const raw = typeof tab.favIconUrl === 'string' ? tab.favIconUrl : ''
  if (
    raw.startsWith('https://') ||
    raw.startsWith('http://') ||
    raw.startsWith('data:image/')
  ) {
    return raw
  }
  try {
    if (tab.url && /^https?:/i.test(tab.url)) {
      const host = new URL(tab.url).hostname
      if (host) {
        return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
      }
    }
  } catch {
    // ignore
  }
  return undefined
}

function faviconForUrl(url) {
  try {
    if (!isHttpUrl(url)) return undefined
    const host = new URL(url).hostname
    if (!host) return undefined
    return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
  } catch {
    return undefined
  }
}

function rememberTab(tabId, patch) {
  const prev = tabState.get(tabId) || { lastAccess: Date.now() }
  tabState.set(tabId, { ...prev, ...patch })
}

async function collectTabs() {
  const tabs = await chrome.tabs.query({})
  const now = Date.now()
  return tabs
    .filter((t) => typeof t.id === 'number')
    .map((t) => {
      const lastAccess = typeof t.lastAccessed === 'number' && t.lastAccessed > 0
        ? t.lastAccessed
        : tabState.get(t.id)?.lastAccess ?? (t.active ? now : now)
      rememberTab(t.id, { url: t.url, lastAccess: t.active ? now : lastAccess })
      return {
        id: String(t.id),
        windowId: t.windowId != null ? String(t.windowId) : undefined,
        title: t.title || t.url || '(untitled)',
        url: t.url || undefined,
        active: Boolean(t.active),
        appName: browserLabel(),
        kind: 'tab',
        faviconUrl: faviconForTab(t),
      }
    })
}

let outdatedShown = null

/**
 * Unpacked extensions never auto-update, so after a Hiven upgrade the browser
 * keeps running this old copy. Badge the toolbar icon until it is reloaded.
 */
async function markOutdated(outdated) {
  if (outdated === outdatedShown) return
  outdatedShown = outdated
  try {
    await chrome.action.setBadgeText({ text: outdated ? '!' : '' })
    if (outdated) await chrome.action.setBadgeBackgroundColor({ color: '#d97706' })
    await chrome.action.setTitle({ title: chrome.i18n.getMessage(outdated ? 'actionTitleOutdated' : 'actionTitle') })
  } catch {
    outdatedShown = null
  }
}

async function pushSnapshot() {
  void commandLoop()
  try {
    const tabs = await collectTabs()
    const res = await fetch(`${BRIDGE}/v1/sources/${SOURCE_ID}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: browserLabel(), extensionVersion: EXTENSION_VERSION, tabs }),
    })
    if (res.ok) {
      const data = await res.json()
      void markOutdated(typeof data.bundledExtensionVersion === 'string' && data.bundledExtensionVersion !== EXTENSION_VERSION)
    }
  } catch {
    // Hiven not running — silent
  }
}

/**
 * Fetch individual visit timestamps for the busiest pages.
 *
 * visitCount + lastVisitTime cannot tell a months-long habit from a three-day
 * sprint that ended weeks ago — both look like "N visits, last seen X days ago".
 * getVisits returns the actual distribution, which is what the desktop side
 * needs to rank them differently.
 *
 * Note getVisits is NOT bounded by the search lookback window: a page returned
 * by a 30-day search yields its full retained visit history, which is exactly
 * the long-span signal the summary fields cannot provide.
 *
 * Bounded on both axes — one call per URL, so only the top pages are enriched,
 * and only the most recent timestamps per page are kept.
 */
async function collectVisitTimestamps(items) {
  if (!chrome.history?.getVisits) return new Map()
  const ranked = [...items]
    .sort((a, b) => (b.visitCount ?? 0) - (a.visitCount ?? 0))
    .slice(0, VISITS_DETAIL_MAX_URLS)

  const byUrl = new Map()
  await Promise.all(
    ranked.map(async (item) => {
      try {
        const visits = await chrome.history.getVisits({ url: item.url })
        const times = visits
          .map((visit) => visit.visitTime)
          .filter((time) => typeof time === 'number' && time > 0)
        if (times.length === 0) return
        // Newest last; keep the tail so recency survives the cap.
        times.sort((a, b) => a - b)
        byUrl.set(item.url, times.slice(-VISITS_PER_URL_MAX))
      } catch {
        // One unreadable URL must not cost the whole history push.
      }
    }),
  )
  return byUrl
}

async function collectHistory({ maxResults = HISTORY_MAX, startTime = Date.now() - HISTORY_LOOKBACK_MS, endTime, includeVisits = true } = {}) {
  if (!chrome.history?.search) return []
  const query = {
    text: '',
    maxResults,
    startTime,
  }
  if (typeof endTime === 'number') query.endTime = endTime
  const items = await chrome.history.search(query)
  const httpItems = items.filter((item) => isHttpUrl(item.url))
  const visitsByUrl = includeVisits ? await collectVisitTimestamps(httpItems) : new Map()
  return httpItems.map((item) => ({
    id: String(item.id ?? item.url),
    title: item.title || item.url,
    url: item.url,
    lastVisitTime: item.lastVisitTime,
    visitCount: item.visitCount,
    typedCount: item.typedCount,
    visits: visitsByUrl.get(item.url),
    faviconUrl: faviconForUrl(item.url),
    appName: browserLabel(),
  }))
}

async function pushHistory() {
  if (!config.historyEnabled) return
  try {
    const items = await collectHistory()
    await fetch(`${BRIDGE}/v1/sources/${SOURCE_ID}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: browserLabel(), items }),
    })
  } catch {
    // Hiven not running / history permission missing — silent
  }
}

async function pushHistoryImport(cmd) {
  const maxResults = Math.min(HISTORY_IMPORT_MAX, Math.max(HISTORY_MAX, Number(cmd.maxResults) || HISTORY_IMPORT_MAX))
  const batchSize = Math.min(HISTORY_IMPORT_BATCH_SIZE, Math.max(1, Number(cmd.batchSize) || HISTORY_IMPORT_BATCH_SIZE))
  let received = 0
  let endTime
  while (received < maxResults) {
    const items = await collectHistory({
      maxResults: Math.min(batchSize, maxResults - received),
      startTime: 0,
      endTime,
      includeVisits: false,
    })
    received += items.length
    const done = items.length < batchSize || received >= maxResults
    await fetch(`${BRIDGE}/v1/sources/${SOURCE_ID}/history`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: browserLabel(), requestId: cmd.requestId, items, done }),
    })
    if (done) break
    const oldest = Math.min(...items.map((item) => item.lastVisitTime || Date.now()))
    endTime = oldest - 1
  }
}

async function pushEvents(events) {
  const batch = events.filter((event) => event && event.type)
  if (batch.length === 0) return
  try {
    await fetch(`${BRIDGE}/v1/sources/${SOURCE_ID}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: browserLabel(), events: batch }),
    })
  } catch {
    // Hiven not running — silent
  }
}

function pageEvent(type, tab, extras = {}) {
  if (!tab) return null
  const url = tab.url || extras.url
  if (url && isProtectedUrl(url)) return null
  return {
    type,
    ts: Date.now(),
    tabId: tab.id != null ? String(tab.id) : extras.tabId,
    windowId: tab.windowId != null ? String(tab.windowId) : extras.windowId,
    title: tab.title || extras.title,
    url,
    faviconUrl: faviconForTab(tab),
    appName: browserLabel(),
  }
}

async function applyConfig(next) {
  if (!next || typeof next !== 'object') return
  const parsed = Number(next.idleTimeoutMinutes)
  const idleTimeoutMinutes = Number.isFinite(parsed)
    ? Math.max(MIN_IDLE_TIMEOUT_MINUTES, Math.round(parsed))
    : 60
  config = {
    historyEnabled: next.historyEnabled !== false,
    autoCloseIdleTabs: next.autoCloseIdleTabs === true,
    idleTimeoutMinutes,
  }
  try {
    await chrome.storage.local.set({ [CONFIG_KEY]: config })
  } catch {
    // ignore
  }
}

async function loadStoredConfig() {
  try {
    const stored = await chrome.storage.local.get(CONFIG_KEY)
    if (stored?.[CONFIG_KEY]) await applyConfig(stored[CONFIG_KEY])
  } catch {
    // ignore
  }
}

function tabLastAccess(tab) {
  if (typeof tab.lastAccessed === 'number' && tab.lastAccessed > 0) return tab.lastAccessed
  return tabState.get(tab.id)?.lastAccess ?? 0
}

async function closeIdleTabs() {
  if (!config.autoCloseIdleTabs) return
  const timeoutMs = config.idleTimeoutMinutes * 60 * 1000
  const now = Date.now()
  let tabs
  try {
    tabs = await chrome.tabs.query({})
  } catch {
    return
  }

  const byWindow = new Map()
  for (const tab of tabs) {
    if (typeof tab.id !== 'number') continue
    const list = byWindow.get(tab.windowId) || []
    list.push(tab)
    byWindow.set(tab.windowId, list)
  }

  const toClose = []
  for (const [, list] of byWindow) {
    const closable = list.filter((tab) => {
      if (tab.pinned || tab.active || tab.audible) return false
      if (isProtectedUrl(tab.url)) return false
      return now - tabLastAccess(tab) >= timeoutMs
    })
    const keep = list.length - closable.length
    if (keep < 1) closable.pop()
    for (const tab of closable) toClose.push(tab.id)
  }

  for (const tabId of toClose) {
    try {
      await chrome.tabs.remove(tabId)
      tabState.delete(tabId)
    } catch {
      // tab may have closed
    }
  }
}

async function focusTab(tabId, windowId) {
  if (windowId != null && Number.isFinite(windowId)) {
    await chrome.windows.update(windowId, { focused: true })
  }
  await chrome.tabs.update(tabId, { active: true })
  const tab = await chrome.tabs.get(tabId)
  if (tab.windowId != null) {
    await chrome.windows.update(tab.windowId, { focused: true })
  }
}

async function openUrl(url) {
  if (!isHttpUrl(url)) return
  const existing = await chrome.tabs.query({ url })
  if (existing[0]?.id != null) {
    await focusTab(existing[0].id, existing[0].windowId)
    return
  }
  await chrome.tabs.create({ url, active: true })
}

async function runCommands(commands) {
  for (const cmd of commands) {
    if (cmd.type === 'history.import' && typeof cmd.requestId === 'string') {
      await pushHistoryImport(cmd)
      continue
    }
    if (cmd.type === 'config') {
      await applyConfig(cmd)
      continue
    }
    if (cmd.type === 'open' && typeof cmd.url === 'string') {
      try {
        await openUrl(cmd.url)
      } catch {
        // ignore
      }
      continue
    }
    if (cmd.type !== 'focus' || cmd.id == null) continue
    const tabId = Number(cmd.id)
    if (!Number.isFinite(tabId)) continue
    try {
      const windowId = cmd.windowId != null ? Number(cmd.windowId) : undefined
      await focusTab(tabId, windowId)
    } catch {
      // Tab closed since Hiven listed it: reopen the page rather than doing nothing.
      if (typeof cmd.url === 'string') {
        try {
          await openUrl(cmd.url)
        } catch {
          // ignore
        }
      }
    }
  }
}

async function fetchCommands() {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), COMMAND_FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(`${BRIDGE}/v1/sources/${SOURCE_ID}/commands?wait=${COMMAND_WAIT_MS}`, {
      signal: controller.signal,
    })
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data.commands) ? data.commands : []
  } finally {
    clearTimeout(timer)
  }
}

let commandLoopRunning = false

/**
 * Long-poll loop: the desktop holds the request until a focus/open lands, so a
 * tab jump is delivered immediately instead of on the next 30 s alarm.
 */
async function commandLoop() {
  if (commandLoopRunning) return
  commandLoopRunning = true
  try {
    while (true) {
      const startedAt = Date.now()
      let commands = null
      try {
        commands = await fetchCommands()
      } catch {
        // bridge offline / aborted — fall through to backoff
      }
      if (commands) {
        try {
          await runCommands(commands)
        } catch {
          // a failed history import must not end the loop
        }
      }
      if (commands === null) {
        // Offline: stop; the alarm or the next tab event restarts the loop.
        return
      }
      const elapsed = Date.now() - startedAt
      if (elapsed < COMMAND_MIN_INTERVAL_MS) {
        await new Promise((resolve) => setTimeout(resolve, COMMAND_MIN_INTERVAL_MS - elapsed))
      }
    }
  } finally {
    commandLoopRunning = false
  }
}

function ensureAlarms() {
  chrome.alarms.create(PUSH_ALARM, { periodInMinutes: 1 / 60 })
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: POLL_ALARM_MINUTES })
  chrome.alarms.create(HISTORY_ALARM, { periodInMinutes: 2 })
  chrome.alarms.create(IDLE_ALARM, { periodInMinutes: 1 })
}

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarms()
  void pushSnapshot()
  void pushHistory()
})

chrome.runtime.onStartup.addListener(() => {
  ensureAlarms()
  void pushSnapshot()
  void pushHistory()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PUSH_ALARM) void pushSnapshot()
  if (alarm.name === POLL_ALARM) void commandLoop()
  if (alarm.name === HISTORY_ALARM) void pushHistory()
  if (alarm.name === IDLE_ALARM) void closeIdleTabs()
})

chrome.tabs.onCreated.addListener((tab) => {
  if (tab.id != null) rememberTab(tab.id, { url: tab.url, lastAccess: Date.now(), openedUrl: tab.url })
  void pushSnapshot()
  const event = pageEvent('tab.opened', tab)
  if (event) void pushEvents([event])
})

chrome.tabs.onRemoved.addListener((tabId) => {
  tabState.delete(tabId)
  void pushSnapshot()
})

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.url) rememberTab(tabId, { url: changeInfo.url })
  void pushSnapshot()
  if (changeInfo.status !== 'complete') return
  const url = tab.url || changeInfo.url
  const prevOpened = tabState.get(tabId)?.openedUrl
  rememberTab(tabId, { url, openedUrl: url })
  if (!url || url === prevOpened) return
  const event = pageEvent('tab.opened', tab, { url })
  if (event) void pushEvents([event])
})

chrome.tabs.onActivated.addListener((info) => {
  rememberTab(info.tabId, { lastAccess: Date.now() })
  void pushSnapshot()
  void chrome.tabs.get(info.tabId).then((tab) => {
    rememberTab(info.tabId, { url: tab.url, lastAccess: Date.now() })
    const event = pageEvent('tab.activated', tab, {
      tabId: String(info.tabId),
      windowId: info.windowId != null ? String(info.windowId) : undefined,
    })
    if (event) void pushEvents([event])
  }).catch(() => {
    // tab may have closed
  })
})

chrome.windows.onFocusChanged.addListener(() => { void pushSnapshot() })

let historyPushTimer = 0
function scheduleHistoryPush() {
  if (historyPushTimer) clearTimeout(historyPushTimer)
  historyPushTimer = setTimeout(() => {
    historyPushTimer = 0
    void pushHistory()
  }, 1500)
}

if (chrome.history?.onVisited) {
  chrome.history.onVisited.addListener(() => {
    scheduleHistoryPush()
  })
}

ensureAlarms()
void loadStoredConfig().then(() => {
  void pushSnapshot()
  void pushHistory()
})
