const LAUNCHER_PERF_STORAGE_KEY = 'hiven:launcher-perf'
const LAUNCHER_PERF_PREFIX = '[hiven:launcher-perf]'
/** Samples slower than this (ms) are flagged `slow: true` for quick scanning. */
const SLOW_MS = 50
/** Hard jank threshold — usually user-visible stutter. */
const JANK_MS = 120
const RING_CAPACITY = 300
/** Always-on diagnosis log on disk (native append). */
export const LAUNCHER_PERF_LOG_HINT = '~/.local/hiven/logs/launcher-perf.ndjson'

export type TelemetrySampleKind = 'behavior' | 'latency' | 'perf'

export type LauncherPerfSample = {
  t: number
  label: string
  durationMs?: number
  slow?: boolean
  jank?: boolean
  /** Correlates all samples for one hotkey-open → close lifecycle. */
  openId?: string
  /**
   * Sample class for Agent reports:
   * - behavior: user intent / product action
   * - latency: timed user-visible or execute path
   * - perf: internal diagnostics (rank, debounce, native)
   */
  kind?: TelemetrySampleKind
  details?: Record<string, unknown>
}

const ring: LauncherPerfSample[] = []

/** Active open session id (null while launcher is closed). */
let currentOpenId: string | null = null
let openSessionStartedAt: number | null = null

function nextOpenId(): string {
  return `o_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`
}

/**
 * Mark the start of a launcher open (hotkey / event). All subsequent samples
 * until {@link endLauncherPerfOpenSession} carry the same `openId` so agents
 * can group NDJSON lines into one open.
 */
export function beginLauncherPerfOpenSession(details?: Record<string, unknown>): string {
  // React StrictMode double-invokes mount effects in dev — keep one openId.
  if (
    currentOpenId &&
    openSessionStartedAt != null &&
    launcherPerfNow() - openSessionStartedAt < 80
  ) {
    return currentOpenId
  }
  // Nested begin (rapid re-open after a real close): close the previous session first.
  if (currentOpenId) {
    endLauncherPerfOpenSession({ reason: 'superseded' })
  }
  currentOpenId = nextOpenId()
  openSessionStartedAt = launcherPerfNow()
  logLauncherPerf('open:session-start', {
    openId: currentOpenId,
    ...details,
  })
  return currentOpenId
}

/** End the current open session (launcher closed / superseded). */
export function endLauncherPerfOpenSession(details?: Record<string, unknown>): void {
  if (!currentOpenId) return
  const openId = currentOpenId
  const startedAt = openSessionStartedAt
  currentOpenId = null
  openSessionStartedAt = null
  logLauncherPerf('open:session-end', {
    openId,
    ...(startedAt != null
      ? { durationMs: Math.round((performance.now() - startedAt) * 10) / 10 }
      : {}),
    ...details,
  })
}

export function getCurrentLauncherPerfOpenId(): string | null {
  return currentOpenId
}

export function isLauncherPerfEnabled(): boolean {
  try {
    const stored = window.localStorage.getItem(LAUNCHER_PERF_STORAGE_KEY)
    if (stored === '0') return false
    if (stored === '1') return true
    // Dev builds default on so perf lines reach console without extra setup.
    return import.meta.env.DEV
  } catch {
    return false
  }
}

/** Force console logging on for the current page session. File logging is always on. */
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
let cachedLogPath: string | null = null

function ensureNativeInvoke(): void {
  if (nativeInvoke || nativeInvokeLoading) return
  if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
  nativeInvokeLoading = true
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => {
      nativeInvoke = invoke as InvokeFn
      nativeInvokeLoading = false
      void invoke<string>('launcher_perf_log_file')
        .then((path) => {
          cachedLogPath = path
        })
        .catch(() => {})
    })
    .catch(() => {
      nativeInvokeLoading = false
    })
}

/**
 * Always append sample to ~/.local/hiven/logs/launcher-perf.ndjson via native.
 * Console output remains gated by isLauncherPerfEnabled().
 *
 * NDJSON schema (agent-facing):
 * `{ ts, source, kind, label, durationMs, slow, jank, openId?, details? }`
 */
function forwardLauncherPerfSample(sample: LauncherPerfSample): void {
  if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return
  const payload = JSON.stringify({
    ts: sample.t,
    source: 'frontend',
    kind: sample.kind ?? 'perf',
    label: sample.label,
    durationMs: sample.durationMs ?? null,
    slow: sample.slow ?? false,
    jank: sample.jank ?? false,
    openId: sample.openId ?? null,
    details: sample.details ?? null,
  })
  if (nativeInvoke) {
    void nativeInvoke('log_launcher_perf_frontend', { line: payload }).catch(() => {})
    return
  }
  ensureNativeInvoke()
  // Retry once invoke is loaded (drop if still cold — next sample will hit).
  void import('@tauri-apps/api/core')
    .then(({ invoke }) => {
      nativeInvoke = invoke as InvokeFn
      void invoke('log_launcher_perf_frontend', { line: payload }).catch(() => {})
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

function resolveSampleKind(details?: Record<string, unknown>): TelemetrySampleKind {
  const k = details?.kind
  if (k === 'behavior' || k === 'latency' || k === 'perf') return k
  // Heuristic for legacy labels without explicit kind.
  if (typeof details?.durationMs === 'number') return 'latency'
  if (typeof details?.label === 'string' && String(details.label).startsWith('behavior:')) return 'behavior'
  if (labelLooksLikeBehavior(String(details?.event ?? ''))) return 'behavior'
  return 'perf'
}

function labelLooksLikeBehavior(label: string): boolean {
  return label.startsWith('behavior:')
}

export function logLauncherPerf(label: string, details?: Record<string, unknown>): void {
  const durationMs =
    details && typeof details.durationMs === 'number' ? details.durationMs : undefined
  // Prefer explicit openId in details (session-start/end); else current session.
  const detailOpenId =
    details && typeof details.openId === 'string' ? details.openId : undefined
  const openId = detailOpenId ?? currentOpenId ?? undefined
  // expectedWait: intentional debounce — not user jank.
  const expectedWait = details?.expectedWait === true
  const kind: TelemetrySampleKind =
    label.startsWith('behavior:')
      ? 'behavior'
      : label.startsWith('latency:')
        ? 'latency'
        : resolveSampleKind(details)
  const sample: LauncherPerfSample = {
    t: Date.now(),
    label,
    durationMs,
    openId,
    kind,
    slow:
      durationMs != null && !expectedWait && kind !== 'behavior'
        ? durationMs >= SLOW_MS
        : undefined,
    jank:
      durationMs != null && !expectedWait && kind !== 'behavior'
        ? durationMs >= JANK_MS
        : undefined,
    details,
  }
  // Always: ring + file. Console only when enabled.
  pushRing(sample)
  forwardLauncherPerfSample(sample)

  if (!isLauncherPerfEnabled()) return
  if (details) {
    console.info(LAUNCHER_PERF_PREFIX, label, { openId, ...details })
    return
  }
  console.info(LAUNCHER_PERF_PREFIX, label, openId ? { openId } : undefined)
}

export function logLauncherPerfDuration(
  label: string,
  startedAt: number,
  details?: Record<string, unknown>,
): void {
  const durationMs = Math.round((performance.now() - startedAt) * 10) / 10
  // slow/jank flags are derived inside logLauncherPerf (respects expectedWait).
  logLauncherPerf(label, {
    durationMs,
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
  logPathHint: string
  logPath?: string | null
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
  return {
    total: samples.length,
    slow,
    jank,
    byLabel,
    logPathHint: LAUNCHER_PERF_LOG_HINT,
    logPath: cachedLogPath,
  }
}

export function dumpLauncherPerfRing(): string {
  const summary = summarizeLauncherPerfRing()
  const lines = [
    `launcher-perf samples=${summary.total} slow(>=${SLOW_MS}ms)=${summary.slow.length} jank(>=${JANK_MS}ms)=${summary.jank.length}`,
    `logFile=${summary.logPath ?? summary.logPathHint}`,
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

export async function resolveLauncherPerfLogPath(): Promise<string | null> {
  if (cachedLogPath) return cachedLogPath
  if (!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) return null
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const path = await invoke<string>('launcher_perf_log_file')
    cachedLogPath = path
    return path
  } catch {
    return null
  }
}

/** Last N open sessions from the in-memory ring (agent / DevTools). */
export function listLauncherPerfOpenSessionsFromRing(limit = 10): Array<{
  openId: string
  startedAt: number
  endedAt?: number
  firstPaintMs?: number
  storeOpenMs?: number
  rehydrateMs?: number
  sampleCount: number
  jankCount: number
  rankItemCount: number
}> {
  const byId = new Map<string, LauncherPerfSample[]>()
  for (const s of ring) {
    if (!s.openId) continue
    const list = byId.get(s.openId) ?? []
    list.push(s)
    byId.set(s.openId, list)
  }
  const sessions = [...byId.entries()].map(([openId, samples]) => {
    const started = samples.find((s) => s.label === 'open:session-start')
    const ended = samples.find((s) => s.label === 'open:session-end')
    const firstPaint = samples.find((s) => s.label === 'open:event-to-first-paint')
    const storeOpen = samples.find((s) => s.label === 'open:event-to-store-open')
    const rehydrate = samples.find((s) => s.label === 'open:rehydrate')
    return {
      openId,
      startedAt: started?.t ?? samples[0]?.t ?? 0,
      endedAt: ended?.t,
      firstPaintMs: firstPaint?.durationMs,
      storeOpenMs: storeOpen?.durationMs,
      rehydrateMs: rehydrate?.durationMs,
      sampleCount: samples.length,
      jankCount: samples.filter((s) => s.jank).length,
      rankItemCount: samples.filter((s) => s.label === 'session:rank-items').length,
    }
  })
  sessions.sort((a, b) => b.startedAt - a.startedAt)
  return sessions.slice(0, Math.max(1, limit))
}

declare global {
  interface Window {
    __hivenLauncherPerf?: {
      enable: () => void
      dump: () => string
      summary: () => LauncherPerfSummary
      ring: () => readonly LauncherPerfSample[]
      clear: () => void
      logPath: () => Promise<string | null>
      logPathHint: string
      currentOpenId: () => string | null
      opens: (limit?: number) => ReturnType<typeof listLauncherPerfOpenSessionsFromRing>
      beginOpen: typeof beginLauncherPerfOpenSession
      endOpen: typeof endLauncherPerfOpenSession
    }
  }
}

/** Expose diagnosis helpers on window for DevTools / agent CDP. */
export function installLauncherPerfDebugApi(): void {
  if (typeof window === 'undefined') return
  ensureNativeInvoke()
  window.__hivenLauncherPerf = {
    enable: enableLauncherPerfLogging,
    dump: dumpLauncherPerfRing,
    summary: () => summarizeLauncherPerfRing(),
    ring: () => getLauncherPerfRing(),
    clear: clearLauncherPerfRing,
    logPath: () => resolveLauncherPerfLogPath(),
    logPathHint: LAUNCHER_PERF_LOG_HINT,
    currentOpenId: () => getCurrentLauncherPerfOpenId(),
    opens: (limit) => listLauncherPerfOpenSessionsFromRing(limit),
    beginOpen: beginLauncherPerfOpenSession,
    endOpen: endLauncherPerfOpenSession,
  }
}
