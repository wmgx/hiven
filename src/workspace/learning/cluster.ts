/**
 * Self-learning · clustering + conservative induction (P2a, generic — pure).
 *
 * Turns the P1 timeline of verified pairs into *rule candidates*: group pairs by
 * "same input shape × same transform", require enough independent evidence, then
 * induce a conservative matcher from the stored feature signature. Because raw
 * text is never persisted (privacy red-line), the matcher is feature-signature
 * based — NOT a regex grown from content — which is exactly the "don't over-fit,
 * don't over-generalize" stance in §4.5.
 *
 * Pure: only `import type` (erased at runtime); no store/registry/framework, no
 * side effects. The orchestrator (P2b) fetches pairs + event-sig counts and feeds
 * them here; proposal UI (P2c) renders the survivors.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §4.4 / §4.5 / §8 (P2).
 */

import type { LearnedPair, RuleMatcher, RuleTransform } from './store'

/** @deprecated use RuleTransform from store. Kept as an alias for existing imports. */
export type CandidateTransform = RuleTransform

export interface RuleCandidate {
  /** Stable key: matcher sig + transform signature. Identifies the cluster. */
  clusterKey: string
  matcher: RuleMatcher
  transform: RuleTransform
  /** Total verified pairs (or navigation visits) in the cluster. */
  sampleCount: number
  /** Distinct inputs (by salted hash) — thin evidence guard. */
  distinctInputs: number
  firstTs: number
  lastTs: number
}

export interface ClusterOptions {
  /** Minimum verified pairs before a cluster is a candidate. Default 3. */
  minSamples?: number
  /**
   * Minimum *distinct* inputs — one blob transformed repeatedly is not evidence
   * of a general rule. Default 2. (Pairs lacking a hash each count as distinct.)
   */
  minDistinctInputs?: number
}

const DEFAULT_MIN_SAMPLES = 3
const DEFAULT_MIN_DISTINCT = 2

/** Runtime transform signature (also the cluster-key discriminator). */
function transformSignature(pair: LearnedPair): string | null {
  if (pair.kind === 'transform' && pair.toolId) return `tool:${pair.toolId}`
  if (pair.kind === 'chain' && pair.toolIds && pair.toolIds.length >= 2) {
    return `chain:${pair.toolIds.join('>')}`
  }
  // content-url pairs need template merging — handled in a later slice (A/D).
  return null
}

function transformFromSignature(sig: string): CandidateTransform | null {
  if (sig.startsWith('tool:')) return { kind: 'tool', toolId: sig.slice('tool:'.length) }
  if (sig.startsWith('chain:')) {
    const toolIds = sig.slice('chain:'.length).split('>').filter(Boolean)
    return toolIds.length >= 2 ? { kind: 'chain', toolIds } : null
  }
  return null
}

function distinctInputCount(pairs: LearnedPair[]): number {
  const defined = new Set<string>()
  let missing = 0
  for (const p of pairs) {
    if (p.inHash) defined.add(p.inHash)
    else missing += 1
  }
  // Missing hashes can't be de-duped — count each as its own distinct input.
  return defined.size + missing
}

/**
 * Group verified pairs into candidates meeting the evidence thresholds.
 * Deterministic order: strongest evidence first, then most recent.
 */
export function clusterPairs(pairs: readonly LearnedPair[], opts: ClusterOptions = {}): RuleCandidate[] {
  const minSamples = opts.minSamples ?? DEFAULT_MIN_SAMPLES
  const minDistinct = opts.minDistinctInputs ?? DEFAULT_MIN_DISTINCT

  const groups = new Map<string, LearnedPair[]>()
  for (const pair of pairs) {
    if (!pair.inSig) continue
    const tSig = transformSignature(pair)
    if (!tSig) continue
    const key = `${pair.inSig}#${tSig}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(pair)
    else groups.set(key, [pair])
  }

  const candidates: RuleCandidate[] = []
  for (const [clusterKey, bucket] of groups) {
    if (bucket.length < minSamples) continue
    const distinctInputs = distinctInputCount(bucket)
    if (distinctInputs < minDistinct) continue
    const [sig, tSig] = clusterKey.split('#', 2)
    const transform = transformFromSignature(tSig)
    if (!transform) continue
    let firstTs = Infinity
    let lastTs = -Infinity
    for (const p of bucket) {
      if (p.ts < firstTs) firstTs = p.ts
      if (p.ts > lastTs) lastTs = p.ts
    }
    candidates.push({
      clusterKey,
      matcher: { kind: 'feature-sig', sig },
      transform,
      sampleCount: bucket.length,
      distinctInputs,
      firstTs,
      lastTs,
    })
  }

  candidates.sort((a, b) => {
    if (b.distinctInputs !== a.distinctInputs) return b.distinctInputs - a.distinctInputs
    if (b.sampleCount !== a.sampleCount) return b.sampleCount - a.sampleCount
    return b.lastTs - a.lastTs
  })
  return candidates
}

export interface OverBroadOptions {
  /**
   * Reject if the pair rate (cluster samples ÷ recent events sharing the sig) is
   * below this — i.e. most times you produce this input shape you do NOT run the
   * transform, so a rule would over-fire. Default 0.5.
   */
  minPairRate?: number
  /** Ignore the check until at least this many events share the sig. Default 1. */
  minMatchingEvents?: number
}

const DEFAULT_MIN_PAIR_RATE = 0.5

/**
 * A feature-sig matcher is over-broad when its sig shows up constantly but rarely
 * leads to the transform — applying the rule would fire on inputs the user didn't
 * want transformed. `matchingEventCount` = recent events whose featureSig === sig.
 */
export function isOverBroad(
  input: { sampleCount: number; matchingEventCount: number },
  opts: OverBroadOptions = {},
): boolean {
  const minPairRate = opts.minPairRate ?? DEFAULT_MIN_PAIR_RATE
  const minMatching = opts.minMatchingEvents ?? 1
  const { sampleCount, matchingEventCount } = input
  if (matchingEventCount < minMatching) return false
  // sampleCount can exceed matchingEventCount (bounded event window / pruning) —
  // clamp so a truncated denominator never spuriously rejects a strong cluster.
  const denom = Math.max(matchingEventCount, sampleCount)
  return sampleCount / denom < minPairRate
}

/**
 * End-to-end selection: cluster, then drop over-broad candidates using recent
 * per-sig event counts. Returns proposal-ready candidates, strongest first.
 */
export function selectProposableCandidates(
  pairs: readonly LearnedPair[],
  eventSigCounts: Record<string, number>,
  clusterOpts: ClusterOptions = {},
  overBroadOpts: OverBroadOptions = {},
): RuleCandidate[] {
  return clusterPairs(pairs, clusterOpts).filter((c) => {
    // clusterPairs only ever emits feature-sig matchers; the guard narrows the union.
    const sig = c.matcher.kind === 'feature-sig' ? c.matcher.sig : ''
    return !isOverBroad(
      { sampleCount: c.sampleCount, matchingEventCount: eventSigCounts[sig] ?? 0 },
      overBroadOpts,
    )
  })
}
