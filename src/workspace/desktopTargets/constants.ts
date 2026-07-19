/** Cap for provider.priority → ranking boost (design §4.2). */
export const PROVIDER_PRIORITY_CAP = 50

/** Soft timeout per provider list() call. */
export const DESKTOP_TARGET_PROVIDER_TIMEOUT_MS = 120

export const DESKTOP_TARGET_MAX_PER_SOURCE = 40
export const DESKTOP_TARGET_MAX_GLOBAL = 80

/** Optional “already open” affinity; keep ≤ 200 per roadmap §6. */
export const DESKTOP_AFFINITY_CAP = 200

/** Strong text-intent demotion for all navigation targets (app/window/tab). */
export const STRONG_TEXT_INTENT_NAV_PENALTY = 2500

export function clampProviderPriority(priority: number | undefined): number {
  if (priority == null || !Number.isFinite(priority)) return 0
  return Math.max(0, Math.min(PROVIDER_PRIORITY_CAP, priority))
}
