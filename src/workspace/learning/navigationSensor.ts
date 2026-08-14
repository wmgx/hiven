/**
 * Self-learning · navigation sensor (scenario D, D2 — impure).
 *
 * Passively accumulates the URLs the user visits so the template-induction core
 * can discover "you keep opening X/{id}" patterns.
 *
 * Preferred signal: extension page events (`tab.opened` / `tab.activated`) plus
 * a one-shot history seed. Fallback: poll the active-tab snapshot when events
 * are unavailable. Raw URLs and raw slot values are never persisted.
 *
 * Gated to the Tauri runtime; a no-op when no bridge/extension is present.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §11 (D) / §5.
 */

import {
  listDesktopBridgeEvents,
  listDesktopBridgeHistory,
  listDesktopBridgeTargets,
} from '../desktopControl/bridgeTargets'
import { TelemetryEvents, trackPerf } from '../telemetry'
import { getRecentClipboardTokens } from './observer'
import { putNavigation, pruneOldNavigations } from './store'
import { saltedHash } from './store'
import { hostnameOf, templatizeUrl, templatizeUrlWithToken, type UrlTemplateResult } from './urlTemplate'

const POLL_INTERVAL_MS = 3000
const HISTORY_SEED_CAP = 200
const PAGE_EVENT_TYPES = new Set(['tab.opened', 'tab.activated'])

/**
 * Host of the most recently observed active URL, from whatever desktop-bridge
 * source reported it (source-agnostic — no browser/plugin concept here, just
 * "the last URL any target gave us"). In-memory only; used by fire.ts to boost
 * a learned rule whose destination host matches where the user currently is —
 * a plain string comparison, not host-specific logic.
 */
let currentActiveHost: string | null = null

/** Read the current active host (sync; cheap) — for fire-time rule disambiguation. */
export function getCurrentActiveHost(): string | null {
  return currentActiveHost
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

/** Read the active target's URL from any bridge source (generic — no product id). */
async function readActiveUrl(): Promise<string | null> {
  try {
    const targets = await listDesktopBridgeTargets()
    for (const target of targets) {
      if (target.active && typeof target.url === 'string' && target.url) return target.url
    }
  } catch {
    // no bridge / not connected
  }
  return null
}

function isHttpUrl(url: string | null | undefined): url is string {
  return typeof url === 'string' && /^https?:\/\//i.test(url)
}

/**
 * Prefer a copy-correlated slot (scenario A): if a recently-copied token appears
 * in the URL, template around that exact token — this also catches ids the pure
 * heuristic drops, notably `?logid={id}`. Fall back to the path heuristic (D).
 */
function resolveTemplate(url: string): { result: UrlTemplateResult; copyCorrelated: boolean } | null {
  for (const token of getRecentClipboardTokens()) {
    const withToken = templatizeUrlWithToken(url, token)
    if (withToken && withToken.slots.length > 0) return { result: withToken, copyCorrelated: true }
  }
  const heuristic = templatizeUrl(url)
  if (heuristic && heuristic.slots.length > 0) return { result: heuristic, copyCorrelated: false }
  return null
}

function recordNavigation(url: string): void {
  const resolved = resolveTemplate(url)
  if (!resolved) return
  const { result, copyCorrelated } = resolved
  const slotKind = result.slotKinds[result.slotKinds.length - 1]
  void putNavigation({
    template: result.template,
    slotHash: saltedHash(result.slots.join('|')),
    slotKind,
    ts: Date.now(),
  })
  // Shape-only diagnostics — never the raw URL/value.
  trackPerf(TelemetryEvents.learningNavObserve, { host: result.host, slotKind, copyCorrelated })
}

let started = false

/** Start passive navigation observation. Idempotent; returns a stop function. */
export function startNavigationSensor(): () => void {
  if (started) return () => undefined
  if (!isTauriRuntime()) return () => undefined
  started = true
  void pruneOldNavigations()

  let stopped = false
  let polling = false
  let lastUrl: string | null = null
  let lastEventTs = 0
  let historySeeded = false

  const consumeUrl = (url: string | null | undefined) => {
    if (!isHttpUrl(url) || url === lastUrl) return
    lastUrl = url
    currentActiveHost = hostnameOf(url)
    recordNavigation(url)
  }

  const seedHistory = async () => {
    if (historySeeded) return
    try {
      const items = await listDesktopBridgeHistory()
      if (items.length === 0) return
      historySeeded = true
      const seen = new Set<string>()
      for (const item of items.slice(0, HISTORY_SEED_CAP)) {
        if (!isHttpUrl(item.url) || seen.has(item.url)) continue
        seen.add(item.url)
        recordNavigation(item.url)
      }
    } catch {
      // isolate from the poll loop
    }
  }

  const consumeEvents = async () => {
    try {
      const events = await listDesktopBridgeEvents(undefined, lastEventTs)
      for (const event of events) {
        if (event.ts > lastEventTs) lastEventTs = event.ts
        if (!PAGE_EVENT_TYPES.has(event.type)) continue
        consumeUrl(event.url)
      }
    } catch {
      // isolate from the poll loop
    }
  }

  const tick = async () => {
    if (stopped || polling) return
    polling = true
    try {
      await consumeEvents()
      if (!historySeeded) await seedHistory()
      // Snapshot fallback when the extension is connected but events are quiet.
      const url = await readActiveUrl()
      if (!stopped) consumeUrl(url)
    } catch {
      // isolate from the poll loop
    } finally {
      polling = false
    }
  }

  const intervalId = window.setInterval(() => void tick(), POLL_INTERVAL_MS)
  void tick()

  return () => {
    stopped = true
    started = false
    currentActiveHost = null
    window.clearInterval(intervalId)
  }
}
