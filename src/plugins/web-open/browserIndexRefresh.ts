/** One background owner, at most one read in flight, and one trailing refresh. */
export function createBrowserIndexRefresh<T>(read: () => Promise<T>, commit: (value: T) => void) {
  let stopped = false
  let generation = 0
  let running = false
  let timer: ReturnType<typeof setTimeout> | undefined
  const schedule = () => {
    if (stopped || running || timer !== undefined) return
    // Bounded coalescing: repeated snapshots must not postpone refresh forever.
    timer = setTimeout(() => { timer = undefined; void flush() }, 50)
  }
  const flush = async () => {
    if (stopped) return
    running = true
    const requested = generation
    try {
      const value = await read()
      if (!stopped && requested === generation) commit(value)
    } catch {
      // Preserve the last usable index. The next source notification can retry.
    } finally {
      running = false
      if (!stopped && requested !== generation) schedule()
    }
  }
  return {
    request() { ++generation; schedule() },
    stop() {
      stopped = true
      ++generation
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
    },
  }
}
