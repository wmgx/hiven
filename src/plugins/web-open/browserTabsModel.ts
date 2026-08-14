export type BrowserTabsSettings = {
  /** When true, register browser.chromium DesktopTargetProvider with the host. */
  enabled: boolean
  /** Push recent browsing history to the host for search + learning. */
  historyEnabled: boolean
  /** Close unused tabs after idleTimeoutMinutes. */
  autoCloseIdleTabs: boolean
  /** Minutes a background tab may stay idle before auto-close. */
  idleTimeoutMinutes: number
}

export const MIN_IDLE_TIMEOUT_MINUTES = 5
export const MAX_IDLE_TIMEOUT_MINUTES = 24 * 60
export const DEFAULT_IDLE_TIMEOUT_MINUTES = 60

export const DEFAULT_BROWSER_TABS_SETTINGS: BrowserTabsSettings = {
  enabled: true,
  historyEnabled: true,
  autoCloseIdleTabs: false,
  idleTimeoutMinutes: DEFAULT_IDLE_TIMEOUT_MINUTES,
}

export function clampIdleTimeoutMinutes(value: unknown): number {
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return DEFAULT_IDLE_TIMEOUT_MINUTES
  return Math.max(MIN_IDLE_TIMEOUT_MINUTES, Math.min(MAX_IDLE_TIMEOUT_MINUTES, Math.round(n)))
}

export function normalizeBrowserTabsSettings(value: Partial<BrowserTabsSettings> | null | undefined): BrowserTabsSettings {
  return {
    enabled: value?.enabled !== false,
    historyEnabled: value?.historyEnabled !== false,
    autoCloseIdleTabs: value?.autoCloseIdleTabs === true,
    idleTimeoutMinutes: clampIdleTimeoutMinutes(value?.idleTimeoutMinutes),
  }
}
