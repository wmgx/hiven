import * as React from 'react'
import { definePlugin } from './workspace/definePlugin'
import { useAppStore } from './store'
import { useWorkspaceStore, type DiffSource } from './workspace/workspaceStore'
import { makePluginT, type PluginT } from './i18n/pluginI18nRegistry'
import type { Locale } from './i18n'
import { DualEditorView } from './kits/ui/DualEditorView'
import { computeTextLineDiff } from './kits/diff/lineDiff'
import { createMonacoDisposableBucket, disposeAllMonacoDisposables } from './utils/monacoDisposables'
import {
  buildDiffTree,
  buildJsonDiffViewModel,
  buildSideLines,
  computeJsonLineHighlights,
  formatJsonPreserveKeyOrder,
  parseJson,
} from './kits/diff/jsonSemanticDiff'
import type { PaneId } from './workspace/types'
import {
  getActiveEditorContextSnapshot,
  replaceEditorSelection,
  subscribeActiveEditorState,
} from './workspace/editorBridge'
import { useQuickEditorStore } from './workspace/quickEditor/quickEditorStore'
import { setQuickEditorPaneText } from './workspace/quickEditor/quickEditorRequests'
import type { MonacoDisposable } from './utils/monacoDisposables'
import {
  createPluginHostCoreSdk,
  type PluginHostEffects,
  type PluginHostUi,
  type TextCommandDefinition,
  textOutput,
  textError,
  defineTextCommand,
} from './pluginHostCore.ts'

export type { PluginHostUi, PluginHostEffects, TextCommandDefinition } from './pluginHostCore.ts'

type HostSettings = ReturnType<typeof useAppStore.getState>['settings']

/** Reusable rendering kits exposed to plugins (replaces relative `../../kits/*` imports). */
export type PluginHostKits = {
  DualEditorView: typeof DualEditorView
  monacoDisposables: {
    createBucket: typeof createMonacoDisposableBucket
    disposeAll: typeof disposeAllMonacoDisposables
  }
  diff: {
    computeTextLineDiff: typeof computeTextLineDiff
    buildDiffTree: typeof buildDiffTree
    buildJsonDiffViewModel: typeof buildJsonDiffViewModel
    buildSideLines: typeof buildSideLines
    computeJsonLineHighlights: typeof computeJsonLineHighlights
    formatJsonPreserveKeyOrder: typeof formatJsonPreserveKeyOrder
    parseJson: typeof parseJson
  }
}

/** Minimal Diff source binding fields for read/write through host stores. */
export type DiffSourceBinding = {
  kind?: DiffSource['kind']
  paneId?: string
  origin?: DiffSource['origin']
  text?: string
}

/** React hooks exposed to plugins (read-only store access; no setState). */
export type PluginHostHooks = {
  useSettings: () => HostSettings
  useLocale: () => Locale
  usePaneText: (paneId: PaneId) => string | undefined
  /**
   * Reactive text for a Diff source.
   * Pane-backed sources follow editor / quick-editor stores; others fall back to snapshot text.
   */
  useBoundSourceText: (source: DiffSourceBinding) => string
  /** Namespaced translate bound to the current locale (reactive). */
  useT: (pluginId: string) => PluginT
  /** Subscribe to the active fullscreen view state. */
  useActiveFullscreenView: () => { type: 'diff'; original: DiffSource; modified: DiffSource } | null
  /** Get workspace actions for fullscreen view and pane text management. */
  useWorkspaceActions: () => {
    setPaneText: (paneId: string, text: string) => void
    /** Bidirectional write-back for Diff sources (pane-backed only). */
    setBoundSourceText: (source: DiffSourceBinding, text: string) => void
    clearActiveFullscreenView: () => void
  }
}

export type { MonacoDisposable }

export type PluginHostI18n = {
  /** Build a namespaced translate function for a given locale (non-reactive). */
  makeT: (pluginId: string, locale: Locale) => PluginT
}

export type PluginHostSdk = {
  definePlugin: typeof definePlugin
  react: typeof React
  effects: PluginHostEffects
  ui: PluginHostUi
  kits: PluginHostKits
  hooks: PluginHostHooks
  i18n: PluginHostI18n
  textOutput: typeof textOutput
  textError: typeof textError
  defineTextCommand: typeof defineTextCommand
}

declare global {
  interface Window {
    HivenPlugin?: PluginHostSdk
    FluxTextPlugin?: PluginHostSdk
  }
}

export function createPluginHostSdk(): PluginHostSdk {
  const core = createPluginHostCoreSdk()
  return {
    definePlugin: core.definePlugin,
    react: React,
    effects: core.effects,
    ui: core.ui,
    kits: createPluginHostKits(),
    hooks: createPluginHostHooks(),
    i18n: { makeT: makePluginT },
    textOutput: core.textOutput,
    textError: core.textError,
    defineTextCommand: core.defineTextCommand,
  }
}

/**
 * Stable SDK accessor for both load-time models:
 *   - Runtime/external plugins: `window.HivenPlugin` already injected by the host.
 *   - Bundled first-party plugins: globals may not be installed yet at module eval,
 *     so build (and cache) the SDK on first access.
 *
 * IMPORTANT: never destructure the SDK at module top level; call this inside
 * component bodies or `run()` so the host globals are guaranteed available.
 */
export function getPluginHostSdk(): PluginHostSdk {
  if (typeof window !== 'undefined' && window.HivenPlugin) return window.HivenPlugin
  if (typeof window !== 'undefined' && window.FluxTextPlugin) return window.FluxTextPlugin
  const sdk = createPluginHostSdk()
  if (typeof window !== 'undefined') {
    window.HivenPlugin = sdk
    window.FluxTextPlugin = sdk
  }
  return sdk
}

function createPluginHostKits(): PluginHostKits {
  return {
    DualEditorView,
    monacoDisposables: {
      createBucket: createMonacoDisposableBucket,
      disposeAll: disposeAllMonacoDisposables,
    },
    diff: {
      computeTextLineDiff,
      buildDiffTree,
      buildJsonDiffViewModel,
      buildSideLines,
      computeJsonLineHighlights,
      formatJsonPreserveKeyOrder,
      parseJson,
    },
  }
}

function createPluginHostHooks(): PluginHostHooks {
  return {
    useSettings: () => useAppStore((s) => s.settings),
    useLocale: () => useAppStore((s) => s.locale),
    usePaneText: (paneId) => {
      return React.useSyncExternalStore(
        subscribeActiveEditorState,
        () => getMirroredEditorPaneText(paneId),
        () => undefined,
      )
    },
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
    useT: (pluginId) => {
      const locale = useAppStore((s) => s.locale)
      return makePluginT(pluginId, locale)
    },
    useActiveFullscreenView: () => {
      return useWorkspaceStore((s) => s.activeFullscreenView)
    },
    useWorkspaceActions: () => {
      const setPaneText = useWorkspaceStore((s) => s.setPaneText)
      const clearActiveFullscreenView = useWorkspaceStore((s) => s.clearActiveFullscreenView)
      return {
        setPaneText,
        setBoundSourceText: writeBoundSourceText,
        clearActiveFullscreenView,
      }
    },
  }
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

  // Last-resort cross-window write for editor panes when this webview has no live workspace pane.
  void replaceEditorSelection(text, { paneId }).catch(() => {
    // Bridge may be unavailable outside editor window; snapshot text remains local.
  })
}
