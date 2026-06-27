/**
 * Launcher Usage Storage Helpers
 *
 * Usage is recorded only at launcher selection time, scoped by surface and by
 * system launcher item key. These are pure helpers; the store owns persistence.
 *
 * Rules (see design doc §4–6):
 *  - Record on first-level launcher selection only.
 *  - Pinned execution does not write usage.
 *  - Dynamic items do not write long-term usage.
 *  - Execution success/failure does not change usage; usage measures intent.
 */

import type {
  LauncherSurfaceId,
  LauncherUsageBucket,
  LauncherUsageBySurface,
  LauncherUsageRecord,
  SystemLauncherItemKey,
} from './types'
import { LAUNCHER_SURFACE_IDS } from './types'

function normalizeUsageSurfaceId(surfaceId: LauncherSurfaceId): LauncherSurfaceId {
  return surfaceId === 'global-launcher' ? 'global-launcher' : 'editor-command-bar'
}

export function emptyUsageBySurface(): LauncherUsageBySurface {
  return {
    'editor-command-bar': {},
    'global-launcher': {},
  }
}

/**
 * Return a new usage map with the record for (surface, itemKey) incremented.
 * Immutable: does not mutate the input.
 */
export function recordSelection(
  usage: LauncherUsageBySurface,
  surfaceId: LauncherSurfaceId,
  itemKey: SystemLauncherItemKey,
  now: number,
): LauncherUsageBySurface {
  const normalizedSurfaceId = normalizeUsageSurfaceId(surfaceId)
  const bucket = usage[normalizedSurfaceId] ?? {}
  const prev = bucket[itemKey]
  const nextRecord: LauncherUsageRecord = {
    count: (prev?.count ?? 0) + 1,
    lastSelectedAt: now,
  }
  return {
    ...usage,
    [normalizedSurfaceId]: { ...bucket, [itemKey]: nextRecord },
  }
}

export function getUsageRecord(
  usage: LauncherUsageBySurface,
  surfaceId: LauncherSurfaceId,
  itemKey: SystemLauncherItemKey,
): LauncherUsageRecord | undefined {
  const normalizedSurfaceId = normalizeUsageSurfaceId(surfaceId)
  return usage[normalizedSurfaceId]?.[itemKey]
}

export function getUsageBucket(
  usage: LauncherUsageBySurface,
  surfaceId: LauncherSurfaceId,
): LauncherUsageBucket {
  const normalizedSurfaceId = normalizeUsageSurfaceId(surfaceId)
  return usage[normalizedSurfaceId] ?? {}
}

// ─── Legacy Migration ────────────────────────────────────────────────────────

/**
 * Legacy per-surface bucket shape used by the previous action-usage system:
 *   { recentActionNames: string[]; actionUsageCounts: Record<string, number> }
 * keyed by the raw command id (the legacy usage key).
 */
export type LegacyActionUsageBucket = {
  recentActionNames?: string[]
  actionUsageCounts?: Record<string, number>
}

export type LegacyActionUsageBySource = Partial<
  Record<'command-palette' | 'global-launcher' | 'pinned-runner', LegacyActionUsageBucket>
>

/**
 * Migrate a single legacy bucket into the new `{count, lastSelectedAt}` shape.
 * `mapKey` converts a legacy usage key (command id) into the new system item
 * key; returning undefined drops that entry.
 *
 * Recency is approximated from `recentActionNames` order (most recent first):
 * the newest gets the largest synthetic timestamp so ordering is preserved.
 */
export function migrateLegacyBucket(
  legacy: LegacyActionUsageBucket | undefined,
  mapKey: (legacyKey: string) => SystemLauncherItemKey | undefined,
  baseTime: number,
): LauncherUsageBucket {
  const bucket: LauncherUsageBucket = {}
  if (!legacy) return bucket

  const counts = legacy.actionUsageCounts ?? {}
  const recent = legacy.recentActionNames ?? []
  const recentIndex = new Map<string, number>()
  recent.forEach((name, idx) => {
    if (!recentIndex.has(name)) recentIndex.set(name, idx)
  })

  const allLegacyKeys = new Set<string>([...Object.keys(counts), ...recent])
  for (const legacyKey of allLegacyKeys) {
    const itemKey = mapKey(legacyKey)
    if (!itemKey) continue
    const count = counts[legacyKey] ?? (recentIndex.has(legacyKey) ? 1 : 0)
    if (count <= 0 && !recentIndex.has(legacyKey)) continue
    // Newer (lower index) → larger timestamp.
    const idx = recentIndex.get(legacyKey)
    const lastSelectedAt = idx === undefined ? baseTime : baseTime + (recent.length - idx)
    bucket[itemKey] = { count: Math.max(count, 1), lastSelectedAt }
  }
  return bucket
}

/**
 * Migrate the full legacy `actionUsageBySource` into `launcherUsageBySurface`.
 * Only the two launcher surfaces are preserved; `pinned-runner` usage is dropped
 * (pinned execution must not feed launcher usage).
 */
export function migrateLegacyUsage(
  legacy: LegacyActionUsageBySource | undefined,
  mapKey: (legacyKey: string) => SystemLauncherItemKey | undefined,
  baseTime: number,
): LauncherUsageBySurface {
  const result = emptyUsageBySurface()
  if (!legacy) return result
  for (const surfaceId of LAUNCHER_SURFACE_IDS) {
    const legacySource = surfaceId === 'editor-command-bar' ? 'command-palette' : surfaceId
    result[surfaceId] = migrateLegacyBucket(legacy[legacySource], mapKey, baseTime)
  }
  return result
}
