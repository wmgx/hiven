import * as React from 'react'
import { definePlugin } from './workspace/definePlugin'
import { useAppStore } from './store'
import { makePluginT, type PluginT } from './i18n/pluginI18nRegistry'
import type { Locale } from './i18n'
import { detectContent } from './kits/content'
import { createMonacoDisposableBucket, disposeAllMonacoDisposables } from './utils/monacoDisposables'
import type { PaneId } from './workspace/types'
import {
  getActiveEditorContextSnapshot,
  subscribeActiveEditorState,
} from './workspace/editorBridge'
import type { MonacoDisposable } from './utils/monacoDisposables'
import {
  createPluginHostCoreSdk,
  type PluginHostEffects,
  type PluginHostUi,

  textOutput,
  textError,
  defineTextCommand,
} from './pluginHostCore.ts'
import {
  createDesktopTargetsHostApi,
  type DesktopTargetsHostApi,
} from './workspace/desktopTargets/pluginApi'
import {
  listRegisteredUrlSchemes,
  registerUrlSchemes,
  unregisterUrlSchemes,
} from './workspace/urlSchemeRegistry'
import {
  registerCoverageProvider,
  unregisterCoverageProvider,
  type CoverageProvider,
} from './workspace/learning/coverage'
import {
  registerLearnedRuleSink,
  unregisterLearnedRuleSink,
  type LearnedRuleSink,
} from './workspace/learning/ruleSink'
import { updateOwnPluginSettings } from './workspace/pluginSettingsWrite'
import type { PluginSettingsSource } from './workspace/pluginSettingsStore'
import { useQuickEditorStore } from './workspace/quickEditor/quickEditorStore'
import { hivenEventBus, type HivenEventBusApi, type HivenHostEvents } from './workspace/hostEventBus'

export type { LearnedRuleOffer, LearnedRuleSink } from './workspace/learning/ruleSink'
export type { PluginHostUi, PluginHostEffects, TextCommandDefinition } from './pluginHostCore.ts'
export type {
  DesktopTargetsHostApi,
  DesktopTargetProvider,
  DesktopBridgeEventDto,
  DesktopBridgeHistoryDto,
  DesktopBridgeSourceConfig,
} from './workspace/desktopTargets/pluginApi'

type HostSettings = ReturnType<typeof useAppStore.getState>['settings']

/**
 * Public kits for all plugins.
 * Diff / DualEditorView live on `@hiven/plugin-diff` (text-diff only) — not here.
 */
export type PluginHostKits = {
  monacoDisposables: {
    createBucket: typeof createMonacoDisposableBucket
    disposeAll: typeof disposeAllMonacoDisposables
  }
  content: {
    detectContent: typeof detectContent
  }
}

/**
 * Public hooks for all plugins (read-only host state).
 * Diff write-back and fullscreen workspace actions live on `@hiven/plugin-diff`.
 */
export type PluginHostHooks = {
  useSettings: () => HostSettings
  useLocale: () => Locale
  usePaneText: (paneId: PaneId) => string | undefined
  /** Namespaced translate bound to the current locale (reactive). */
  useT: (pluginId: string) => PluginT
}

export type { MonacoDisposable }
export type { HivenEventBusApi, HivenHostEvents }

export type PluginHostI18n = {
  /** Build a namespaced translate function for a given locale (non-reactive). */
  makeT: (pluginId: string, locale: Locale) => PluginT
}

export type UrlSchemeRegistryApi = {
  /** Register non-http schemes this plugin may open via host openUrl (e.g. lark, feishu). */
  register: (pluginId: string, schemes: string[]) => void
  unregister: (pluginId: string) => void
  list: () => string[]
}

export type CoverageRegistryApi = {
  /**
   * Declare which inputs this plugin already handles, so the self-learning layer
   * never proposes a rule that duplicates an existing capability. The test gets a
   * probe (representative token + target host) and returns true if the plugin
   * would already act on it.
   */
  register: (pluginId: string, test: CoverageProvider) => void
  unregister: (pluginId: string) => void
}

export type LearningRegistryApi = {
  /**
   * Claim learned rules that belong to a concept this plugin already owns.
   *
   * The learner offers each discovered rule before storing it. Return true to
   * take ownership: the rule then lives in this plugin's own storage, where the
   * user can see and EDIT it alongside the ones they wrote by hand, instead of
   * in a second delete-only list. Return false to leave it with the learner.
   *
   * The offer is structural (template + slot kind); translating it into whatever
   * this plugin persists is the plugin's job.
   */
  registerSink: (pluginId: string, sink: LearnedRuleSink) => void
  unregisterSink: (pluginId: string) => void
}

export type PluginSettingsWriteApi = {
  /**
   * Read-modify-write this plugin's own settings, through the same store the
   * settings UI uses (so migrations, versioning and onChange all still apply).
   *
   * Exists so a plugin can persist something it learned or computed — a plugin
   * could previously only READ its settings, which left claimed learned rules
   * with nowhere to go. `pluginId`/`source` come from the host-provided plugin
   * context; do not synthesize them.
   */
  update: <T>(
    pluginId: string,
    source: PluginSettingsSource,
    updater: (current: T) => T,
  ) => void
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
  /**
   * Desktop Target protocol: plugins register providers (browser tabs, Feishu, …)
   * that feed Global Launcher mix — not parallel dynamicItems lists.
   */
  desktopTargets: DesktopTargetsHostApi
  /** Typed host events crossing native / WebView boundaries. */
  events: HivenEventBusApi
  /**
   * Plugin-declared URL schemes for host openUrl routing.
   * Custom schemes are opened via open_system_url — not Tauri shell.open scope.
   */
  urlSchemes: UrlSchemeRegistryApi
  /**
   * Plugin-declared capability coverage — the self-learning novelty guard.
   * Register a test so the learner won't re-propose what this plugin already does.
   */
  coverage: CoverageRegistryApi
  /**
   * Self-learning integration: claim learned rules whose concept this plugin
   * already owns, so they land in one editable list rather than two.
   */
  learning: LearningRegistryApi
  /** Persist changes to this plugin's own settings (see PluginSettingsWriteApi). */
  settings: PluginSettingsWriteApi
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
    desktopTargets: createDesktopTargetsHostApi(),
    events: hivenEventBus,
    urlSchemes: {
      register: registerUrlSchemes,
      unregister: unregisterUrlSchemes,
      list: listRegisteredUrlSchemes,
    },
    coverage: {
      register: registerCoverageProvider,
      unregister: unregisterCoverageProvider,
    },
    learning: {
      registerSink: registerLearnedRuleSink,
      unregisterSink: unregisterLearnedRuleSink,
    },
    settings: {
      update: updateOwnPluginSettings,
    },
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
    monacoDisposables: {
      createBucket: createMonacoDisposableBucket,
      disposeAll: disposeAllMonacoDisposables,
    },
    content: {
      detectContent,
    },
  }
}

function createPluginHostHooks(): PluginHostHooks {
  return {
    useSettings: () => useAppStore((s) => s.settings),
    useLocale: () => useAppStore((s) => s.locale),
    usePaneText: (paneId) => {
      const editorText = React.useSyncExternalStore(
        subscribeActiveEditorState,
        () => getMirroredEditorPaneText(paneId),
        () => undefined,
      )
      const quickEditorText = useQuickEditorStore((state) => state.panes[paneId]?.text)
      return quickEditorText ?? editorText
    },
    useT: (pluginId) => {
      const locale = useAppStore((s) => s.locale)
      return makePluginT(pluginId, locale)
    },
  }
}

function getMirroredEditorPaneText(paneId: PaneId): string | undefined {
  const snapshot = getActiveEditorContextSnapshot()
  return snapshot?.activePaneId === paneId ? snapshot.activeText : undefined
}
