/**
 * Clipboard History Plugin — Settings Model
 */

export type ClipboardHistorySettings = {
  enabled: boolean
  recordText: boolean
  recordImages: boolean
  recordFiles: boolean
  retentionMonths: number
  /** Legacy settings retained for compatibility only; never cleanup policies. */
  maxItems?: number
  retentionDays?: number
  maxTextBytes: number
  maxImageBytes: number
  maxTotalCacheBytes?: number
  /** Min successful pastes before an item appears in the Frequent tab. */
  frequentPasteThreshold: number
}

export const DEFAULT_CLIPBOARD_HISTORY_SETTINGS: ClipboardHistorySettings = {
  enabled: false,
  recordText: true,
  recordImages: true,
  recordFiles: true,
  retentionMonths: 3,
  maxTextBytes: 256 * 1024,
  maxImageBytes: 10 * 1024 * 1024,
  frequentPasteThreshold: 3,
}

export function resolveClipboardHistoryRetentionMonths(value: unknown): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 12 ? value : 3
}

/** Migrates settings only; never reads, expires or deletes history records. */
export function migrateClipboardHistorySettings(stored: unknown): ClipboardHistorySettings {
  const previous = stored && typeof stored === 'object' && !Array.isArray(stored)
    ? stored as Partial<ClipboardHistorySettings> : {}
  return {
    ...DEFAULT_CLIPBOARD_HISTORY_SETTINGS,
    ...previous,
    retentionMonths: resolveClipboardHistoryRetentionMonths(previous.retentionMonths),
  }
}
