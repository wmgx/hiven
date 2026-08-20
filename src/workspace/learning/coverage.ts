/**
 * Self-learning · capability coverage registry (novelty guard, generic).
 *
 * The learner must only propose NET-NEW patterns — never re-surface something an
 * existing capability already handles (the user's hand-coded web-open rules, a
 * plugin that already opens that shape). Capabilities register a coverage test
 * here (via the plugin SDK). Before proposing a scenario-D url-template the
 * learner probes with several representative tokens *and the target host*, so a
 * rule is only suppressed when an existing capability truly covers that shape at
 * that destination — not merely because a token looks similar.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §4.5 / §6.
 */

/** What the learner would fire: a representative token headed to a host. */
export interface CoverageProbe {
  token: string
  host: string
  slotKind: string
}

/** Returns true if this capability would already act on the probe. */
export type CoverageProvider = (probe: CoverageProbe) => boolean

const providers = new Map<string, CoverageProvider>()

/** Register (or replace) a capability's coverage test. Fail-soft on throw. */
export function registerCoverageProvider(id: string, provider: CoverageProvider): void {
  const key = id.trim()
  if (!key || typeof provider !== 'function') return
  providers.set(key, provider)
}

export function unregisterCoverageProvider(id: string): void {
  providers.delete(id.trim())
}

function isProbeCovered(probe: CoverageProbe): boolean {
  for (const provider of providers.values()) {
    try {
      if (provider(probe)) return true
    } catch {
      // A broken provider must never break proposal computation.
    }
  }
  return false
}

/**
 * True if an existing capability covers this shape+host. Probes several samples
 * and requires a majority — one unlucky sample can't wrongly suppress, and one
 * lucky sample can't wrongly pass.
 */
export function isShapeCovered(probes: readonly CoverageProbe[]): boolean {
  if (probes.length === 0) return false
  let covered = 0
  for (const probe of probes) {
    if (isProbeCovered(probe)) covered += 1
  }
  return covered * 2 > probes.length
}

/**
 * Representative concrete tokens for a discovered slot kind (novelty probing).
 *
 * Every token here MUST classify back to its own kind (see the contract test in
 * scripts/test-learning-urltemplate.mjs) — otherwise the guard probes with the
 * wrong shape and asks capabilities a question about a token the rule would
 * never actually fire on.
 */
export function representativeTokens(slotKind: string): string[] {
  switch (slotKind) {
    case 'n':
      return ['42', '12345', '900719925']
    case 'hex':
      return ['a1b2c3d4', 'deadbeef1234', '0f1e2d3c4b5a']
    case 'uuid':
      return [
        '550e8400-e29b-41d4-a716-446655440000',
        '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      ]
    case 'id':
      return ['orderXYZ12345', 'sessKQW98120x', 'itemLMN45678z']
    case 'slug':
      return ['claude-code', 'my-doc-slug', 'user_profile']
    default:
      // No representative sample → probe nothing rather than probe the wrong
      // shape. isShapeCovered([]) is false, so the proposal is allowed through
      // and judged on its own evidence instead of a bogus coverage answer.
      return []
  }
}
