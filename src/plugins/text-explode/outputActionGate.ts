export type ExplodeOutput = { text: string; revision: number }

/** Coordinates the surface's non-cancellable native outputs and launcher handoff. */
export function createExplodeOutputGate() {
  let revision = 0
  let pending: ExplodeOutput | null = null
  let controller: AbortController | null = null
  let handedOffRevision: number | null = null

  return {
    getRevision: () => revision,
    invalidate: () => { controller?.abort(); return ++revision },
    signal: (output: ExplodeOutput) => pending === output ? controller?.signal : undefined,
    isCurrent: (output: ExplodeOutput) => output.revision === revision,
    begin(output: ExplodeOutput) {
      if (!output.text || output.revision !== revision || pending || handedOffRevision === revision) return false
      pending = output
      controller = new AbortController()
      return true
    },
    finish(output: ExplodeOutput, handedOff = false) {
      if (pending !== output) return
      pending = null
      controller = null
      if (handedOff && output.revision === revision) handedOffRevision = revision
    },
  }
}

/** Consume the host receipt without spending the selection on failed or stale delivery. */
export async function settleExplodeHandoff(
  output: ExplodeOutput,
  gate: ReturnType<typeof createExplodeOutputGate>,
  send: (signal: AbortSignal) => void | Promise<boolean>,
  isActive: () => boolean,
): Promise<'accepted' | 'failed' | 'stale'> {
  const signal = gate.signal(output)
  const current = () => isActive() && gate.isCurrent(output) && Boolean(signal) && !signal!.aborted
  let accepted = false
  try {
    if (!current()) return 'stale'
    const receipt = await send(signal!)
    if (!current()) return 'stale'
    accepted = receipt === true
    return accepted ? 'accepted' : 'failed'
  } catch {
    return current() ? 'failed' : 'stale'
  } finally {
    gate.finish(output, accepted)
  }
}
