/**
 * Self-learning · learned-rule sinks (generic).
 *
 * The mirror image of coverage.ts:
 *   coverage — a plugin says "I already handle this shape, don't learn it"
 *   sink     — a plugin says "if you DO learn this shape, give it to me"
 *
 * Why: a learned url-template ("type an MR number → open that MR") and a rule
 * the user wrote by hand for the same site are the same object with two
 * different owners. Keeping the learner's copy in its own private store means
 * the user ends up with two lists doing one job, and the learned one can only be
 * deleted, never corrected. Handing the rule to whoever already owns that
 * concept keeps one list, editable in the place the user already knows.
 *
 * Boundary: the offer is purely structural (template string + slot kind). This
 * module knows nothing about how a claiming plugin stores, renders or matches
 * the rule — that translation happens on the plugin side, which is exactly where
 * the product semantics belong (see CLAUDE.md). A contract test greps this file
 * for plugin vocabulary, so keep it free of it.
 */

/** A rule the learner is about to store, offered to plugins first. */
export interface LearnedRuleOffer {
  kind: 'url-template'
  /** host + path with the variable segment as a slot, e.g. `x.org/mr/{n}`. No scheme. */
  template: string
  /** Shape of token that fills the slot — see urlTemplate.UrlSlotKind. */
  slotKind: string
  /** Stable identity of the originating cluster (dedup / suppression). */
  clusterKey: string
  evidence: {
    sampleCount: number
    distinctInputs: number
  }
}

/**
 * Return true to CLAIM the rule: the host will not keep its own copy, and the
 * claiming plugin becomes responsible for storing and firing it.
 */
export type LearnedRuleSink = (offer: LearnedRuleOffer) => boolean | Promise<boolean>

const sinks = new Map<string, LearnedRuleSink>()

/** Register (or replace) a plugin's sink. Fail-soft on bad input. */
export function registerLearnedRuleSink(id: string, sink: LearnedRuleSink): void {
  const key = id.trim()
  if (!key || typeof sink !== 'function') return
  sinks.set(key, sink)
}

export function unregisterLearnedRuleSink(id: string): void {
  sinks.delete(id.trim())
}

/** Registered sink ids, in registration order (diagnostics). */
export function listLearnedRuleSinks(): string[] {
  return [...sinks.keys()]
}

/**
 * Offer a rule to each sink in registration order; the first to claim it wins.
 * Returns the claiming sink's id, or null if nobody wanted it (the caller then
 * stores it itself).
 *
 * A sink that throws or hangs must never cost the user a learned rule, so
 * failures are swallowed and treated as "not claimed".
 */
export async function offerLearnedRule(offer: LearnedRuleOffer): Promise<string | null> {
  for (const [id, sink] of sinks) {
    try {
      if (await sink(offer)) return id
    } catch {
      // A broken sink must not block other sinks or lose the rule.
    }
  }
  return null
}
