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
import { extractFeatures, featureSignature } from './features'
import { verifyTransformPair, type PureTransformRunner } from './pairing'
import { putEvent, putPair, pruneOldEvents, saltedHash } from './store'

/** How many recent clipboard texts to keep in memory for pair/chain verification. */
const TIMELINE_MAX = 6

const recentTexts: string[] = []
let runners: readonly PureTransformRunner[] = []

/**
 * Install pure-transform runners (built from the registry by the adapter slice).
 * Empty until then — pairing simply produces nothing.
 */
export function setPureTransformRunners(next: readonly PureTransformRunner[]): void {
  runners = next
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
      void putPair({ ts: Date.now(), kind: 'transform', inSig, toolId: hit.toolId })
      trackBehavior(TelemetryEvents.learningPairVerified, { toolId: hit.toolId, kind: 'transform', inSig })
    } else {
      trackPerf(TelemetryEvents.learningPairMiss, { runnersTried: runners.length, inType: detectedType })
    }
  }

  recentTexts.push(text)
  if (recentTexts.length > TIMELINE_MAX) recentTexts.shift()
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
    unsubscribe()
  }
}
