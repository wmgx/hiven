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
import type { HistoryEntryLike } from './clipboardBrowserLink'
import { getRecentClipboardTokensWithSource, setCurrentSourceHost } from './observer'
import { putNavigation, putPathObservation, pruneOldNavigations } from './store'
import { saltedHash } from './store'
import { hostnameOf, templatizeUrl, templatizeUrlWithToken, type UrlTemplateResult } from './urlTemplate'

const POLL_INTERVAL_MS = 3000
const HISTORY_SEED_CAP = 200
const PAGE_EVENT_TYPES = new Set(['tab.opened', 'tab.activated'])

/**
 * Recent history for scenario L3 (clipboard token → "you already saw this page").
 * A plain refresh cache, independent of the one-shot template-discovery seed
 * above — recall needs to stay current for as long as the sensor runs, not
 * just bootstrap once. In-memory only; titles are never persisted to the
 * learning store (the query-time match happens directly against this cache).
 */
const HISTORY_RECALL_CAP = 300
const HISTORY_RECALL_REFRESH_MS = 2 * 60 * 1000
let recentHistoryEntries: HistoryEntryLike[] = []

/** Snapshot of recently visited pages, newest-first — read by fire.ts (sync, cheap). */
export function getRecentHistoryForRecall(): readonly HistoryEntryLike[] {
  return recentHistoryEntries
}

async function refreshHistoryRecallCache(): Promise<void> {
  try {
    const items = await listDesktopBridgeHistory()
    recentHistoryEntries = items.slice(0, HISTORY_RECALL_CAP).map((item) => ({
      url: item.url,
      title: item.title,
    }))
  } catch {
    // isolate from the poll loop — keep the last-known-good cache
  }
}

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
 *
 * Also carries the token's own copy-time source host (scenario L1/L2) — '' when
 * unknown or when this was a pure heuristic match with no copy behind it.
 */
function resolveTemplate(
  url: string,
): { result: UrlTemplateResult; copyCorrelated: boolean; sourceHost: string } | null {
  for (const { token, sourceHost } of getRecentClipboardTokensWithSource()) {
    const withToken = templatizeUrlWithToken(url, token)
    if (withToken && withToken.slots.length > 0) return { result: withToken, copyCorrelated: true, sourceHost }
  }
  const heuristic = templatizeUrl(url)
  if (heuristic && heuristic.slots.length > 0) return { result: heuristic, copyCorrelated: false, sourceHost: '' }
  return null
}

/**
 * One concrete path per (host, segment count), kept in memory only.
 *
 * Position-variance induction runs on hashes, but turning its result into a
 * template needs the literal constants back (`merge_requests`). Rather than
 * persist raw segments, we keep the most recent example of each shape for the
 * process lifetime and read it when a rule is actually being built. Lost on
 * restart, which only delays a discovery — it never loses one.
 */
const recentPathSamples = new Map<string, { host: string; segments: string[] }>()
const RECENT_PATH_SAMPLES_MAX = 200

export function pathSampleKey(host: string, segmentCount: number): string {
  return `${host} ${segmentCount}`
}

/** Most recent concrete path for a shape, if this process has seen one. */
export function getRecentPathSample(
  host: string,
  segmentCount: number,
): { host: string; segments: string[] } | null {
  return recentPathSamples.get(pathSampleKey(host, segmentCount)) ?? null
}

/** Split a URL path into non-empty segments; null when there is nothing to learn from. */
function pathSegmentsOf(url: string): { host: string; segments: string[] } | null {
  const match = /^https?:\/\/([^/?#]+)([^?#]*)/i.exec(url.trim())
  if (!match) return null
  const host = (match[1] ?? '').toLowerCase()
  if (!host) return null
  const segments = (match[2] ?? '').split('/').filter(Boolean)
  if (segments.length === 0) return null
  return { host, segments }
}

/**
 * Record the path shape for position-variance induction: per-segment salted
 * hashes (never the segments themselves), plus an in-memory literal sample.
 *
 * Runs for EVERY http navigation, including ones templatizeUrl rejects — those
 * are exactly the text-variable paths this induction exists to find.
 */
function recordPathShape(url: string): void {
  const parsed = pathSegmentsOf(url)
  if (!parsed) return
  const { host, segments } = parsed

  const key = pathSampleKey(host, segments.length)
  if (!recentPathSamples.has(key) && recentPathSamples.size >= RECENT_PATH_SAMPLES_MAX) {
    // Bounded: drop the oldest inserted shape (Map preserves insertion order).
    const oldest = recentPathSamples.keys().next().value
    if (oldest !== undefined) recentPathSamples.delete(oldest)
  }
  recentPathSamples.set(key, { host, segments })

  void putPathObservation({
    host,
    segmentHashes: segments.map((segment) => saltedHash(segment)),
    ts: Date.now(),
  })
}

function recordNavigation(url: string): void {
  // Independent of templatization: a path with no id-shaped segment still
  // carries positional evidence.
  recordPathShape(url)

  const resolved = resolveTemplate(url)
  if (!resolved) return
  const { result, copyCorrelated, sourceHost } = resolved
  const slotKind = result.slotKinds[result.slotKinds.length - 1]
  // Cross-context only: same-site copy→navigate has no disambiguating signal
  // (see NavigationRecord.sourceHost) and stays in the plain D pool instead.
  const scoped = copyCorrelated && sourceHost && sourceHost !== result.host
  void putNavigation({
    template: result.template,
    slotHash: saltedHash(result.slots.join('|')),
    slotKind,
    ts: Date.now(),
    sourceHost: scoped ? sourceHost : undefined,
  })
  // Shape-only diagnostics — never the raw URL/value.
  trackPerf(TelemetryEvents.learningNavObserve, { host: result.host, slotKind, copyCorrelated, scoped: Boolean(scoped) })
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
    setCurrentSourceHost(currentActiveHost)
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

  const recallIntervalId = window.setInterval(
    () => void refreshHistoryRecallCache(),
    HISTORY_RECALL_REFRESH_MS,
  )
  void refreshHistoryRecallCache()

  return () => {
    stopped = true
    started = false
    currentActiveHost = null
    setCurrentSourceHost(null)
    recentHistoryEntries = []
    window.clearInterval(intervalId)
    window.clearInterval(recallIntervalId)
  }
}
