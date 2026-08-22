/**
 * Self-learning · passive observer (P1b, generic — no product semantics).
 *
 * Subscribes to the existing background clipboard change stream (no new
 * polling), records shape-only events, and — once pure-transform runners are
 * installed (next slice: registry adapter) — verifies content→content pairs by
 * re-running candidate transforms. Secrets are skipped and break the chain.
 *
 * Raw clipboard text lives only in a short in-memory window for verification;
 * it is never persisted (the store keeps features + salted hash only).
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §12.1 / §12.4.
 */

import { detectClipboardType, subscribeClipboardChange } from '../../launcher/clipboard/clipboardSnapshot'
import { TelemetryEvents, trackBehavior, trackLatency, trackPerf, telemetryNow } from '../telemetry'
import { extractFeatures, featureSignature, isPlausibleToken, normalizeToken } from './features'
import { verifyTransformChain, verifyTransformPair, type PureTransformRunner } from './pairing'
import { putEvent, putPair, pruneOldEvents, saltedHash } from './store'

/** How many recent clipboard texts to keep in memory for pair/chain verification. */
const TIMELINE_MAX = 6

const recentTexts: string[] = []
/** Parallel to recentTexts (same push/shift points) — '' when unknown. */
const recentSourceHosts: string[] = []
let runners: readonly PureTransformRunner[] = []

/**
 * Host active when the clipboard last changed (pushed by navigationSensor,
 * which owns "current active host" — see its getCurrentActiveHost). Read at
 * the moment a new clipboard text is recorded, so each entry in recentTexts
 * gets tagged with wherever the user was when THAT copy happened.
 */
let currentSourceHost: string | null = null

/** Install pure-transform runners (built from the registry by the adapter slice).
 * Empty until then — pairing simply produces nothing.
 */
export function setPureTransformRunners(next: readonly PureTransformRunner[]): void {
  runners = next
}

/** Update "where the user is right now" — call on every active-host change. */
export function setCurrentSourceHost(host: string | null): void {
  currentSourceHost = host
}

/**
 * Recent copied values that look like tokens (single-line, bounded) — the
 * navigation sensor pairs these against subsequently-visited URLs (scenario A).
 * In-memory only; never persisted.
 */
export function getRecentClipboardTokens(): string[] {
  const seen = new Set<string>()
  for (let i = recentTexts.length - 1; i >= 0; i -= 1) {
    const token = normalizeToken(recentTexts[i])
    if (token && isPlausibleToken(token) && !seen.has(token)) seen.add(token)
  }
  return [...seen]
}

/**
 * Same as {@link getRecentClipboardTokens}, but paired with the host that was
 * active when each token was copied (scenario L1/L2 disambiguation). Empty
 * string when unknown — never a rejected/absent case, just "no signal".
 */
export function getRecentClipboardTokensWithSource(): Array<{ token: string; sourceHost: string }> {
  const seen = new Set<string>()
  const out: Array<{ token: string; sourceHost: string }> = []
  for (let i = recentTexts.length - 1; i >= 0; i -= 1) {
    const token = normalizeToken(recentTexts[i])
    if (token && isPlausibleToken(token) && !seen.has(token)) {
      seen.add(token)
      out.push({ token, sourceHost: recentSourceHosts[i] ?? '' })
    }
  }
  return out
}

function isSecretType(type: string): boolean {
  return type === 'secret' || type === 'secret-like'
}

function handleClipboardText(text: string): void {
  if (!text.trim()) return

  const detectedType = detectClipboardType(text)
  if (isSecretType(detectedType)) {
    // Never learn secrets; also do not chain a transform across a secret.
    trackPerf(TelemetryEvents.learningSecretSkip, { detectedType })
    recentTexts.length = 0
    recentSourceHosts.length = 0
    return
  }

  const features = extractFeatures(text)
  const featureSig = featureSignature(features)
  void putEvent({ ts: Date.now(), featureSig, detectedType, saltedHash: saltedHash(text) })
  // Shape-only diagnostics — never the raw text.
  trackPerf(TelemetryEvents.learningObserve, { detectedType, featureSig, len: features.len })

  const previous = recentTexts[recentTexts.length - 1]
  if (previous && previous !== text && runners.length > 0) {
    const startedAt = telemetryNow()
    const hit = verifyTransformPair(previous, text, runners)
    trackLatency(TelemetryEvents.learningVerifyLatency, telemetryNow() - startedAt, {
      runnersTried: runners.length,
      matched: Boolean(hit),
    })
    if (hit) {
      const inSig = featureSignature(extractFeatures(previous))
      void putPair({ ts: Date.now(), kind: 'transform', inSig, toolId: hit.toolId, inHash: saltedHash(previous) })
      trackBehavior(TelemetryEvents.learningPairVerified, { toolId: hit.toolId, kind: 'transform', inSig })
    } else {
      trackPerf(TelemetryEvents.learningPairMiss, { runnersTried: runners.length, inType: detectedType })
    }
  }

  // Chain detection (scenario B): the last three distinct texts A→B→C reproduced
  // by a ≥2-step pure-transform chain → a collapsible workflow.
  const b = recentTexts[recentTexts.length - 1]
  const a = recentTexts[recentTexts.length - 2]
  if (a && b && a !== b && b !== text && runners.length > 0) {
    const chain = verifyTransformChain([a, b, text], runners)
    if (chain && chain.toolIds.length >= 2) {
      const inSig = featureSignature(extractFeatures(a))
      void putPair({ ts: Date.now(), kind: 'chain', inSig, toolIds: chain.toolIds, inHash: saltedHash(a) })
      trackBehavior(TelemetryEvents.learningPairVerified, { kind: 'chain', inSig, steps: chain.toolIds.length })
    }
  }

  recentTexts.push(text)
  recentSourceHosts.push(currentSourceHost ?? '')
  if (recentTexts.length > TIMELINE_MAX) recentTexts.shift()
  if (recentSourceHosts.length > TIMELINE_MAX) recentSourceHosts.shift()
}

let started = false

/** Start passive observation. Idempotent; returns a stop function. */
export function startLearningObserver(): () => void {
  if (started) return () => undefined
  started = true
  void pruneOldEvents()
  const unsubscribe = subscribeClipboardChange((text) => {
    try {
      handleClipboardText(text)
    } catch {
      // Isolate learning from the clipboard tracker loop.
    }
  })
  return () => {
    started = false
    recentTexts.length = 0
    recentSourceHosts.length = 0
    unsubscribe()
  }
}
