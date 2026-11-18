/**
 * Clipboard History Plugin — Data Model Types
 */

export const CLIPBOARD_IMAGE_OCR_VERSION = 2

// ─── History Item Types ──────────────────────────────────────────────────────

export type FavoriteField = { name: string; value: string }

export type ClipboardHistoryBase = {
  id: string
  kind: 'text' | 'image' | 'files'
  hash: string
  firstCopiedAt: number
  lastCopiedAt: number
  copyCount: number
  byteSize: number
  sourceApp?: string
  deletedAt?: number
  purgeAfter?: number
  legacyProtected?: boolean
  /** Successful paste-to-foreground count (not the same as copyCount). */
  pasteCount?: number
  lastPastedAt?: number
  isFavorite?: boolean
  /** User title for favorites; empty falls back to preview. */
  favoriteTitle?: string
  favoriteFields?: FavoriteField[]
  favoritedAt?: number
}

export type ClipboardTextHistoryItem = ClipboardHistoryBase & {
  kind: 'text'
  text: string
  preview: string
}

export type ClipboardImageOcrLine = {
  text: string
  x: number
  y: number
  width: number
  height: number
}

export type ClipboardImageHistoryItem = ClipboardHistoryBase & {
  kind: 'image'
  blobId: string
  previewBlobId: string
  contentType: string
  width?: number
  height?: number
  ocrText?: string
  ocrLines?: ClipboardImageOcrLine[]
  ocrVersion?: number
}

export type ClipboardFilesHistoryItem = ClipboardHistoryBase & {
  kind: 'files'
  paths: string[]
  fileNames: string[]
  missingCount?: number
}

export type ClipboardHistoryItem =
  | ClipboardTextHistoryItem
  | ClipboardImageHistoryItem
  | ClipboardFilesHistoryItem

// ─── Index Types ─────────────────────────────────────────────────────────────

/** Lightweight index entry for fast listing without loading full item data */
export type ClipboardHistoryIndexEntry = {
  id: string
  kind: 'text' | 'image' | 'files'
  hash: string
  lastCopiedAt: number
  byteSize: number
  // ── List display fields (avoid per-item IPC) ──
  preview?: string
  sourceApp?: string
  contentType?: string
  width?: number
  height?: number
  fileNames?: string[]
  previewBlobId?: string
  ocrText?: string
  ocrVersion?: number
  firstCopiedAt?: number
  copyCount?: number
  pasteCount?: number
  lastPastedAt?: number
  isFavorite?: boolean
  favoriteTitle?: string
  favoriteFields?: FavoriteField[]
  favoriteFieldsText?: string
  favoritedAt?: number
}

export type ClipboardHistoryIndex = {
  entries: ClipboardHistoryIndexEntry[]
  updatedAt: number
}

// ─── Add Item Input Types ────────────────────────────────────────────────────

export type AddTextItemInput = {
  kind: 'text'
  text: string
  byteSize: number
  hash: string
  sourceApp?: string
}

export type AddImageItemInput = {
  kind: 'image'
  blobId: string
  previewBlobId: string
  contentType: string
  byteSize: number
  width?: number
  height?: number
  hash: string
  sourceApp?: string
}

export type AddFilesItemInput = {
  kind: 'files'
  paths: string[]
  fileNames: string[]
  byteSize: number
  hash: string
  sourceApp?: string
}

export type AddItemInput = AddTextItemInput | AddImageItemInput | AddFilesItemInput

// ─── Prune Policy ────────────────────────────────────────────────────────────

export type ClipboardHistoryPrunePolicy = {
  retentionMonths?: number
  maxItems?: number
  retentionDays?: number
  maxTotalCacheBytes?: number
}

export type PruneResult = {
  hasMore?: boolean
  removedCount: number
  removedBytes: number
  removedBlobIds: string[]
}
