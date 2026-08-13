/**
 * Self-learning · proposal shaping (P2b, generic — pure).
 *
 * Turns a survived RuleCandidate into (a) a locale-agnostic descriptor the UI
 * renders via i18n — we never persist a rendered human string, so a rule reads
 * correctly whatever locale it's later viewed in — and (b) a persistable
 * LearnedRule. Also decides which candidates are actually proposable right now
 * (drop already-learned + user-rejected clusters, cap concurrent proposals).
 *
 * Pure: only `import type` (erased at runtime); no store/registry/framework, no
 * side effects. The controller (impure) does the IndexedDB IO and calls these.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §4.3 / §8 (P2).
 */

import type { RuleCandidate } from './cluster'
import type { DiscoveredTemplate } from './urlTemplate'
import type { LearnedRule, RuleDescriptor } from './store'

/**
 * Parse a candidate's matcher into structured pieces so the UI can render it via
 * locale. feature-sig → charset/length/flags; token → the slot kind as charset.
 */
export function describeCandidate(candidate: RuleCandidate): RuleDescriptor {
  if (candidate.matcher.kind === 'token') {
    return { charset: candidate.matcher.tokenKind, lenBucket: '', flags: [], transform: candidate.transform }
  }
  const parts = candidate.matcher.sig.split('|')
  let charset = 'mixed'
  let lenBucket = 'm'
  const flags: string[] = []
  for (const part of parts) {
    if (part.startsWith('cs:')) charset = part.slice('cs:'.length)
    else if (part.startsWith('len:')) lenBucket = part.slice('len:'.length)
    else if (part) flags.push(part)
  }
  return { charset, lenBucket, flags, transform: candidate.transform }
}

/** Convert a discovered URL template (scenario D) into a proposal candidate. */
export function templateToCandidate(discovered: DiscoveredTemplate): RuleCandidate {
  return {
    clusterKey: `url:${discovered.template}`,
    matcher: { kind: 'token', tokenKind: discovered.slotKind },
    transform: { kind: 'url-template', template: discovered.template, slotKind: discovered.slotKind },
    sampleCount: discovered.visits,
    distinctInputs: discovered.distinctValues,
    firstTs: discovered.firstTs,
    lastTs: discovered.lastTs,
  }
}

/** Denormalized matcher sig used as the fire-path index key. */
function matcherSigOf(candidate: RuleCandidate): string {
  return candidate.matcher.kind === 'token' ? `token:${candidate.matcher.tokenKind}` : candidate.matcher.sig
}

/** Mint a persistable rule from a candidate (strength seeded from evidence). */
export function ruleFromCandidate(candidate: RuleCandidate, now: number = Date.now()): LearnedRule {
  return {
    clusterKey: candidate.clusterKey,
    matcherSig: matcherSigOf(candidate),
    matcher: candidate.matcher,
    transform: candidate.transform,
    descriptor: describeCandidate(candidate),
    // Seed frecency from independent evidence so a well-supported rule starts
    // ahead; P3 feedback moves it from here.
    strength: candidate.distinctInputs,
    origin: 'learned',
    createdAt: now,
    sampleCount: candidate.sampleCount,
  }
}

export interface ProposalFilterState {
  /** clusterKeys already turned into rules (don't re-propose). */
  learnedKeys?: Iterable<string>
  /** clusterKeys the user rejected (never propose again). */
  suppressedKeys?: Iterable<string>
  /** Max proposals to surface at once. Default 1 (design §8: don't nag). */
  maxConcurrent?: number
}

/**
 * Keep only candidates worth proposing now: not already learned, not suppressed,
 * capped at `maxConcurrent`. Input order (strongest-first from clustering) is
 * preserved, so the cap keeps the best candidate.
 */
export function filterProposableCandidates(
  candidates: readonly RuleCandidate[],
  state: ProposalFilterState = {},
): RuleCandidate[] {
  const learned = new Set(state.learnedKeys ?? [])
  const suppressed = new Set(state.suppressedKeys ?? [])
  const max = state.maxConcurrent ?? 1
  const out: RuleCandidate[] = []
  for (const c of candidates) {
    if (learned.has(c.clusterKey) || suppressed.has(c.clusterKey)) continue
    out.push(c)
    if (out.length >= max) break
  }
  return out
}
