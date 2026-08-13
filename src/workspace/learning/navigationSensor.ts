/**
 * Self-learning · navigation sensor (scenario D, D2 — impure).
 *
 * Passively accumulates the URLs the user visits so the template-induction core
 * can discover "you keep opening X/{id}" patterns. First cut reuses the existing
 * desktop bridge active-tab signal (no extension change): poll the active target,
 * and when its URL changes, templatize it and store the template + a salted hash
 * of the slot value. Raw URLs and raw slot values are never persisted.
 *
 * One cached bridge read per tick (the list call caches ~1.5s); gated to the
 * Tauri runtime; a no-op when no bridge/extension is present.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §11 (D) / §5.
 */

import { listDesktopBridgeTargets } from '../desktopControl/bridgeTargets'
import { TelemetryEvents, trackPerf } from '../telemetry'
import { putNavigation, pruneOldNavigations } from './store'
import { saltedHash } from './store'
import { templatizeUrl } from './urlTemplate'

const POLL_INTERVAL_MS = 3000

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

function recordNavigation(url: string): void {
  const result = templatizeUrl(url)
  // Only templates that carry a variable slot are discovery candidates.
  if (!result || result.slots.length === 0) return
  const slotKind = result.slotKinds[result.slotKinds.length - 1]
  void putNavigation({
    template: result.template,
    slotHash: saltedHash(result.slots.join('|')),
    slotKind,
    ts: Date.now(),
  })
  // Shape-only diagnostics — never the raw URL/value.
  trackPerf(TelemetryEvents.learningNavObserve, { host: result.host, slotKind })
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

  const tick = async () => {
    if (stopped || polling) return
    polling = true
    try {
      const url = await readActiveUrl()
      if (stopped || !url || url === lastUrl) return
      lastUrl = url
      recordNavigation(url)
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
    window.clearInterval(intervalId)
  }
}
