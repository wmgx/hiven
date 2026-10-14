export type HistoryCopySubmission = {
  signal: AbortSignal
  isCurrent(): boolean
  commit(): void
  finish(): void
}

export function createHistoryCopyLifecycle() {
  let active: { controller: AbortController; committed: boolean } | null = null

  const cancel = () => {
    const submission = active
    active = null
    if (submission && !submission.committed) submission.controller.abort()
  }

  const begin = (ownerIsCurrent: () => boolean): HistoryCopySubmission => {
    cancel()
    const submission = { controller: new AbortController(), committed: false }
    active = submission
    const isCurrent = () => active === submission
      && !submission.controller.signal.aborted
      && ownerIsCurrent()

    return {
      signal: submission.controller.signal,
      isCurrent,
      commit: () => {
        if (isCurrent()) submission.committed = true
      },
      finish: () => {
        if (active === submission) active = null
      },
    }
  }

  return { begin, cancel }
}
