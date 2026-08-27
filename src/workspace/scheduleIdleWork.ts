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
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const ric = (
      window as unknown as {
        requestIdleCallback: (cb: () => void, opts?: { timeout: number }) => number
      }
    ).requestIdleCallback
    const handle = ric(run, { timeout: timeoutMs })
    return () => {
      ;(window as unknown as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback?.(handle)
    }
  }
  const handle = window.setTimeout(run, timeoutMs)
  return () => window.clearTimeout(handle)
}
