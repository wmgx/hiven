/**
 * Launcher Object Block — The visible object token in launcher/editor command.
 *
 * Step 5 design language: every surface first declares Object, then recommends
 * Action, then resolves Output Target. This model intentionally describes
 * product objects rather than plugin parameters.
 */

import type { ClipboardDetectedType, ClipboardSnapshot } from './clipboardSnapshot'
import {
  detectClipboardFilePath,
  detectClipboardType,
  fileNameFromPath,
  shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint,
} from './clipboardSnapshot'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ObjectBlockSource =
  | 'clipboard'
  | 'editor-selection'
  | 'editor-pane'
  | 'editor-document'
  | 'multi-pane'
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
  | 'multi-object'
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
  leftTitle?: string
  rightTitle?: string
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

// ─── Age label ─────────────────────────────────────────────────────────────────

export function formatAgeLabel(ageMs: number): string {
  if (ageMs < 1000) return '刚刚'
  const seconds = Math.floor(ageMs / 1000)
  if (seconds < 60) return `${seconds} 秒前`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes} 分钟前`
  return `${Math.floor(minutes / 60)} 小时前`
}

// ─── Kind label ────────────────────────────────────────────────────────────────

const KIND_LABELS: Record<ObjectBlockKind, string> = {
  json: 'JSON',
  url: 'URL',
  text: 'Text',
  command: 'Command',
  secret: 'Secret-like Text',
  'secret-like': 'Secret-like Text',
  unknown: 'Unknown',
  markdown: 'Markdown',
  'plain-text': 'Text',
  sql: 'SQL',
  css: 'CSS',
  xml: 'XML',
  csv: 'CSV',
  jwt: 'JWT',
  timestamp: 'Timestamp',
  yaml: 'YAML',
  'query-string': 'Query String',
  image: 'Image',
  files: 'Files',
}

export function getKindLabel(kind: ObjectBlockKind): string {
  return KIND_LABELS[kind] ?? kind
}

// ─── Source label ──────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<ObjectBlockSource, string> = {
  clipboard: '剪贴板',
  'editor-selection': '当前选区',
  'editor-pane': '当前 pane',
  'editor-document': '当前文档',
  'multi-pane': '两个 pane',
  'history-item': '剪贴板历史',
  query: 'Query',
  snapshot: 'Snapshot',
  'tool-result': '计算结果',
}

export function getSourceLabel(source: ObjectBlockSource): string {
  return SOURCE_LABELS[source] ?? source
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
  const masked = params.masked || params.kind === 'secret' || params.kind === 'secret-like'
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
  options?: { forceAttach?: boolean },
): LauncherObjectBlock | null {
  if (!options?.forceAttach && !shouldAutoAttachClipboard(snapshot, now)) return null
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
    subtitle: `${getKindLabel(kind)} · ${params.lineCount} 行`,
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
    subtitle: `${getKindLabel(kind)} · ${params.charCount} 字`,
    text: params.text,
    masked: isSecretKind(kind),
    validity: kind === 'json' ? 'valid' : 'unknown',
    meta: { charCount: params.charCount },
  })
}

export function createEditorPaneObjectBlock(params: {
  text: string
  kind: ObjectBlockKind
  title: string
  paneId: string
  lineCount?: number
  editorWindowId?: string
}): LauncherObjectBlock {
  const kind = normalizeSecretKind(params.kind)
  return createGenericObjectBlock({
    source: 'editor-pane',
    kind,
    title: getSourceLabel('editor-pane'),
    subtitle: `${getKindLabel(kind)} · ${params.title}`,
    text: params.text,
    masked: isSecretKind(kind),
    validity: kind === 'json' ? 'valid' : 'unknown',
    meta: {
      paneId: params.paneId,
      editorWindowId: params.editorWindowId,
      lineCount: params.lineCount,
      contentProvider: 'live',
    },
  })
}

export function createMultiPaneObjectBlock(params: {
  left: { paneId: string; title: string; kind: ObjectBlockKind }
  right: { paneId: string; title: string; kind: ObjectBlockKind }
}): LauncherObjectBlock {
  const leftKind = normalizeSecretKind(params.left.kind)
  const rightKind = normalizeSecretKind(params.right.kind)
  const sameKind = leftKind === rightKind
  return createGenericObjectBlock({
    source: 'multi-pane',
    kind: sameKind ? leftKind : 'text',
    title: getSourceLabel('multi-pane'),
    subtitle: `${getKindLabel(leftKind)} + ${getKindLabel(rightKind)}`,
    removable: true,
    validity: 'unknown',
    state: 'multi-object',
    meta: {
      paneId: params.left.paneId,
      leftTitle: params.left.title,
      rightTitle: params.right.title,
      contentProvider: 'live',
    },
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
    subtitle: `${params.title} · snapshot`,
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

  const names = params.fileNames?.length ? params.fileNames.join(', ') : `${params.paths.length} files`
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
  kind: ObjectBlockKind
}): LauncherObjectBlock {
  return createGenericObjectBlock({
    source: 'query',
    kind: params.kind,
    title: params.query,
    text: params.query,
    removable: false,
    validity: 'unknown',
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

// ─── Hint for recent clipboard (30s–2 min) ─────────────────────────────────────

export type RecentClipboardHint = {
  snapshot: ClipboardSnapshot
  ageLabel: string
  kind: ObjectBlockKind
}

export function buildRecentClipboardHint(snapshot: ClipboardSnapshot, now: number = Date.now()): RecentClipboardHint | null {
  if (!shouldShowRecentClipboardHint(snapshot, now)) return null
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

function isSecretKind(kind: ObjectBlockKind): boolean {
  return kind === 'secret' || kind === 'secret-like'
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
