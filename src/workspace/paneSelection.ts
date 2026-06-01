/**
 * FluxText - Pane Selection Protocol
 * Provides type definitions and helpers for multi-pane input selection.
 */

import type { PaneId } from './types'

export type DiffInputKind = 'text' | 'json' | 'csv' | 'xml' | 'unknown'

export type PaneSelectionRole = {
  key: string
  label: string
  required: boolean
  acceptedKinds?: DiffInputKind[]
}

export type PaneSelectionValue =
  | { type: 'pane'; paneId: PaneId }
  | { type: 'clipboard'; text: string }
  | { type: 'empty-pane' }

export type PaneSelectionResult = {
  roles: Record<string, PaneSelectionValue>
  diffType?: string
}

export type PaneSelectionRequest = {
  id: string
  sourceCommandId: string
  title: string
  titleI18n?: { zh?: string }
  roles: PaneSelectionRole[]
  allowedPaneIds?: PaneId[]
  defaultSelection?: Record<string, PaneId>
  allowCreatePane?: boolean
  allowClipboard?: boolean
  allowEmptyPane?: boolean
  allowDuplicate?: boolean
  showDiffType?: boolean
  onConfirm: (selection: PaneSelectionResult) => void
  onCancel: () => void
}

/**
 * Infer DiffInputKind from text content.
 */
export function inferKind(text: string): DiffInputKind {
  const trimmed = text.trim()
  if (!trimmed) return 'text'

  // Try JSON
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) ||
      (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    try {
      JSON.parse(trimmed)
      return 'json'
    } catch { /* not json */ }
  }

  // Try CSV (simple heuristic: first line has commas, multiple lines)
  const lines = trimmed.split('\n')
  if (lines.length > 1 && lines[0].includes(',') && !lines[0].includes('{')) {
    return 'csv'
  }

  // Try XML
  if (trimmed.startsWith('<') && trimmed.endsWith('>')) {
    return 'xml'
  }

  return 'text'
}
