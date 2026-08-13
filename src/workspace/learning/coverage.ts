/**
 * Self-learning · capability coverage registry (novelty guard, generic).
 *
 * The learner must only propose NET-NEW patterns — never re-surface something an
 * existing capability already handles (the user's hand-coded web-open rules, a
 * plugin that already opens that shape). Capabilities register a coverage test
 * here (via the plugin SDK); before proposing a scenario-D url-template the
 * learner asks "would a representative token already be handled?" and, if so,
 * skips it. Purely a suppression signal — no product semantics of its own.
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §4.5 / §6.
 */

/** Returns true if this capability would already act on the given token. */
export type CoverageProvider = (token: string) => boolean

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

/** True if any registered capability already handles this token. */
export function isTokenCovered(token: string): boolean {
  if (!token) return false
  for (const provider of providers.values()) {
    try {
      if (provider(token)) return true
    } catch {
      // A broken provider must never break proposal computation.
    }
  }
  return false
}

/** A representative concrete token for a discovered slot kind (novelty probing). */
export function representativeToken(slotKind: string): string {
  switch (slotKind) {
    case 'n':
      return '12345'
    case 'hex':
      return 'a1b2c3d4e5f6'
    case 'uuid':
      return '550e8400-e29b-41d4-a716-446655440000'
    case 'id':
      return 'abcd1234efgh'
    default:
      return '12345'
  }
}
