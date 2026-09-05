export type BrowserTabsSettings = {
  /** When true, register browser.chromium DesktopTargetProvider with the host. */
  enabled: boolean
  /** Push recent browsing history to the host for search + learning. */
  historyEnabled: boolean
  /** Browser-history age included in Global Launcher search. */
  historySearchDays: 3 | 5 | 7 | 30 | 60 | 90 | 365 | 'all'
  /** Close unused tabs after idleTimeoutMinutes. */
  autoCloseIdleTabs: boolean
  /** Minutes a background tab may stay idle before auto-close. */
  idleTimeoutMinutes: number
}

export const MIN_IDLE_TIMEOUT_MINUTES = 5
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 60
export const HISTORY_SEARCH_DAY_OPTIONS = [3, 5, 7, 30, 60, 90, 365, 'all'] as const

/** Preset idle durations shown in settings, including 3-day and 7-day. */
export const IDLE_TIMEOUT_PRESET_MINUTES = [
  15,
  30,
  60,
  6 * 60,
  12 * 60,
  24 * 60,
  3 * 24 * 60,
  7 * 24 * 60,
] as const

export function idleTimeoutPresetKey(minutes: number): '15m' | '30m' | '1h' | '6h' | '12h' | '1d' | '3d' | '7d' | 'custom' {
  switch (minutes) {
    case 15: return '15m'
    case 30: return '30m'
    case 60: return '1h'
    case 360: return '6h'
    case 720: return '12h'
    case 1440: return '1d'
    case 4320: return '3d'
    case 10080: return '7d'
    default: return 'custom'
  }
}

export const DEFAULT_BROWSER_TABS_SETTINGS: BrowserTabsSettings = {
  enabled: true,
  historyEnabled: true,
  historySearchDays: 5,
  autoCloseIdleTabs: false,
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
}

export function clampIdleTimeoutMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_IDLE_TIMEOUT_MINUTES
  // No product max: 3d/7d (and any later preset) must survive host → bridge → extension sync.
  return Math.max(MIN_IDLE_TIMEOUT_MINUTES, Math.round(n))
}

export function normalizeBrowserTabsSettings(value: Partial<BrowserTabsSettings> | null | undefined): BrowserTabsSettings {
  const historySearchDays = HISTORY_SEARCH_DAY_OPTIONS.includes(value?.historySearchDays as never)
    ? value?.historySearchDays as BrowserTabsSettings['historySearchDays']
    : 5
  return {
    enabled: value?.enabled !== false,
    historyEnabled: value?.historyEnabled !== false,
    historySearchDays,
    autoCloseIdleTabs: value?.autoCloseIdleTabs === true,
    idleTimeoutMinutes: clampIdleTimeoutMinutes(value?.idleTimeoutMinutes),
  }
}
