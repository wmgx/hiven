const LAUNCHER_PERF_STORAGE_KEY = 'hiven:launcher-perf'
const LAUNCHER_PERF_PREFIX = '[hiven:launcher-perf]'

export function isLauncherPerfEnabled(): boolean {
  try {
    return window.localStorage.getItem(LAUNCHER_PERF_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function launcherPerfNow(): number {
  return performance.now()
}

export function logLauncherPerf(label: string, details?: Record<string, unknown>): void {
  if (!isLauncherPerfEnabled()) return
  if (details) {
    console.info(LAUNCHER_PERF_PREFIX, label, details)
    return
  }
  console.info(LAUNCHER_PERF_PREFIX, label)
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
