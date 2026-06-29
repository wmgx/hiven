/**
 * Launcher Object Block — The visible "object token" in the launcher input bar.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §5.2
 *
 * Phase R0: represents the active clipboard or editor-selection object.
 */

import type { ClipboardDetectedType, ClipboardSnapshot } from './clipboardSnapshot'
import { shouldAutoAttachClipboard, shouldShowRecentClipboardHint } from './clipboardSnapshot'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type ObjectBlockSource = 'clipboard' | 'editor-selection' | 'editor-document'

export type ObjectBlockKind = ClipboardDetectedType | 'markdown' | 'plain-text'

export type LauncherObjectBlock = {
  id: string
  source: ObjectBlockSource
  kind: ObjectBlockKind
  title: string
  subtitle?: string
  preview?: string
  ageLabel?: string
  createdAt: number
  removable: boolean
  selectedForDelete?: boolean
  secretMasked?: boolean
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
  text: '文本',
  command: '命令',
  secret: '疑似敏感内容',
  unknown: '内容',
  markdown: 'Markdown',
  'plain-text': '纯文本',
}

export function getKindLabel(kind: ObjectBlockKind): string {
  return KIND_LABELS[kind] ?? kind
}

// ─── Source label ──────────────────────────────────────────────────────────────

const SOURCE_LABELS: Record<ObjectBlockSource, string> = {
  clipboard: '剪贴板',
  'editor-selection': '当前选区',
  'editor-document': '当前文档',
}

export function getSourceLabel(source: ObjectBlockSource): string {
  return SOURCE_LABELS[source] ?? source
}

// ─── Factory ───────────────────────────────────────────────────────────────────

let blockIdCounter = 0

export function createClipboardObjectBlock(snapshot: ClipboardSnapshot, now: number = Date.now()): LauncherObjectBlock | null {
  if (!shouldAutoAttachClipboard(snapshot, now)) return null
  const ageMs = snapshot.changedAt !== undefined ? now - snapshot.changedAt : 0
  return {
    id: `object-block:clipboard:${++blockIdCounter}`,
    source: 'clipboard',
    kind: snapshot.detectedType,
    title: getSourceLabel('clipboard'),
    subtitle: getKindLabel(snapshot.detectedType),
    preview: snapshot.detectedType === 'secret' ? undefined : snapshot.text.slice(0, 120),
    ageLabel: formatAgeLabel(ageMs),
    createdAt: now,
    removable: true,
    selectedForDelete: false,
    secretMasked: snapshot.detectedType === 'secret',
  }
}

export function createEditorSelectionObjectBlock(params: {
  text: string
  kind: ObjectBlockKind
  lineCount: number
}): LauncherObjectBlock {
  return {
    id: `object-block:editor-selection:${++blockIdCounter}`,
    source: 'editor-selection',
    kind: params.kind,
    title: getSourceLabel('editor-selection'),
    subtitle: `${getKindLabel(params.kind)} · ${params.lineCount} 行`,
    preview: params.text.slice(0, 120),
    createdAt: Date.now(),
    removable: true,
    selectedForDelete: false,
    secretMasked: false,
  }
}

export function createEditorDocumentObjectBlock(params: {
  text: string
  kind: ObjectBlockKind
  charCount: number
}): LauncherObjectBlock {
  return {
    id: `object-block:editor-document:${++blockIdCounter}`,
    source: 'editor-document',
    kind: params.kind,
    title: getSourceLabel('editor-document'),
    subtitle: `${getKindLabel(params.kind)} · ${params.charCount} 字`,
    preview: params.text.slice(0, 120),
    createdAt: Date.now(),
    removable: true,
    selectedForDelete: false,
    secretMasked: false,
  }
}

// ─── Hint for recent clipboard (2-10 min) ──────────────────────────────────────

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
    kind: snapshot.detectedType,
  }
}
