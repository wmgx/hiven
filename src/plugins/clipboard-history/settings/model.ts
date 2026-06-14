/**
 * Clipboard History Plugin — Settings Model
 */

export type ClipboardHistorySettings = {
  enabled: boolean
  recordText: boolean
  recordImages: boolean
  recordFiles: boolean
  maxItems: number
  retentionDays: number
  maxTextBytes: number
  maxImageBytes: number
  maxTotalCacheBytes: number
  defaultAction: 'paste'
  pasteFailureFallback: 'copy-and-notify'
}

export const DEFAULT_CLIPBOARD_HISTORY_SETTINGS: ClipboardHistorySettings = {
  enabled: false,
  recordText: true,
  recordImages: true,
  recordFiles: true,
  maxItems: 500,
  retentionDays: 30,
  maxTextBytes: 256 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  maxTotalCacheBytes: 500 * 1024 * 1024,
  defaultAction: 'paste',
  pasteFailureFallback: 'copy-and-notify',
}
