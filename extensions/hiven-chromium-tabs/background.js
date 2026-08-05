/**
 * Hiven Chromium tabs bridge (MV3).
 * Pushes tab snapshots to 127.0.0.1:19246 and polls focus commands.
 */

const SOURCE_ID = 'browser.chromium'
const BRIDGE = 'http://127.0.0.1:19246'
const PUSH_ALARM = 'hiven-tabs-push'
const POLL_ALARM = 'hiven-tabs-poll'

function browserLabel() {
  const ua = navigator.userAgent
  if (/Edg\//.test(ua)) return 'Edge'
  if (/Brave/i.test(ua) || /Brave/.test(navigator.vendor || '')) return 'Brave'
  if (/OPR\//.test(ua)) return 'Opera'
  return 'Chrome'
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
  // chrome://favicon/* etc. cannot load inside the launcher webview
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

async function collectTabs() {
  const tabs = await chrome.tabs.query({})
  return tabs
    .filter((t) => typeof t.id === 'number')
    .map((t) => ({
      id: String(t.id),
      windowId: t.windowId != null ? String(t.windowId) : undefined,
      title: t.title || t.url || '(untitled)',
      url: t.url || undefined,
      active: Boolean(t.active),
      appName: browserLabel(),
      kind: 'tab',
      faviconUrl: faviconForTab(t),
    }))
}

async function pushSnapshot() {
  try {
    const tabs = await collectTabs()
    await fetch(`${BRIDGE}/v1/sources/${SOURCE_ID}/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appName: browserLabel(), tabs }),
    })
  } catch {
    // Hiven not running — silent
  }
}

async function pollCommands() {
  try {
    const res = await fetch(`${BRIDGE}/v1/sources/${SOURCE_ID}/commands`)
    if (!res.ok) return
    const data = await res.json()
    const commands = Array.isArray(data.commands) ? data.commands : []
    for (const cmd of commands) {
      if (cmd.type !== 'focus' || cmd.id == null) continue
      const tabId = Number(cmd.id)
      if (!Number.isFinite(tabId)) continue
      try {
        if (cmd.windowId != null) {
          const windowId = Number(cmd.windowId)
          if (Number.isFinite(windowId)) {
            await chrome.windows.update(windowId, { focused: true })
          }
        }
        await chrome.tabs.update(tabId, { active: true })
        const tab = await chrome.tabs.get(tabId)
        if (tab.windowId != null) {
          await chrome.windows.update(tab.windowId, { focused: true })
        }
      } catch {
        // tab may have closed
      }
    }
  } catch {
    // bridge offline
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(PUSH_ALARM, { periodInMinutes: 1 / 60 })
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 / 120 })
  void pushSnapshot()
})

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create(PUSH_ALARM, { periodInMinutes: 1 / 60 })
  chrome.alarms.create(POLL_ALARM, { periodInMinutes: 1 / 120 })
  void pushSnapshot()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === PUSH_ALARM) void pushSnapshot()
  if (alarm.name === POLL_ALARM) void pollCommands()
})

chrome.tabs.onCreated.addListener(() => { void pushSnapshot() })
chrome.tabs.onRemoved.addListener(() => { void pushSnapshot() })
chrome.tabs.onUpdated.addListener(() => { void pushSnapshot() })
chrome.tabs.onActivated.addListener(() => { void pushSnapshot() })
chrome.windows.onFocusChanged.addListener(() => { void pushSnapshot() })

// Initial push when worker starts
void pushSnapshot()
