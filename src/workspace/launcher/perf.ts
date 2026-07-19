const LAUNCHER_PERF_STORAGE_KEY = 'hiven:launcher-perf'
const LAUNCHER_PERF_PREFIX = '[hiven:launcher-perf]'

export function isLauncherPerfEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(LAUNCHER_PERF_STORAGE_KEY)
    if (stored === '0') return false
    if (stored === '1') return true
    // Dev builds default on so perf lines reach native stderr without devtools.
    return import.meta.env.DEV
  } catch {
    return false
  }
}

type InvokeFn = (cmd: string, args?: Record<string, unknown>) => Promise<unknown>
let nativeInvoke: InvokeFn | null = null
let nativeInvokeLoading = false

/** Fire-and-forget mirror of perf lines into native stderr (dev diagnosis). */
function forwardLauncherPerfLine(line: string): void {
  if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
  if (nativeInvoke) {
    void nativeInvoke('log_launcher_perf_frontend', { line }).catch(() => {})
    return
  }
  if (nativeInvokeLoading) return
  nativeInvokeLoading = true
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => {
      nativeInvoke = invoke as InvokeFn
      void invoke('log_launcher_perf_frontend', { line }).catch(() => {})
    })
    .catch(() => {})
}

export function launcherPerfNow(): number {
  return performance.now()
}

export function logLauncherPerf(label: string, details?: Record<string, unknown>): void {
  if (!isLauncherPerfEnabled()) return
  if (details) {
    console.info(LAUNCHER_PERF_PREFIX, label, details)
    forwardLauncherPerfLine(`${label} ${JSON.stringify(details)}`)
    return
  }
  console.info(LAUNCHER_PERF_PREFIX, label)
  forwardLauncherPerfLine(label)
}

export function logLauncherPerfDuration(
  label: string,
  startedAt: number,
  details?: Record<string, unknown>,
): void {
  if (!isLauncherPerfEnabled()) return
  logLauncherPerf(label, {
    durationMs: Math.round((performance.now() - startedAt) * 10) / 10,
    ...details,
  })
}

export function measureLauncherPerfSync<T>(
  label: string,
  run: () => T,
  details?: (value: T) => Record<string, unknown>,
): T {
  const startedAt = launcherPerfNow()
  let value: T | undefined
  let hasValue = false
  try {
    value = run()
    hasValue = true
    return value
  } finally {
    logLauncherPerfDuration(label, startedAt, hasValue ? details?.(value as T) : undefined)
  }
}

export async function measureLauncherPerf<T>(
  label: string,
  run: () => Promise<T> | T,
  details?: (value: T) => Record<string, unknown>,
): Promise<T> {
  const startedAt = launcherPerfNow()
  try {
    const value = await run()
    logLauncherPerfDuration(label, startedAt, details?.(value))
    return value
  } catch (error) {
    logLauncherPerfDuration(label, startedAt, {
      failed: true,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}
