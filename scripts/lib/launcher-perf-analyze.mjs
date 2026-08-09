/**
 * Pure analyzer for ~/.local/hiven/logs/launcher-perf.ndjson
 * Used by `npm run perf:launcher` and tests. No I/O.
 */

/** @typedef {{
 *   ts: number,
 *   source?: string,
 *   label: string,
 *   durationMs?: number | null,
 *   slow?: boolean,
 *   jank?: boolean,
 *   openId?: string | null,
 *   details?: Record<string, unknown> | null,
 *   detail?: string,
 * }} PerfRow */

export const SLOW_MS = 50
export const JANK_MS = 120

/**
 * @param {string} text
 * @returns {PerfRow[]}
 */
export function parseLauncherPerfNdjson(text) {
  const rows = []
  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const o = JSON.parse(trimmed)
      if (!o || typeof o !== 'object') continue
      const label = o.label ?? o.details?.label
      if (typeof label !== 'string') continue
      const openId =
        typeof o.openId === 'string'
          ? o.openId
          : typeof o.details?.openId === 'string'
            ? o.details.openId
            : null
      const kindRaw = o.kind ?? o.details?.kind
      const kind =
        kindRaw === 'behavior' || kindRaw === 'latency' || kindRaw === 'perf'
          ? kindRaw
          : label.startsWith('behavior:')
            ? 'behavior'
            : label.startsWith('latency:')
              ? 'latency'
              : typeof o.durationMs === 'number' || typeof o.details?.durationMs === 'number'
                ? 'latency'
                : 'perf'
      rows.push({
        ts: typeof o.ts === 'number' ? o.ts : 0,
        source: o.source,
        kind,
        label,
        durationMs:
          typeof o.durationMs === 'number'
            ? o.durationMs
            : typeof o.details?.durationMs === 'number'
              ? o.details.durationMs
              : null,
        slow: Boolean(o.slow ?? o.details?.slow),
        jank: Boolean(o.jank ?? o.details?.jank),
        openId,
        details: o.details ?? null,
        detail: typeof o.detail === 'string' ? o.detail : undefined,
      })
    } catch {
      // skip corrupt lines
    }
  }
  return rows
}

/**
 * Group rows into open sessions.
 * Prefer openId; fall back to time-window heuristics for pre-openId logs.
 * Unscoped native rows within 2s before a session start are attached to it
 * (native cannot know frontend openId yet).
 *
 * @param {PerfRow[]} rows
 * @returns {Array<{
 *   openId: string,
 *   startTs: number,
 *   endTs: number,
 *   rows: PerfRow[],
 *   metrics: {
 *     firstPaintMs: number | null,
 *     storeOpenMs: number | null,
 *     rehydrateMs: number | null,
 *     rehydrateSkipped: boolean,
 *     nativeMainMs: number | null,
 *     nativeEventGapMs: number | null,
 *     clipboardReadMs: number | null,
 *     rankItemCount: number,
 *     sampleCount: number,
 *     jankLabels: string[],
 *     slowLabels: string[],
 *     sessionDurationMs: number | null,
 *   },
 *   verdict: 'ok' | 'slow' | 'jank' | 'unknown',
 * }>}
 */
export function groupLauncherPerfSessions(rows) {
  /** @type {Map<string, PerfRow[]>} */
  const byOpenId = new Map()
  /** @type {PerfRow[]} */
  const unscoped = []

  for (const row of rows) {
    if (row.openId) {
      const list = byOpenId.get(row.openId) ?? []
      list.push(row)
      byOpenId.set(row.openId, list)
    } else {
      unscoped.push(row)
    }
  }

  // Attach unscoped native/near-open samples to the nearest openId session
  // when they fall in [start-2000ms, end+500ms].
  /** @type {Array<{ openId: string, startTs: number, endTs: number, list: PerfRow[] }>} */
  const openBuckets = []
  for (const [openId, list] of byOpenId) {
    list.sort((a, b) => a.ts - b.ts)
    const startTs = list[0]?.ts ?? 0
    const endTs = list[list.length - 1]?.ts ?? startTs
    openBuckets.push({ openId, startTs, endTs, list })
  }
  openBuckets.sort((a, b) => a.startTs - b.startTs)

  /** @type {Set<PerfRow>} */
  const absorbed = new Set()
  if (openBuckets.length > 0 && unscoped.length > 0) {
    for (const row of unscoped) {
      let best = null
      let bestDist = Infinity
      for (const bucket of openBuckets) {
        const windowStart = bucket.startTs - 2000
        const windowEnd = bucket.endTs + 500
        if (row.ts < windowStart || row.ts > windowEnd) continue
        // Prefer samples just before session start (native show path).
        const dist =
          row.ts <= bucket.startTs
            ? bucket.startTs - row.ts
            : row.ts - bucket.startTs
        if (dist < bestDist) {
          bestDist = dist
          best = bucket
        }
      }
      if (best) {
        best.list.push(row)
        absorbed.add(row)
      }
    }
  }

  /** @type {ReturnType<typeof groupLauncherPerfSessions>} */
  const sessions = []

  for (const bucket of openBuckets) {
    bucket.list.sort((a, b) => a.ts - b.ts)
    sessions.push(buildSession(bucket.openId, bucket.list))
  }

  // Legacy: remaining unscoped rows → pseudo-sessions by open markers.
  const leftover = unscoped.filter((r) => !absorbed.has(r))
  if (leftover.length > 0) {
    leftover.sort((a, b) => a.ts - b.ts)
    let current = []
    let pseudo = 0
    const flush = () => {
      if (current.length === 0) return
      sessions.push(buildSession(`legacy_${pseudo++}`, current))
      current = []
    }
    for (const row of leftover) {
      // Start a new bucket when we see store-open / session-start.
      if (
        current.length > 0 &&
        (row.label === 'open:event-to-store-open' || row.label === 'open:session-start')
      ) {
        flush()
      } else if (
        current.length > 0 &&
        row.label === 'native:show-launcher-window-for-hotkey' &&
        row.ts - current[current.length - 1].ts > 2000
      ) {
        flush()
      }
      current.push(row)
      if (row.label === 'open:session-end') flush()
    }
    flush()
  }

  sessions.sort((a, b) => b.startTs - a.startTs)
  return sessions
}

/**
 * @param {string} openId
 * @param {PerfRow[]} list
 */
function buildSession(openId, list) {
  const first = (label) => list.find((r) => r.label === label)
  const all = (label) => list.filter((r) => r.label === label)

  const firstPaint = first('open:event-to-first-paint')
  const storeOpen = first('open:event-to-store-open')
  const rehydrate = first('open:rehydrate')
  const nativeMain = first('native:main-thread-open')
  const nativeHotkey = first('native:show-launcher-window-for-hotkey')
  const clipboard = first('clipboard-object-block:read')
  const sessionEnd = first('open:session-end')
  const sessionStart = first('open:session-start')

  // Event gap: frontend store-open ts − native main-thread-open ts (approx wake lag).
  let nativeEventGapMs = null
  if (nativeMain && storeOpen && storeOpen.ts && nativeMain.ts) {
    nativeEventGapMs = storeOpen.ts - nativeMain.ts
  } else if (nativeHotkey && storeOpen) {
    nativeEventGapMs = storeOpen.ts - nativeHotkey.ts
  }

  const jankLabels = [
    ...new Set(
      list
        .filter((r) => r.jank || (typeof r.durationMs === 'number' && r.durationMs >= JANK_MS && !r.details?.expectedWait))
        .map((r) => r.label),
    ),
  ]
  const slowLabels = [
    ...new Set(
      list
        .filter((r) => r.slow || (typeof r.durationMs === 'number' && r.durationMs >= SLOW_MS && !r.details?.expectedWait))
        .map((r) => r.label),
    ),
  ]

  // Prefer catalog first-paint label; fall back to legacy open:event-to-first-paint.
  const catalogFirstPaint = first('latency:launcher.first_paint')
  const firstPaintMs = catalogFirstPaint?.durationMs ?? firstPaint?.durationMs ?? null

  const behaviors = list
    .filter((r) => r.kind === 'behavior' || r.label.startsWith('behavior:'))
    .map((r) => r.label)
  const latencies = list
    .filter(
      (r) =>
        (r.kind === 'latency' || r.label.startsWith('latency:')) &&
        typeof r.durationMs === 'number',
    )
    .map((r) => ({ label: r.label, durationMs: r.durationMs }))

  const itemExecute = all('latency:launcher.item_execute')
  const itemExecuteMs = itemExecute.map((r) => r.durationMs).filter((n) => typeof n === 'number')
  const maxItemExecuteMs = itemExecuteMs.length ? Math.max(...itemExecuteMs) : null

  let verdict = /** @type {'ok'|'slow'|'jank'|'unknown'} */ ('unknown')
  if (firstPaintMs != null) {
    if (firstPaintMs >= JANK_MS) verdict = 'jank'
    else if (firstPaintMs >= SLOW_MS) verdict = 'slow'
    else verdict = 'ok'
  }

  return {
    openId,
    startTs: sessionStart?.ts ?? list[0]?.ts ?? 0,
    endTs: sessionEnd?.ts ?? list[list.length - 1]?.ts ?? 0,
    rows: list,
    metrics: {
      firstPaintMs,
      storeOpenMs: storeOpen?.durationMs ?? null,
      rehydrateMs: rehydrate?.durationMs ?? null,
      rehydrateSkipped: Boolean(rehydrate?.details?.skipped),
      nativeMainMs: nativeMain?.durationMs ?? null,
      nativeEventGapMs,
      clipboardReadMs: clipboard?.durationMs ?? null,
      rankItemCount: all('session:rank-items').length,
      sampleCount: list.length,
      jankLabels,
      slowLabels,
      sessionDurationMs: sessionEnd?.durationMs ?? null,
      behaviorTrail: behaviors,
      latencyTrail: latencies,
      maxItemExecuteMs,
      closeReason: list.find((r) => r.label === 'behavior:launcher.close')?.details?.reason ?? null,
    },
    verdict,
  }
}

/**
 * @param {ReturnType<typeof groupLauncherPerfSessions>} sessions
 * @param {{ last?: number }} [opts]
 */
export function formatLauncherPerfReport(sessions, opts = {}) {
  const last = opts.last ?? 8
  const slice = sessions.slice(0, last)
  if (slice.length === 0) {
    return 'No launcher open sessions found in log.\n'
  }

  const lines = []
  lines.push(`# Launcher perf report — last ${slice.length} open(s)`)
  lines.push(`# thresholds: slow>=${SLOW_MS}ms  jank>=${JANK_MS}ms`)
  lines.push('')

  // Aggregate first-paint
  const paints = slice.map((s) => s.metrics.firstPaintMs).filter((n) => typeof n === 'number')
  if (paints.length > 0) {
    const sorted = [...paints].sort((a, b) => a - b)
    const p50 = sorted[Math.floor(sorted.length / 2)]
    const p90 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.9))]
    lines.push(
      `first-paint summary (n=${sorted.length}): min=${sorted[0]} p50=${p50} p90=${p90} max=${sorted[sorted.length - 1]} ms`,
    )
    lines.push('')
  }

  for (const s of slice) {
    const m = s.metrics
    const when = s.startTs ? new Date(s.startTs).toISOString() : '?'
    lines.push(`## ${s.openId}  ${when}  [${s.verdict}]`)
    lines.push(
      [
        `  first-paint: ${fmtMs(m.firstPaintMs)}`,
        `store-open: ${fmtMs(m.storeOpenMs)}`,
        `rehydrate: ${fmtMs(m.rehydrateMs)}${m.rehydrateSkipped ? ' (skipped)' : ''}`,
        `native-main: ${fmtMs(m.nativeMainMs)}`,
        `event-gap: ${fmtMs(m.nativeEventGapMs)}`,
        `clipboard: ${fmtMs(m.clipboardReadMs)}`,
      ].join('  '),
    )
    lines.push(
      `  samples=${m.sampleCount}  rank-items×${m.rankItemCount}  session=${fmtMs(m.sessionDurationMs)}  max-execute=${fmtMs(m.maxItemExecuteMs)}  close=${m.closeReason ?? '—'}`,
    )
    if (m.behaviorTrail?.length) {
      lines.push(`  behavior: ${m.behaviorTrail.slice(0, 16).join(' → ')}`)
    }
    if (m.latencyTrail?.length) {
      const topLat = [...m.latencyTrail]
        .sort((a, b) => (b.durationMs ?? 0) - (a.durationMs ?? 0))
        .slice(0, 6)
        .map((r) => `${shortLabel(r.label)}=${fmtMs(r.durationMs)}`)
      lines.push(`  latencies: ${topLat.join('  ')}`)
    }
    if (m.jankLabels.length) {
      lines.push(`  jank: ${m.jankLabels.join(', ')}`)
    } else if (m.slowLabels.length) {
      lines.push(`  slow: ${m.slowLabels.slice(0, 8).join(', ')}`)
    }
    lines.push('')
  }

  // Cross-session behavior funnel (last N)
  const behaviorCounts = new Map()
  for (const s of slice) {
    for (const b of s.metrics.behaviorTrail ?? []) {
      behaviorCounts.set(b, (behaviorCounts.get(b) ?? 0) + 1)
    }
  }
  if (behaviorCounts.size > 0) {
    lines.push('## Behavior counts (last sessions)')
    const ranked = [...behaviorCounts.entries()].sort((a, b) => b[1] - a[1])
    for (const [name, count] of ranked.slice(0, 20)) {
      lines.push(`  ${count.toString().padStart(3)}  ${name}`)
    }
    lines.push('')
  }

  lines.push('## Agent next steps')
  lines.push('- jank first-paint → check remount / rank cascade / rehydrate / native gap')
  lines.push('- high rank-items× → open path setState thrash')
  lines.push('- large event-gap → webview thaw after native show')
  lines.push('- max-execute high → plugin/host execute path slow')
  lines.push('- behavior trail → reconstruct user funnel (open→query→select→execute→close)')
  lines.push('- clipboard high → defer further / cache age tracker')
  lines.push('')
  return lines.join('\n')
}

function shortLabel(label) {
  return String(label)
    .replace(/^latency:/, '')
    .replace(/^behavior:/, '')
    .replace(/^open:/, 'open.')
}

function fmtMs(v) {
  if (v == null || Number.isNaN(v)) return '—'
  return `${Math.round(v * 10) / 10}ms`
}

/**
 * @param {PerfRow[]} rows
 * @param {{ last?: number }} [opts]
 */
export function analyzeLauncherPerfLog(rows, opts = {}) {
  const sessions = groupLauncherPerfSessions(rows)
  return {
    sessions,
    text: formatLauncherPerfReport(sessions, opts),
    json: {
      generatedAt: Date.now(),
      sessionCount: sessions.length,
      last: sessions.slice(0, opts.last ?? 8).map((s) => ({
        openId: s.openId,
        startTs: s.startTs,
        endTs: s.endTs,
        verdict: s.verdict,
        metrics: s.metrics,
      })),
    },
  }
}
