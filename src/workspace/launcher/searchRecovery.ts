export type LauncherSearchRecovery = { failed: boolean; pending: boolean; retry: () => void }

/** Per-attempt aggregation only; successful providers cannot erase another failure. */
export function createSearchAttempt(isCurrent: () => boolean, publish: (failed: boolean, pending: boolean) => void, retrying = false) {
  const failures = new Set<string>()
  let active = true
  const current = () => active && isCurrent()
  return {
    report(provider: string, failed: boolean) {
      if (!current()) return
      if (failed) failures.add(provider)
      else failures.delete(provider)
      publish(retrying || failures.size > 0, true)
    },
    finish(failed = false) {
      if (!current()) return
      if (failed) failures.add('collection')
      publish(failures.size > 0, false)
      active = false
    },
    cancel() { active = false },
  }
}
