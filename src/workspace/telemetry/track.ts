/**
 * Product telemetry — user behavior + latencies on top of always-on NDJSON.
 *
 * Sink: same file as launcher perf (`~/.local/hiven/logs/launcher-perf.ndjson`)
 * via {@link logLauncherPerf}. Agents: `npm run perf:launcher` / `npm run telemetry`.
 */

import {
  getCurrentLauncherPerfOpenId,
  launcherPerfNow,
  logLauncherPerf,
  logLauncherPerfDuration,
  measureLauncherPerf,
} from '../launcher/perf'
import type { TelemetryKind } from './events'

export type TrackProps = Record<string, unknown>

function withKind(kind: TelemetryKind, props?: TrackProps): TrackProps {
  return { kind, ...props }
}

/** User / product action (no duration). */
export function trackBehavior(name: string, props?: TrackProps): void {
  logLauncherPerf(name, withKind('behavior', props))
}

/** Timed work already measured. */
export function trackLatency(name: string, durationMs: number, props?: TrackProps): void {
  logLauncherPerf(name, withKind('latency', { durationMs, ...props }))
}

/** Mark start → end for a latency span. */
export function trackLatencyFrom(
  name: string,
  startedAt: number,
  props?: TrackProps,
): void {
  logLauncherPerfDuration(name, startedAt, withKind('latency', props))
}

/** Internal perf (ranking, debounce, native) — same sink, kind=perf. */
export function trackPerf(name: string, props?: TrackProps): void {
  logLauncherPerf(name, withKind('perf', props))
}

export async function measureLatency<T>(
  name: string,
  run: () => Promise<T> | T,
  props?: TrackProps | ((value: T) => TrackProps),
): Promise<T> {
  return measureLauncherPerf(
    name,
    run,
    (value) => {
      const extra = typeof props === 'function' ? props(value) : props
      return withKind('latency', extra)
    },
  )
}

export function measureLatencySync<T>(
  name: string,
  run: () => T,
  props?: TrackProps | ((value: T) => TrackProps),
): T {
  const startedAt = launcherPerfNow()
  try {
    const value = run()
    const extra = typeof props === 'function' ? props(value) : props
    trackLatencyFrom(name, startedAt, extra)
    return value
  } catch (error) {
    trackLatencyFrom(name, startedAt, {
      failed: true,
      message: error instanceof Error ? error.message : String(error),
    })
    throw error
  }
}

/** Safe query props — never dump huge clipboard/query bodies into logs. */
export function queryTelemetryProps(query: string | undefined | null): TrackProps {
  const q = query ?? ''
  return {
    queryLength: q.length,
    queryEmpty: !q.trim(),
    // Short preview for diagnosis only (local always-on log).
    queryPreview: q.trim().slice(0, 32),
  }
}

export function itemTelemetryProps(item: {
  systemKey?: string
  kind?: string
  pluginId?: string
  behavior?: { type?: string }
  display?: { title?: string }
}): TrackProps {
  return {
    systemKey: item.systemKey,
    itemKind: item.kind,
    pluginId: item.pluginId,
    behaviorType: item.behavior?.type,
    titlePreview: item.display?.title?.slice(0, 48),
  }
}

export function telemetryNow(): number {
  return launcherPerfNow()
}

export function telemetryOpenId(): string | null {
  return getCurrentLauncherPerfOpenId()
}

/** Debounced tracker for high-frequency signals (typing). */
export function createDebouncedTracker(
  name: string,
  debounceMs: number,
  kind: TelemetryKind = 'behavior',
): (props?: TrackProps) => void {
  let timer: number | null = null
  let lastProps: TrackProps | undefined
  return (props?: TrackProps) => {
    lastProps = props
    if (timer != null) window.clearTimeout(timer)
    timer = window.setTimeout(() => {
      timer = null
      logLauncherPerf(name, withKind(kind, lastProps))
    }, debounceMs)
  }
}
