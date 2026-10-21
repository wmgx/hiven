/**
 * First-party Diff host surface — NOT part of the public @hiven/plugin SDK.
 *
 * Only the text-diff plugin may import `@hiven/plugin-diff`.
 * Diff product semantics (JSON semantic, dual-pane chrome, write-back policy)
 * stay in the plugin; this module only injects pure kits.
 *
 * Trusted-plugin model (route A): same renderer, not a sandbox.
 */

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

function createPluginDiffHooks(): PluginDiffHooks {
  return {
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
