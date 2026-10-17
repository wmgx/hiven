/**
 * Launcher Object Block — The visible object token in launcher/editor command.
 *
 * Step 5 design language: every surface first declares Object, then recommends
 * Action, then resolves Output Target. This model intentionally describes
 * product objects rather than plugin parameters.
 */

import { detectContent } from '../../kits/content/index'
import type { ClipboardDetectedType, ClipboardSnapshot } from './clipboardSnapshot'
import {
  detectClipboardFilePath,
  detectClipboardType,
  fileNameFromPath,
  shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint,
} from './clipboardSnapshot'
import { isStrongClipboardAttachEligible } from './attachPolicy'
import { objectBlockText } from './objectBlockText'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ObjectBlockSource =
  | 'clipboard'
  | 'editor-selection'
  | 'editor-document'
  | 'history-item'
  | 'query'
  | 'snapshot'
  | 'tool-result'

export type ObjectBlockKind =
  | ClipboardDetectedType
  | 'markdown'
  | 'plain-text'
  | 'image'
  | 'files'

export type ObjectBlockValidity = 'valid' | 'invalid' | 'partial' | 'unknown'

export type ObjectBlockState =
  | 'fresh'
  | 'stale'
  | 'unknown-age'
  | 'secret-masked'
  | 'selected-for-deletion'
  | 'invalid'
  | 'snapshot'

export type ObjectBlockMeta = {
  age?: string
  size?: string
  lineCount?: number
  charCount?: number
  paneId?: string
  editorWindowId?: string
  snapshotAt?: number
  contentProvider?: 'live' | 'snapshot'
  /** The payload is already file contents, even when its text looks like another path. */
  textOrigin?: 'file-content'
  fileName?: string
}

export type ObjectBlockImagePayload = {
  blobId: string
  contentType: string
  width?: number
  height?: number
}

export type ObjectBlockFilesPayload = {
  paths: string[]
  fileNames: string[]
}

export type LauncherObjectBlock = {
  id: string
  source: ObjectBlockSource
  kind: ObjectBlockKind
  title: string
  subtitle?: string
  /** UI preview — first 120 chars, undefined if secret-masked. Do NOT use for action execution. */
  preview?: string
  /** Full text payload for action execution. Not exposed to UI. */
  payloadText?: string
  /** Image payload for history-item / future non-text objects. */
  payloadImage?: ObjectBlockImagePayload
  /** File-path payload for history-item / future non-text objects. */
  payloadFiles?: ObjectBlockFilesPayload
  ageLabel?: string
  createdAt: number
  removable: boolean
  selectedForDelete?: boolean
  secretMasked?: boolean
  validity: ObjectBlockValidity
  state?: ObjectBlockState
  meta?: ObjectBlockMeta
}

/** Raw object text may feed recommendations unless the block masks a secret. */
export function getObjectBlockRecommendationText(
  block: LauncherObjectBlock | null | undefined,
): string | undefined {
  return !block || block.secretMasked || isSecretKind(block.kind)
    ? undefined
    : block.payloadText
}

// ─── Age label ─────────────────────────────────────────────────────────────────

export function formatAgeLabel(ageMs: number): string {
  if (ageMs < 1000) return objectBlockText('age.justNow')
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 60) return objectBlockText('age.seconds', { n: seconds })
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return objectBlockText('age.minutes', { n: minutes })
  return objectBlockText('age.hours', { n: Math.floor(minutes / 60) })
}

// ─── Kind label ────────────────────────────────────────────────────────────────

export function getKindLabel(kind: ObjectBlockKind): string {
  const key = `kind.${kind}`
  const label = objectBlockText(key)
  return label === key ? kind : label
}

// ─── Source label ──────────────────────────────────────────────────────────────

export function getSourceLabel(source: ObjectBlockSource): string {
  const key = `source.${source}`
  const label = objectBlockText(key)
  return label === key ? source : label
}

// ─── Factory ───────────────────────────────────────────────────────────────────

let blockIdCounter = 0

export function createGenericObjectBlock(params: {
  source: ObjectBlockSource
  kind: ObjectBlockKind
  title: string
  subtitle?: string
  text?: string
  ageLabel?: string
  removable?: boolean
  masked?: boolean
  validity?: ObjectBlockValidity
  state?: ObjectBlockState
  meta?: ObjectBlockMeta
}): LauncherObjectBlock {
  // Format labels and explicit caller kinds must not hide a sensitive-content signal.
  const masked = Boolean(params.masked || isSecretKind(params.kind) ||
    (params.text && detectContent(params.text).some((detection) => isSecretKind(detection.kind))))
  const state = params.state ?? (masked ? 'secret-masked' : params.validity === 'invalid' ? 'invalid' : undefined)
  return {
    id: `object-block:${params.source}:${++blockIdCounter}`,
    source: params.source,
    kind: params.kind,
    title: params.title,
    subtitle: params.subtitle,
    preview: masked ? undefined : params.text?.slice(0, 120),
    payloadText: params.text,
    ageLabel: params.ageLabel,
    createdAt: Date.now(),
    removable: params.removable ?? true,
    selectedForDelete: false,
    secretMasked: masked,
    validity: params.validity ?? 'unknown',
    state,
    meta: params.meta,
  }
}

export function createClipboardObjectBlock(
  snapshot: ClipboardSnapshot,
  now: number = Date.now(),
  options?: {
    forceAttach?: boolean
    /** Sticky / non-empty query: never auto-steal focus from typing. */
    suppressAutoAttach?: boolean
  },
): LauncherObjectBlock | null {
  if (!options?.forceAttach) {
    if (options?.suppressAutoAttach) return null
    if (!shouldAutoAttachClipboard(snapshot, now)) return null
    // Strong structured content only (json/url/jwt/base64/…), not plain text.
    if (!isStrongClipboardAttachEligible(snapshot.text)) return null
  }
  const ageMs = snapshot.changedAt !== undefined ? now - snapshot.changedAt : 0
  const kind = normalizeSecretKind(snapshot.detectedType)
  const filePath = detectClipboardFilePath(snapshot.text)
  const subtitle = filePath
    ? `${getKindLabel(kind)} · ${fileNameFromPath(filePath.path)}`
    : getKindLabel(kind)
  return createGenericObjectBlock({
    source: 'clipboard',
    kind,
    title: getSourceLabel('clipboard'),
    subtitle,
    text: snapshot.text,
    ageLabel: formatAgeLabel(ageMs),
    masked: isSecretKind(kind),
    validity: kind === 'json' ? 'valid' : 'unknown',
    state: isSecretKind(kind) ? 'secret-masked' : 'fresh',
    meta: { age: formatAgeLabel(ageMs), size: formatSize(snapshot.text.length) },
  })
}

export function createEditorSelectionObjectBlock(params: {
  text: string
  kind: ObjectBlockKind
  lineCount: number
}): LauncherObjectBlock {
  const kind = normalizeSecretKind(params.kind)
  return createGenericObjectBlock({
    source: 'editor-selection',
    kind,
    title: getSourceLabel('editor-selection'),
    subtitle: `${getKindLabel(kind)} · ${objectBlockText('detail.lines', { n: params.lineCount })}`,
    text: params.text,
    masked: isSecretKind(kind),
    validity: kind === 'json' ? 'valid' : 'unknown',
    meta: { lineCount: params.lineCount },
  })
}

export function createEditorDocumentObjectBlock(params: {
  text: string
  kind: ObjectBlockKind
  charCount: number
}): LauncherObjectBlock {
  const kind = normalizeSecretKind(params.kind)
  return createGenericObjectBlock({
    source: 'editor-document',
    kind,
    title: getSourceLabel('editor-document'),
    subtitle: `${getKindLabel(kind)} · ${objectBlockText('detail.chars', { n: params.charCount })}`,
    text: params.text,
    masked: isSecretKind(kind),
    validity: kind === 'json' ? 'valid' : 'unknown',
    meta: { charCount: params.charCount },
  })
}

export function createSnapshotObjectBlock(params: {
  editorWindowId?: string
  paneId?: string
  title: string
  text: string
  kind: ObjectBlockKind
  snapshotAt: number
}): LauncherObjectBlock {
  const kind = normalizeSecretKind(params.kind)
  return createGenericObjectBlock({
    source: 'snapshot',
    kind,
    title: params.editorWindowId ? `${params.editorWindowId}` : getSourceLabel('snapshot'),
    subtitle: `${params.title} · ${objectBlockText('detail.snapshot')}`,
    text: params.text,
    masked: isSecretKind(kind),
    validity: kind === 'json' ? 'valid' : 'unknown',
    state: 'snapshot',
    meta: {
      editorWindowId: params.editorWindowId,
      paneId: params.paneId,
      snapshotAt: params.snapshotAt,
      contentProvider: 'snapshot',
    },
  })
}

export type CreateHistoryItemObjectBlockParams =
  | {
      kind: 'text'
      text: string
      ageLabel?: string
      sizeLabel?: string
      detectedKind?: ObjectBlockKind
    }
  | {
      kind: 'image'
      blobId: string
      contentType: string
      width?: number
      height?: number
      ageLabel?: string
      sizeLabel?: string
    }
  | {
      kind: 'files'
      paths: string[]
      fileNames: string[]
      ageLabel?: string
      sizeLabel?: string
    }

export function createHistoryItemObjectBlock(params: CreateHistoryItemObjectBlockParams): LauncherObjectBlock {
  if (params.kind === 'text') {
    const detected = params.detectedKind ?? detectClipboardType(params.text)
    const kind = normalizeSecretKind(detected)
    const block = createGenericObjectBlock({
      source: 'history-item',
      kind,
      title: getSourceLabel('history-item'),
      subtitle: `${params.ageLabel ?? ''} · ${getKindLabel(kind)}${params.sizeLabel ? ` · ${params.sizeLabel}` : ''}`.replace(/^\s·\s/, ''),
      text: params.text,
      masked: isSecretKind(kind),
      removable: true,
      validity: 'unknown',
      meta: { age: params.ageLabel, size: params.sizeLabel },
    })
    return block
  }

  if (params.kind === 'image') {
    const dim =
      params.width && params.height ? `${params.width}×${params.height}` : undefined
    const subtitleParts = [params.ageLabel, getKindLabel('image'), dim, params.sizeLabel].filter(Boolean)
    return {
      id: `object-block:history-item:${++blockIdCounter}`,
      source: 'history-item',
      kind: 'image',
      title: getSourceLabel('history-item'),
      subtitle: subtitleParts.join(' · '),
      preview: undefined,
      payloadImage: {
        blobId: params.blobId,
        contentType: params.contentType,
        width: params.width,
        height: params.height,
      },
      ageLabel: params.ageLabel,
      createdAt: Date.now(),
      removable: true,
      validity: 'valid',
      meta: { age: params.ageLabel, size: params.sizeLabel },
    }
  }

  const names = params.fileNames?.length ? params.fileNames.join(', ') : objectBlockText('detail.fileCount', { n: params.paths.length })
  const subtitleParts = [params.ageLabel, getKindLabel('files'), names, params.sizeLabel].filter(Boolean)
  return {
    id: `object-block:history-item:${++blockIdCounter}`,
    source: 'history-item',
    kind: 'files',
    title: getSourceLabel('history-item'),
    subtitle: subtitleParts.join(' · '),
    preview: names.slice(0, 120),
    payloadFiles: {
      paths: params.paths,
      fileNames: params.fileNames,
    },
    ageLabel: params.ageLabel,
    createdAt: Date.now(),
    removable: true,
    validity: 'valid',
    meta: { age: params.ageLabel, size: params.sizeLabel },
  }
}

export function createQueryObjectBlock(params: {
  query: string
  kind?: ObjectBlockKind
}): LauncherObjectBlock {
  const kind = normalizeSecretKind(params.kind ?? detectClipboardType(params.query))
  return createGenericObjectBlock({
    source: 'query',
    kind,
    title: getSourceLabel('query'),
    text: params.query,
    removable: true,
    validity: 'unknown',
    meta: { charCount: params.query.length, lineCount: params.query.split(/\r\n|\r|\n/).length },
  })
}

/**
 * Typed or pasted launcher query that is clearly a structured object (JSON, JWT,
 * timestamp, URL, ...) becomes a content block; ordinary search text stays null.
 */
export function createStrongQueryObjectBlock(query: string): LauncherObjectBlock | null {
  return isStrongClipboardAttachEligible(query) ? createQueryObjectBlock({ query }) : null
}

export function createToolResultObjectBlock(text: string): LauncherObjectBlock {
  const kind = normalizeSecretKind(detectClipboardType(text))
  return createGenericObjectBlock({
    source: 'tool-result',
    kind,
    title: getSourceLabel('tool-result'),
    subtitle: getKindLabel(kind),
    text,
    masked: isSecretKind(kind),
    removable: true,
    validity: kind === 'json' ? 'valid' : 'unknown',
  })
}

// ─── Hint for recent clipboard (30s–2 min) ─────────────────────────────────────

export type RecentClipboardHint = {
  snapshot: ClipboardSnapshot
  ageLabel: string
  kind: ObjectBlockKind
}

export function buildRecentClipboardHint(snapshot: ClipboardSnapshot, now: number = Date.now()): RecentClipboardHint | null {
  if (!shouldShowRecentClipboardHint(snapshot, now)) return null
  // Hint only for content that would have hard-attached when fresher.
  if (!isStrongClipboardAttachEligible(snapshot.text)) return null
  const ageMs = snapshot.changedAt !== undefined ? now - snapshot.changedAt : 0
  return {
    snapshot,
    ageLabel: formatAgeLabel(ageMs),
    kind: normalizeSecretKind(snapshot.detectedType),
  }
}

function normalizeSecretKind(kind: ObjectBlockKind): ObjectBlockKind {
  return kind === 'secret' ? 'secret-like' : kind
}

function isSecretKind(kind: string): boolean {
  return kind === 'secret' || kind === 'secret-like'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
