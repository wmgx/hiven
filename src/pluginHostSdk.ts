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
  parseJson,
} from './kits/diff/jsonSemanticDiff'
import type { PaneId } from './workspace/types'
import { getActiveEditorContextSnapshot, subscribeActiveEditorState } from './workspace/editorBridge'
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
    parseJson: typeof parseJson
  }
}

/** React hooks exposed to plugins (read-only store access; no setState). */
export type PluginHostHooks = {
  useSettings: () => HostSettings
  useLocale: () => Locale
  usePaneText: (paneId: PaneId) => string | undefined
  /** Namespaced translate bound to the current locale (reactive). */
  useT: (pluginId: string) => PluginT
  /** Subscribe to the active fullscreen view state. */
  useActiveFullscreenView: () => { type: 'diff'; original: DiffSource; modified: DiffSource } | null
  /** Get workspace actions for fullscreen view and pane text management. */
  useWorkspaceActions: () => {
    setPaneText: (paneId: string, text: string) => void
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
      return { setPaneText, clearActiveFullscreenView }
    },
  }
}

function getMirroredEditorPaneText(paneId: PaneId): string | undefined {
  const snapshot = getActiveEditorContextSnapshot()
  return snapshot?.activePaneId === paneId ? snapshot.activeText : undefined
}
