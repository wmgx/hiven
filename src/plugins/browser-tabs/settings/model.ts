export type BrowserTabsSettings = {
  /** When true, register browser.chromium DesktopTargetProvider with the host. */
  enabled: boolean
}

export const DEFAULT_BROWSER_TABS_SETTINGS: BrowserTabsSettings = {
  enabled: true,
}
