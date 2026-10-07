/**
 * Feature-detected `requestIdleCallback` with a `setTimeout` fallback for
 * engines that lack it (older WebKit). Lets background work (prefetch,
 * periodic maintenance) wait for a natural gap in main-thread activity
 * instead of competing with whatever the user is doing right now.
 *
 * `timeoutMs` bounds the wait so the work still runs under sustained
 * activity — idle callbacks can starve indefinitely otherwise.
 */
export function scheduleIdleWork(run: () => void, timeoutMs: number): () => void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    const handle = window.requestIdleCallback(run, { timeout: timeoutMs })
    return () => {
      window.cancelIdleCallback?.(handle)
    }
  }
  const handle = globalThis.setTimeout(run, timeoutMs)
  return () => globalThis.clearTimeout(handle)
}
