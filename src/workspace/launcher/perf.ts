const LAUNCHER_PERF_STORAGE_KEY = 'hiven:launcher-perf'
const LAUNCHER_PERF_PREFIX = '[hiven:launcher-perf]'
/** Samples slower than this (ms) are flagged `slow: true` for quick scanning. */
const SLOW_MS = 50
/** Hard jank threshold — usually user-visible stutter. */
const JANK_MS = 120
const RING_CAPACITY = 300

export type LauncherPerfSample = {
  t: number
  label: string
  durationMs?: number
  slow?: boolean
  jank?: boolean
  details?: Record<string, unknown>
}

const ring: LauncherPerfSample[] = []
let sampleSeq = 0

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

/** Force console/native logging on for the current page session (ring always records). */
export function enableLauncherPerfLogging(): void {
  try {
    window.localStorage.setItem(LAUNCHER_PERF_STORAGE_KEY, '1')
  } catch {
    // ignore
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

function pushRing(sample: LauncherPerfSample): void {
  ring.push(sample)
  if (ring.length > RING_CAPACITY) {
    ring.splice(0, ring.length - RING_CAPACITY)
  }
}

export function launcherPerfNow(): number {
  return performance.now()
}

export function logLauncherPerf(label: string, details?: Record<string, unknown>): void {
  const durationMs =
    details && typeof details.durationMs === 'number' ? details.durationMs : undefined
  const sample: LauncherPerfSample = {
    t: Date.now(),
    label,
    durationMs,
    slow: durationMs != null ? durationMs >= SLOW_MS : undefined,
    jank: durationMs != null ? durationMs >= JANK_MS : undefined,
    details,
  }
  // Always keep ring samples for post-hoc diagnosis (even when console is off).
  pushRing(sample)
  sampleSeq += 1

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
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10
  logLauncherPerf(label, {
    durationMs,
    ...(durationMs >= JANK_MS ? { jank: true } : durationMs >= SLOW_MS ? { slow: true } : {}),
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

export function getLauncherPerfRing(): readonly LauncherPerfSample[] {
  return ring.slice()
}

export function clearLauncherPerfRing(): void {
  ring.length = 0
}

export type LauncherPerfSummary = {
  total: number
  slow: LauncherPerfSample[]
  jank: LauncherPerfSample[]
  byLabel: Array<{ label: string; count: number; maxMs: number; avgMs: number; sumMs: number }>
}

/** Aggregate ring samples for diagnosis (slow/jank + per-label stats). */
export function summarizeLauncherPerfRing(minMs = 0): LauncherPerfSummary {
  const samples = ring.filter((s) => (s.durationMs ?? 0) >= minMs)
  const slow = samples.filter((s) => (s.durationMs ?? 0) >= SLOW_MS)
  const jank = samples.filter((s) => (s.durationMs ?? 0) >= JANK_MS)
  const map = new Map<string, { count: number; maxMs: number; sumMs: number }>()
  for (const s of samples) {
    if (s.durationMs == null) continue
    const cur = map.get(s.label) ?? { count: 0, maxMs: 0, sumMs: 0 }
    cur.count += 1
    cur.maxMs = Math.max(cur.maxMs, s.durationMs)
    cur.sumMs += s.durationMs
    map.set(s.label, cur)
  }
  const byLabel = [...map.entries()]
    .map(([label, v]) => ({
      label,
      count: v.count,
      maxMs: Math.round(v.maxMs * 10) / 10,
      avgMs: Math.round((v.sumMs / v.count) * 10) / 10,
      sumMs: Math.round(v.sumMs * 10) / 10,
    }))
    .sort((a, b) => b.maxMs - a.maxMs)
  return { total: samples.length, slow, jank, byLabel }
}

export function dumpLauncherPerfRing(): string {
  const summary = summarizeLauncherPerfRing()
  const lines = [
    `launcher-perf samples=${summary.total} slow(>=${SLOW_MS}ms)=${summary.slow.length} jank(>=${JANK_MS}ms)=${summary.jank.length}`,
    '--- by label (maxMs desc) ---',
    ...summary.byLabel.map(
      (r) => `${r.label} count=${r.count} max=${r.maxMs}ms avg=${r.avgMs}ms sum=${r.sumMs}ms`,
    ),
    '--- jank samples ---',
    ...summary.jank.slice(-40).map((s) => {
      const d = s.details ? ` ${JSON.stringify(s.details)}` : ''
      return `${s.label} ${s.durationMs}ms${d}`
    }),
  ]
  const text = lines.join('\n')
  if (isLauncherPerfEnabled()) {
    console.info(LAUNCHER_PERF_PREFIX, 'dump\n' + text)
  }
  return text
}

declare global {
  interface Window {
    __hivenLauncherPerf?: {
      enable: () => void
      dump: () => string
      summary: () => LauncherPerfSummary
      ring: () => readonly LauncherPerfSample[]
      clear: () => void
    }
  }
}

/** Expose diagnosis helpers on window for DevTools. */
export function installLauncherPerfDebugApi(): void {
  if (typeof window === 'undefined') return
  window.__hivenLauncherPerf = {
    enable: enableLauncherPerfLogging,
    dump: dumpLauncherPerfRing,
    summary: () => summarizeLauncherPerfRing(),
    ring: () => getLauncherPerfRing(),
    clear: clearLauncherPerfRing,
  }
}
