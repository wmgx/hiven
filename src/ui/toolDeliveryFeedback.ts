/** A stable host lifetime, independent of host objects rebuilt during render. */
export type ToolDeliveryFeedbackOwner = {
  isCurrent(): boolean
  subscribeInvalidation(listener: () => void): () => void
}

export type ToolDeliveryFeedback = {
  tone: 'info' | 'error'
  message: string
}

type PasteOutcome =
  | { ok: true }
  | { ok: false; fallback: 'copied' | 'none'; message: string }

export type ToolDeliveryFeedbackAttempt = {
  isCurrent(): boolean
  reportPaste(result: PasteOutcome): boolean
  reportError(message: string): boolean
}

type Snapshot = {
  revision: number
  feedback: ToolDeliveryFeedback | null
}

/**
 * Local feedback ownership only: no clipboard, navigation, locks or timers.
 * Result identity must include input and operation revisions, not only output text.
 */
export function createToolDeliveryFeedbackController() {
  let active = false
  let hasContext = false
  let currentResult: unknown
  let currentOwner: ToolDeliveryFeedbackOwner | undefined
  let currentAttempt: symbol | undefined
  let snapshot: Snapshot = { revision: 0, feedback: null }
  const listeners = new Set<() => void>()

  const publish = (next: Snapshot) => {
    snapshot = next
    for (const listener of [...listeners]) listener()
  }
  const invalidate = () => {
    currentAttempt = undefined
    // Even an unchanged result needs a new render before it can be submitted
    // again; retained handlers cannot restart an obsolete input in this gap.
    publish({ revision: snapshot.revision + 1, feedback: null })
  }
  const matches = (result: unknown, owner?: ToolDeliveryFeedbackOwner) => active
    && hasContext && Object.is(currentResult, result) && currentOwner === owner
    && (owner?.isCurrent() ?? true)
  const setFeedback = (feedback: ToolDeliveryFeedback | null) => {
    if (snapshot.feedback === feedback) return
    publish({ ...snapshot, feedback })
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    activate() {
      active = true
    },
    deactivate() {
      active = false
      invalidate()
    },
    setContext(result: unknown, owner?: ToolDeliveryFeedbackOwner) {
      if (hasContext && Object.is(currentResult, result) && currentOwner === owner) return
      hasContext = true
      currentResult = result
      currentOwner = owner
      invalidate()
    },
    matches,
    invalidate,
    beginAttempt(result: unknown, owner: ToolDeliveryFeedbackOwner | undefined, revision: number): ToolDeliveryFeedbackAttempt {
      const token = Symbol('tool-delivery')
      const eligible = matches(result, owner) && snapshot.revision === revision
      if (eligible) {
        currentAttempt = token
        setFeedback(null)
      }
      const isCurrent = () => eligible && currentAttempt === token
        && snapshot.revision === revision && matches(result, owner)
      let reported = false
      const report = (feedback: ToolDeliveryFeedback | null) => {
        if (reported || !isCurrent()) return false
        reported = true
        setFeedback(feedback)
        return true
      }
      return {
        isCurrent,
        reportPaste: (outcome) => {
          if (outcome.ok || !outcome.message) return report(null)
          return report({ tone: outcome.fallback === 'copied' ? 'info' : 'error', message: outcome.message })
        },
        reportError: (message) => report(message ? { tone: 'error', message } : null),
      }
    },
  }
}
