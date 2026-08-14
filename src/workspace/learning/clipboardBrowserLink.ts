/**
 * Self-learning · clipboard ↔ browser linkage (scenario L, pure — no imports).
 *
 * The clipboard is the wire between two locations. Scenario A only learned the
 * wire's END (copy a token → open a URL containing it). This module learns the
 * wire's ROUTE and uses the clipboard as a key into what you've already seen:
 *
 *   L1/L2  source-scoped copy→navigate: stamp WHERE you copied from (active tab
 *          host) onto the pair, so the same token shape copied on different sites
 *          induces DIFFERENT destinations (hex on grafana → panel; hex on code →
 *          commit). Source host is the disambiguator at fire time.
 *   L3     clipboard→history recall: a copied token that appears in a page you
 *          already visited → "reopen the page you saw" (no template needed).
 *
 * Pure and framework-free (headless-testable, boundary-safe). URL templating and
 * token classification are INJECTED so this never duplicates urlTemplate.ts /
 * features.ts — the sensor passes the real implementations; tests pass stubs.
 * The novelty guard (don't re-learn coded capabilities) runs later, at proposal
 * time in the controller — this layer only induces candidates.
 */

/** A copy→navigate observation: token copied while on `sourceHost`, then `visitedUrl` opened. */
export interface CopyNavigatePair {
  token: string
  /** Active tab host when the token was copied; '' when unknown (still usable, just unscoped). */
  sourceHost: string
  visitedUrl: string
}

/** Injected templatizer — real impl is urlTemplate.templatizeUrlWithToken. */
export type TemplatizeWithToken = (
  url: string,
  token: string,
) => { template: string; slots: string[]; slotKinds: string[]; host: string } | null

/** Injected classifier — real impl is features.classifyToken (hex / number / uuid / …). */
export type ClassifyShape = (token: string) => string

/** A source-scoped url-template learned from repeated copy→navigate routes. */
export interface SourceScopedTemplateCandidate {
  /** Where you were when you copied (''=unscoped). Disambiguates same-shape tokens. */
  sourceHost: string
  /** Destination template with a capture slot, e.g. code.byted.org/{repo}/commit/{hex}. */
  template: string
  /** Destination host (where the token lands). */
  destinationHost: string
  /** Token shape the matcher keys on (hex / number / uuid / …). */
  tokenShape: string
  /** Kind of the captured slot. */
  slotKind: string
  /** Distinct tokens that produced this exact route — clustering support. */
  support: number
}

const KEY_SEP = ' '

/**
 * Induce source-scoped copy→navigate templates. Groups pairs by
 * (sourceHost, tokenShape, destination template); a group with ≥ `minSupport`
 * DISTINCT tokens becomes a candidate. Same shape from different source hosts
 * yields separate candidates (that is the L2 disambiguation).
 */
export function induceSourceScopedTemplates(
  pairs: readonly CopyNavigatePair[],
  templatize: TemplatizeWithToken,
  classifyShape: ClassifyShape,
  minSupport = 2,
): SourceScopedTemplateCandidate[] {
  type Group = {
    sourceHost: string
    template: string
    destinationHost: string
    tokenShape: string
    slotKind: string
    tokens: Set<string>
  }
  const groups = new Map<string, Group>()

  for (const pair of pairs) {
    const token = pair.token?.trim()
    if (!token) continue
    const templated = templatize(pair.visitedUrl, token)
    if (!templated || templated.slots.length === 0) continue
    const tokenShape = classifyShape(token)
    const slotKind = templated.slotKinds[templated.slotKinds.length - 1] ?? tokenShape
    const sourceHost = pair.sourceHost || ''
    const key = `${sourceHost}${KEY_SEP}${tokenShape}${KEY_SEP}${templated.template}`
    const existing = groups.get(key)
    if (existing) {
      existing.tokens.add(token)
    } else {
      groups.set(key, {
        sourceHost,
        template: templated.template,
        destinationHost: templated.host,
        tokenShape,
        slotKind,
        tokens: new Set([token]),
      })
    }
  }

  const candidates: SourceScopedTemplateCandidate[] = []
  for (const group of groups.values()) {
    if (group.tokens.size < minSupport) continue
    candidates.push({
      sourceHost: group.sourceHost,
      template: group.template,
      destinationHost: group.destinationHost,
      tokenShape: group.tokenShape,
      slotKind: group.slotKind,
      support: group.tokens.size,
    })
  }
  // Strongest routes first; stable enough for proposal ordering.
  candidates.sort((a, b) => b.support - a.support)
  return candidates
}

/** A page you already visited that the copied token points at. */
export interface HistoryRecallHit {
  url: string
  title: string
}

/** History entry shape (subset of the bridge history DTO). */
export interface HistoryEntryLike {
  url: string
  title?: string | null
}

/**
 * True when `token` appears in `url` as a WHOLE path segment or query value —
 * a bounded match, not a random substring, so "12" doesn't recall every page
 * whose id merely contains 12.
 */
export function urlContainsToken(url: string, token: string): boolean {
  const needle = token.trim()
  if (!needle) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  for (const segment of parsed.pathname.split('/')) {
    if (decodeSafe(segment) === needle) return true
  }
  for (const value of parsed.searchParams.values()) {
    if (value === needle) return true
  }
  return false
}

function decodeSafe(s: string): string {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

/**
 * Recall pages already visited that the copied token identifies (scenario L3).
 * Deduplicates by url, newest-first order preserved from the caller, capped.
 */
export function findHistoryRecall(
  token: string,
  history: readonly HistoryEntryLike[],
  limit = 5,
): HistoryRecallHit[] {
  const needle = token?.trim()
  if (!needle) return []
  const hits: HistoryRecallHit[] = []
  const seen = new Set<string>()
  for (const entry of history) {
    if (!entry?.url || seen.has(entry.url)) continue
    if (!urlContainsToken(entry.url, needle)) continue
    seen.add(entry.url)
    hits.push({ url: entry.url, title: entry.title || entry.url })
    if (hits.length >= limit) break
  }
  return hits
}
