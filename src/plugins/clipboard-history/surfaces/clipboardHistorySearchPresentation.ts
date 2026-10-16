export type ClipboardHistorySearchLoadState = 'idle' | 'loading' | 'error'

export type ClipboardHistorySearchPresentationInput = {
  desiredKey: string
  appliedKey?: string
  loadState: ClipboardHistorySearchLoadState
}

export function getClipboardHistorySearchDebounceMs(
  lastSettledCriteriaKey: string | undefined,
  lastRequestedCriteriaKey: string | undefined,
  requestedCriteriaKey: string,
) {
  if (
    lastRequestedCriteriaKey === undefined
    || lastRequestedCriteriaKey === requestedCriteriaKey
    || lastSettledCriteriaKey === requestedCriteriaKey
  ) return 0
  return 120
}

/**
 * Settled results stay readable while the next criteria are debounced or read.
 * Actions only belong to the visible rows when their applied criteria still
 * match the controls and no replacement read is in flight.
 */
export function getClipboardHistorySearchPresentation({
  desiredKey,
  appliedKey,
  loadState,
}: ClipboardHistorySearchPresentationInput) {
  const hasAppliedResults = appliedKey !== undefined
  const stale = hasAppliedResults && appliedKey !== desiredKey
  const pending = loadState === 'loading'

  return {
    hasAppliedResults,
    stale,
    pending,
    showInitialSkeleton: !hasAppliedResults && pending,
    actionsBlocked: !hasAppliedResults || stale || pending,
  }
}
