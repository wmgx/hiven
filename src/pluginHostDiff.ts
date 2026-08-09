/**
 * First-party Diff host surface — NOT part of the public @hiven/plugin SDK.
 *
 * Only the text-diff plugin may import `@hiven/plugin-diff`.
 * Diff product semantics (JSON semantic, dual-pane chrome, write-back policy)
 * stay in the plugin; this module only injects pure kits + pane text binding.
 *
 * Trusted-plugin model (route A): same renderer, not a sandbox.
 */

import * as React from 'react'
import { DualEditorView } from './kits/ui/DualEditorView'
import { computeTextLineDiff } from './kits/diff/lineDiff'
import {
  buildDiffTree,
  buildJsonDiffViewModel,
  buildSideLines,
  computeJsonLineHighlights,
  formatJsonPreserveKeyOrder,
  parseJson,
} from './kits/diff/jsonSemanticDiff'
import { useWorkspaceStore } from './workspace/workspaceStore'
import type { DiffSourcePayload } from './workspace/diffTypes'
import {
  getActiveEditorContextSnapshot,
  replaceEditorSelection,
  subscribeActiveEditorState,
} from './workspace/editorBridge'
import { useQuickEditorStore } from './workspace/quickEditor/quickEditorStore'
import { setQuickEditorPaneText } from './workspace/quickEditor/quickEditorRequests'
import type { PaneId } from './workspace/types'

export type DiffSourceBinding = {
  kind?: DiffSourcePayload['kind']
  paneId?: string
  origin?: DiffSourcePayload['origin']
  text?: string
}

export type PluginDiffKits = {
  DualEditorView: typeof DualEditorView
  computeTextLineDiff: typeof computeTextLineDiff
  buildDiffTree: typeof buildDiffTree
  buildJsonDiffViewModel: typeof buildJsonDiffViewModel
  buildSideLines: typeof buildSideLines
  computeJsonLineHighlights: typeof computeJsonLineHighlights
  formatJsonPreserveKeyOrder: typeof formatJsonPreserveKeyOrder
  parseJson: typeof parseJson
}

export type PluginDiffHooks = {
  useBoundSourceText: (source: DiffSourceBinding) => string
  setBoundSourceText: (source: DiffSourceBinding, text: string) => void
  /** Legacy fullscreen workbench path; prefer plugin surface windows. */
  clearActiveFullscreenView: () => void
  useActiveFullscreenView: () => {
    type: 'diff'
    original: DiffSourcePayload
    modified: DiffSourcePayload
  } | null
}

export type PluginDiffHost = {
  kits: PluginDiffKits
  hooks: PluginDiffHooks
}

function getMirroredEditorPaneText(paneId: PaneId): string | undefined {
  const snapshot = getActiveEditorContextSnapshot()
  return snapshot?.activePaneId === paneId ? snapshot.activeText : undefined
}

function writeBoundSourceText(source: DiffSourceBinding, text: string): void {
  if (source.kind !== 'editor-pane' || !source.paneId) return
  const paneId = source.paneId
  const origin = source.origin
    ?? (useQuickEditorStore.getState().panes[paneId] ? 'quick-editor' as const : null)
    ?? (useWorkspaceStore.getState().panes[paneId] ? 'editor' as const : null)

  if (origin === 'quick-editor') {
    void setQuickEditorPaneText(paneId, text)
    return
  }

  if (origin === 'editor' || useWorkspaceStore.getState().panes[paneId]) {
    useWorkspaceStore.getState().setPaneText(paneId, text)
    return
  }

  void replaceEditorSelection(text, { paneId }).catch(() => {
    // Bridge may be unavailable outside editor window; snapshot text remains local.
  })
}

function createPluginDiffHooks(): PluginDiffHooks {
  return {
    useBoundSourceText: (source) => {
      const paneId = typeof source.paneId === 'string' ? source.paneId : ''
      const quickText = useQuickEditorStore((s: { panes: Record<string, { text?: string }> }) => (
        paneId ? s.panes[paneId]?.text : undefined
      ))
      const workspaceText = useWorkspaceStore((s) => (paneId ? s.panes[paneId]?.text : undefined))
      const mirroredText = React.useSyncExternalStore(
        subscribeActiveEditorState,
        () => (paneId ? getMirroredEditorPaneText(paneId) : undefined),
        () => undefined,
      )
      if (source.kind !== 'editor-pane' || !paneId) return source.text ?? ''
      if (source.origin === 'quick-editor') return quickText ?? source.text ?? ''
      if (source.origin === 'editor') return workspaceText ?? mirroredText ?? source.text ?? ''
      return quickText ?? workspaceText ?? mirroredText ?? source.text ?? ''
    },
    setBoundSourceText: writeBoundSourceText,
    clearActiveFullscreenView: () => {
      useWorkspaceStore.getState().clearActiveFullscreenView()
    },
    useActiveFullscreenView: () => {
      return useWorkspaceStore((s) => s.activeFullscreenView)
    },
  }
}

let cached: PluginDiffHost | null = null

/** First-party text-diff only. Do not call from third-party plugins. */
export function getPluginDiffHost(): PluginDiffHost {
  if (cached) return cached
  cached = {
    kits: {
      DualEditorView,
      computeTextLineDiff,
      buildDiffTree,
      buildJsonDiffViewModel,
      buildSideLines,
      computeJsonLineHighlights,
      formatJsonPreserveKeyOrder,
      parseJson,
    },
    hooks: createPluginDiffHooks(),
  }
  return cached
}

export type { DiffSourcePayload as DiffSource }
