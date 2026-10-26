/**
 * Launcher Object Block — The visible object token in launcher/editor command.
 *
 * Step 5 design language: every surface first declares Object, then recommends
 * Action, then resolves Output Target. This model intentionally describes
 * product objects rather than plugin parameters.
 */

import type { LauncherItem } from '../../workspace/launcher/types'
import { detectContent } from '../../kits/content/index'
import type { ClipboardDetectedType, ClipboardSnapshot } from './clipboardSnapshot'
import {
  detectClipboardType,
  fileNameFromPath,
} from './clipboardSnapshot'
import { shouldShowClipboardHint } from './attachPolicy'
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
  blobId?: string
  dataUrl?: string
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

/** Only an explicit hint action calls this factory. */
export function createClipboardObjectBlock(snapshot: ClipboardSnapshot): LauncherObjectBlock {
  const kind = normalizeSecretKind(snapshot.detectedType)
  const block = createGenericObjectBlock({
    source: 'clipboard', kind, title: getSourceLabel('clipboard'),
    text: snapshot.image || snapshot.files ? undefined : snapshot.text,
    masked: isSecretKind(kind),
    validity: kind === 'json' ? 'valid' : 'unknown',
    meta: { charCount: snapshot.text.length },
  })
  if (snapshot.image) block.payloadImage = { ...snapshot.image, contentType: 'image/png' }
  if (snapshot.files) block.payloadFiles = { paths: snapshot.files, fileNames: snapshot.files.map(fileNameFromPath) }
  return block
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

export type RecentClipboardHint = {
  snapshot: ClipboardSnapshot
  kind: ObjectBlockKind
  masked: boolean
  answer?: LauncherItem
}

export function buildRecentClipboardHint(snapshot: ClipboardSnapshot, dismissedHash: string | null = null): RecentClipboardHint | null {
  if (!shouldShowClipboardHint(snapshot, dismissedHash)) return null
  return {
    snapshot,
    kind: normalizeSecretKind(snapshot.detectedType),
    masked: detectContent(snapshot.text).some(({ kind }) => isSecretKind(kind)),
  }
}

function normalizeSecretKind(kind: ObjectBlockKind): ObjectBlockKind {
  return kind === 'secret' ? 'secret-like' : kind
}

function isSecretKind(kind: string): boolean {
  return kind === 'secret' || kind === 'secret-like'
}
