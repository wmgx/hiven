export type ExplodeOutput = { text: string; revision: number }

/** Coordinates the surface's non-cancellable native outputs and launcher handoff. */
export function createExplodeOutputGate() {
  let revision = 0
  let pending: ExplodeOutput | null = null
  let handedOffRevision: number | null = null

  return {
    getRevision: () => revision,
    invalidate: () => ++revision,
    isCurrent: (output: ExplodeOutput) => output.revision === revision,
    begin(output: ExplodeOutput) {
      if (!output.text || output.revision !== revision || pending || handedOffRevision === revision) return false
      pending = output
      return true
    },
    finish(output: ExplodeOutput, handedOff = false) {
      if (pending !== output) return
      pending = null
      if (handedOff && output.revision === revision) handedOffRevision = revision
    },
  }
}
