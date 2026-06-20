/**
 * Launcher Domain Types
 *
 * The launcher is a host/workspace domain centered on `LauncherItem`, shared by
 * CommandPalette and GlobalLauncher. Plugins contribute launcher items (or tools
 * that the host adapts into launcher items); the host owns identity, ranking,
 * usage, and the execution lifecycle.
 *
 * Design rules enforced by these types:
 *  - Plugins cannot expose `systemKey`, `usageKey`, or `staticPriority`.
 *  - Plugins cannot define custom surfaces (only the host enum is allowed).
 *  - Plugins cannot reference commands from launcher items.
 *  - Plugin execute handlers receive a controlled `PluginLauncherApi`, never
 *    workspace internals.
 */

import type { ComponentType } from 'react'
import type { Locale } from '../../i18n'
import type { PluginPrivateStorageApi } from '../pluginTypes'
import type { FluxEffect } from '../types'
import type { EffectRunnerResult } from '../effectRunner'

// ─── System Surfaces ───────────────────────────────────────────────────────

/** The two system launcher surfaces in the first version. */
export type LauncherSurfaceId = 'command-palette' | 'global-launcher'

export const LAUNCHER_SURFACE_IDS: readonly LauncherSurfaceId[] = [
  'command-palette',
  'global-launcher',
] as const

export function isLauncherSurfaceId(value: unknown): value is LauncherSurfaceId {
  return value === 'command-palette' || value === 'global-launcher'
}

// ─── System Identity ───────────────────────────────────────────────────────

/**
 * System-generated identity for a launcher item. The host generates this; it is
 * never exposed to plugins. Examples:
 *   plugin:${pluginId}:launcher:${itemId}
 *   host:view:${viewId}
 *   host:action:${actionId}
 */
export type SystemLauncherItemKey = string

// ─── Text Input Policy ─────────────────────────────────────────────────────

export type TextInputMode = 'auto' | 'all' | 'selection'

export type TextInputPolicy = {
  mode?: TextInputMode
}

export type TextRange = {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export type ResolvedTextInput = {
  kind: 'text'
  text: string
  mode: TextInputMode
  source: 'selection' | 'all' | 'manual' | 'empty'
  range?: TextRange
  paneId?: string
  panelId?: string
}

// ─── Display ───────────────────────────────────────────────────────────────

export type IconRef = string

export type LauncherItemDisplay = {
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  subtitleI18n?: Partial<Record<Locale, string>>
  icon?: IconRef
  /** Extra search terms (aliases) used by ranking but not shown as primary. */
  aliases?: string[]
}

// ─── Behavior (lifecycle types) ──────────────────────────────────────────────

export type LauncherInputSpec = {
  placeholder?: string
  placeholderI18n?: Partial<Record<Locale, string>>
  /** When true an empty submit is allowed; otherwise the host blocks submit. */
  allowEmptyInput?: boolean
  emptyInputMessage?: string
  emptyInputMessageI18n?: Partial<Record<Locale, string>>
}

export type LauncherParamType = 'boolean' | 'text' | 'number' | 'single-select' | 'multi-select'

export type LauncherParamOption =
  | string
  | { label: string; value: string; labelI18n?: Partial<Record<Locale, string>>; description?: string; descriptionI18n?: Partial<Record<Locale, string>> }

export type LauncherParamSpec = {
  key: string
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  type: LauncherParamType
  options?: LauncherParamOption[]
  default?: unknown
  required?: boolean
  hint?: string
  hintI18n?: Partial<Record<Locale, string>>
  /** For multi-select params: minimum selected items required before submit. */
  minSelect?: number
  /** For multi-select params: maximum selected items. Reaching it disables unselected options. */
  maxSelect?: number
}

/**
 * Behavior types are lifecycle types, not product features.
 *  - `perform`       : direct action.
 *  - `collect-input` : two-step action (e.g. web quick open).
 */
export type LauncherBehavior =
  | { type: 'perform' }
  | { type: 'collect-input'; input: LauncherInputSpec }

// ─── Output (result choices) ─────────────────────────────────────────────────

/** Action handler for a result choice. May return more output (multi-level). */
export type LauncherResultActionHandler = () =>
  | LauncherExecuteResult
  | Promise<LauncherExecuteResult>
  | void
  | Promise<void>

export type LauncherResultAction = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  run: LauncherResultActionHandler
}

export type LauncherResultChoice = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  subtitleI18n?: Partial<Record<Locale, string>>
  preview?: string
  primaryAction: LauncherResultActionHandler
  secondaryActions?: LauncherResultAction[]
}

export type LauncherResultSelection = {
  type: 'multi'
  min: number
  max: number
  submitTitle?: string
  submit: (choices: LauncherResultChoice[]) =>
    | LauncherExecuteResult
    | Promise<LauncherExecuteResult>
    | void
    | Promise<void>
}

export type LauncherOutput = {
  choices: LauncherResultChoice[]
  selection?: LauncherResultSelection
}

export type LauncherExecuteResult =
  | { ok: true; output?: LauncherOutput; keepOpen?: boolean }
  | { ok: false; message: string }

// ─── Plugin Launcher API (controlled) ────────────────────────────────────────

/**
 * The controlled API passed to plugin launcher execute handlers. Plugins cannot
 * import workspace stores, effect runner, i18n registry, or Monaco utilities.
 * They can only use what is exposed here.
 */
export type PluginLauncherApi = {
  getActiveText(): string
  getSelectionText(): string
  getPaneSnapshot(): {
    activePaneId: string
    previousActivePaneId?: string
    paneIds: string[]
    panes: Record<string, { title?: string; language?: string; stickyScroll?: boolean }>
    renderers: Record<string, {
      rendererId: string
      ownerPluginId?: string
      ownerContributionId?: string
    }>
  }
  isPanePanelOpen(panelId: string): boolean
  getClipboardText(): Promise<string>
  replaceActiveText(text: string): Promise<void>
  insertText(text: string): Promise<void>
  copyText(text: string): Promise<void>
  openUrl(url: string): Promise<void>
  showMainPanel(): Promise<void>
  showPluginsPage(): Promise<void>
  showSettingsPage(): Promise<void>
  createPane(options?: { text?: string; title?: string; language?: string; focus?: boolean; direction?: 'left' | 'right' | 'top' | 'bottom' }): string
  dispatchEffects(effects: FluxEffect[]): EffectRunnerResult
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
  apps: PluginAppsApi
}

export type DiscoveredApp = {
  appId: string
  name: string
  nameI18n?: Partial<Record<Locale, string>>
  aliases?: string[]
  platform: 'macos' | 'windows' | 'linux'
  source: 'applications' | 'start-menu' | 'app-paths' | 'desktop-entry'
  displayPath?: string
  installedAt?: number
}

export type PluginAppsApi = {
  discoverApps(): Promise<DiscoveredApp[]>
  cacheAppIcons(appIds: string[]): Promise<number>
  launchApp(appId: string): Promise<void>
}

// ─── Execution Context ───────────────────────────────────────────────────────

export type LauncherExecutionContext<TSettings = unknown> = {
  surfaceId: LauncherSurfaceId
  /** Present only for `collect-input` behaviors. */
  input?: { text: string }
  settings: TSettings
  locale: Locale
  api: PluginLauncherApi
  storage: PluginPrivateStorageApi
  /** Plugin-scoped translate function. */
  t: (key: string, vars?: Record<string, string | number>) => string
}

export type LauncherExecuteHandler<TSettings = unknown> = (
  ctx: LauncherExecutionContext<TSettings>,
) => Promise<LauncherExecuteResult> | LauncherExecuteResult

export type LauncherExecuteWithParamsHandler<TSettings = unknown> = (
  ctx: LauncherExecutionContext<TSettings>,
  params: Record<string, unknown>,
) => Promise<LauncherExecuteResult> | LauncherExecuteResult

// ─── Plugin Contribution (authoring API) ─────────────────────────────────────

/**
 * What a plugin author declares for a launcher item.
 *
 * NOTE: this is intentionally narrow. There is no `usageKey`, no
 * `staticPriority`, no `systemKey`, and no command reference. `surfaces` may
 * only contain values from {@link LauncherSurfaceId}; unknown values are
 * rejected at runtime by the registry.
 */
export type LauncherItemContribution<TSettings = unknown> = {
  id: string
  display: LauncherItemDisplay
  behavior?: LauncherBehavior
  /** Restrict where the item appears. Missing = both main surfaces. */
  surfaces?: LauncherSurfaceId[]
  /** Whether this item can be pinned. Defaults to true for static items. */
  pinnable?: boolean
  inputPolicy?: TextInputPolicy
  params?: LauncherParamSpec[]
  defaultParams?: Record<string, unknown>
  /** When true, selecting the item always opens the parameter flow before execution. */
  requireParamSelection?: boolean
  execute: LauncherExecuteHandler<TSettings>
  executeWithParams?: LauncherExecuteWithParamsHandler<TSettings>
}

// ─── Dynamic Items ───────────────────────────────────────────────────────────

export type LauncherDynamicContext = {
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
  settings: unknown
  api: PluginLauncherApi
  storage: PluginPrivateStorageApi
  t: (key: string, vars?: Record<string, string | number>) => string
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
}

export type LauncherDynamicItemProvider = (
  ctx: LauncherDynamicContext,
) => Promise<LauncherItemContribution[]> | LauncherItemContribution[]

// ─── System Launcher Item (host-owned, resolved) ─────────────────────────────

export type LauncherItemContributionKind = 'plugin' | 'host' | 'dynamic'

/**
 * The fully-resolved, system-owned launcher item. The host generates `systemKey`
 * and may set `staticPriority` for a small number of host-owned items. Plugins
 * never construct this directly.
 */
export type LauncherItem = {
  systemKey: SystemLauncherItemKey
  kind: LauncherItemContributionKind
  pluginId?: string
  source?: 'builtin' | 'installed' | 'dev'
  display: LauncherItemDisplay
  behavior: LauncherBehavior
  surfaces?: LauncherSurfaceId[]
  pinnable: boolean
  inputPolicy?: TextInputPolicy
  /** Host-only ranking nudge for a small number of host-owned items. */
  staticPriority?: number
  /** Host-owned ranking metadata. Plugins never construct resolved launcher items. */
  ranking?: {
    /** Milliseconds since epoch; used as a small freshness boost for recently installed apps. */
    installedAt?: number
  }
  /**
   * Host-only legacy usage keys (e.g. the backing command id) consulted as a
   * fallback by ranking so pre-migration usage history is preserved. Never
   * exposed to plugins.
   */
  legacyUsageKeys?: string[]
  /** Host-owned parameter schema for system adapters that support Cmd/Ctrl+Enter customization. */
  params?: LauncherParamSpec[]
  /** Explicit default values used when entering the parameter form. */
  defaultParams?: Record<string, unknown>
  /** Host-owned execution policy: defaults can prefill UI but must not skip parameter selection. */
  requireParamSelection?: boolean
  execute: LauncherExecuteHandler
  executeWithParams?: LauncherExecuteWithParamsHandler
}

// ─── Pinned Reference ─────────────────────────────────────────────────────────

/** Pinned entries reference launcher items; they are not searchable items. */
export type PinnedLauncherRef = {
  itemKey: SystemLauncherItemKey
}

// ─── Usage ─────────────────────────────────────────────────────────────────

export type LauncherUsageRecord = {
  count: number
  lastSelectedAt: number
}

export type LauncherUsageBucket = Record<SystemLauncherItemKey, LauncherUsageRecord>

export type LauncherUsageBySurface = Record<LauncherSurfaceId, LauncherUsageBucket>

// ─── Tool-First API (preferred plugin authoring layer) ───────────────────────

export type ToolLauncherOptions = {
  surfaces?: LauncherSurfaceId[]
  pinnable?: boolean
}

export type ToolPanelOptions = {
  placement?: 'bottom' | 'right' | 'left' | 'pane-bottom'
}

export type PluginToolSurfaces = {
  launcher?: boolean | ToolLauncherOptions
  panel?: boolean | ToolPanelOptions
  pinnable?: boolean
}

export type PluginToolOutput = {
  /** Default text output: shown as a result choice, Enter copies. */
  text(value: string): LauncherExecuteResult
  /** Explicit replace-active-text primary action. */
  replaceActiveText(value: string): LauncherExecuteResult
  /** Explicit error result. */
  error(message: string): LauncherExecuteResult
  /** Raw output choices for advanced flows. */
  choices(choices: LauncherResultChoice[]): LauncherExecuteResult
}

export type PluginToolContext<TSettings = unknown> = {
  input: ResolvedTextInput
  params: Record<string, unknown>
  settings: TSettings
  locale: Locale
  api: PluginLauncherApi
  storage: PluginPrivateStorageApi
  t: (key: string, vars?: Record<string, string | number>) => string
  output: PluginToolOutput
}

export type PluginToolResult = LauncherExecuteResult

export type PluginToolContribution<TSettings = unknown> = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  subtitleI18n?: Partial<Record<Locale, string>>
  icon?: IconRef
  aliases?: string[]
  inputPolicy?: TextInputPolicy
  params?: LauncherParamSpec[]
  defaultParams?: Record<string, unknown>
  /** When true, launcher selection prompts for params even when defaults exist. */
  requireParamSelection?: boolean
  run(ctx: PluginToolContext<TSettings>): Promise<PluginToolResult> | PluginToolResult
  surfaces?: PluginToolSurfaces
}

// ─── Panel Action Model (separate surface) ───────────────────────────────────

export type PanelInputPolicy = TextInputPolicy

export type ResolvedPanelInput = ResolvedTextInput

export type PanelActionApi = {
  getClipboardText(): Promise<string>
  copyText(text: string): Promise<void>
  replaceInputText(text: string, range?: TextRange): Promise<void>
  insertText(text: string): Promise<void>
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
}

export type PanelActionContext<TSettings = unknown> = {
  panelId: string
  paneId?: string
  settings: TSettings
  locale: Locale
  input: ResolvedPanelInput
  api: PanelActionApi
}

export type PanelActionResult =
  | { ok: true }
  | { ok: false; message: string }

export type PanelActionContribution<TSettings = unknown> = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  icon?: IconRef
  inputPolicy?: PanelInputPolicy
  run(ctx: PanelActionContext<TSettings>): Promise<PanelActionResult> | PanelActionResult
}

// ─── Settings body props (re-exported for plugin-local settings UIs) ─────────

export type LauncherSettingsContext = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  locale: Locale
}

export type { ComponentType }
