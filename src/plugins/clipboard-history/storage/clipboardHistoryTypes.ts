/**
 * Clipboard History Plugin — Data Model Types
 */

// ─── History Item Types ──────────────────────────────────────────────────────

export type ClipboardHistoryBase = {
  id: string
  kind: 'text' | 'image' | 'files'
  hash: string
  firstCopiedAt: number
  lastCopiedAt: number
  copyCount: number
  byteSize: number
  sourceApp?: string
}

export type ClipboardTextHistoryItem = ClipboardHistoryBase & {
  kind: 'text'
  text: string
  preview: string
}

export type ClipboardImageHistoryItem = ClipboardHistoryBase & {
  kind: 'image'
  blobId: string
  previewBlobId: string
  contentType: string
  width?: number
  height?: number
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
  firstCopiedAt?: number
  copyCount?: number
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
  maxItems?: number
  retentionDays?: number
  maxTotalCacheBytes?: number
}

export type PruneResult = {
  removedCount: number
  removedBytes: number
  removedBlobIds: string[]
}
