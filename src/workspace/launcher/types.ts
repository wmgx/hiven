/**
 * Launcher Domain Types
 *
 * The launcher is a host/workspace domain centered on `LauncherItem`, shared by
 * EditorCommandBar and GlobalLauncher. Plugins contribute launcher items (or tools
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
import type { PluginNetworkApi, PluginPrivateStorageApi, PluginShellApi } from '../pluginTypes'
import type { FluxEffect } from '../types'
import type { DiffSourcePayload } from '../diffTypes'
import type { EffectRunnerResult } from '../effectRunner'
import type { ContentAccepts, IntentHit, IntentMatchContext } from './intentTypes'

export type { ContentAccepts, IntentHit, IntentMatchContext } from './intentTypes'

// ─── System Surfaces ───────────────────────────────────────────────────────

export type LauncherHostId = 'global-launcher' | 'editor-command-bar' | 'quick-editor-command'

/** `command-palette` is retained as a legacy alias for `editor-command-bar`. */
export type LauncherSurfaceId = LauncherHostId | 'command-palette'

export type InputBinding = 'selection' | 'active-text' | 'prompt'
export type SaveableParamValue = boolean | number | string | string[]
export type CommitVia = 'execute' | 'preview-choice' | 'suggestion' | 'saved-action'

export type SaveableRunSnapshot = {
  inputBinding: InputBinding
  savedParams: Record<string, SaveableParamValue>
  contractFingerprint: string
}

export type CommittedRunContext = {
  runId: string
  actionKey: string
  surfaceId: LauncherSurfaceId
  via: CommitVia
  inputBinding?: InputBinding
  saveSnapshot?: SaveableRunSnapshot
}

export type LauncherHostCapability =
  | 'app-search'
  | 'plugin-surfaces'
  | 'host-surfaces'
  | 'settings'
  | 'text-input-actions'
  | 'pane-actions'
  | 'system-power'
  | 'parameter-customization'
  | 'desktop-windows'
  | 'desktop-processes'
  | 'desktop-browser-tabs'

export type LauncherHostDescriptor = {
  id: LauncherHostId
  capabilities: readonly LauncherHostCapability[]
}

export type LauncherHostConfig = LauncherHostDescriptor & {
  presentation: 'spotlight-window' | 'editor-overlay'
  placeholderKey: 'globalPlaceholder' | 'placeholder'
}

export const LAUNCHER_HOSTS: Record<LauncherHostId, LauncherHostConfig> = {
  'global-launcher': {
    id: 'global-launcher',
    presentation: 'spotlight-window',
    placeholderKey: 'globalPlaceholder',
    capabilities: [
      'app-search',
      'plugin-surfaces',
      'host-surfaces',
      'settings',
      'text-input-actions',
      'pane-actions',
      'system-power',
      'parameter-customization',
      'desktop-windows',
      'desktop-processes',
      'desktop-browser-tabs',
    ],
  },
  'editor-command-bar': {
    id: 'editor-command-bar',
    presentation: 'editor-overlay',
    placeholderKey: 'placeholder',
    capabilities: [
      'text-input-actions',
      'pane-actions',
      'parameter-customization',
    ],
  },
  'quick-editor-command': {
    id: 'quick-editor-command',
    presentation: 'editor-overlay',
    placeholderKey: 'placeholder',
    capabilities: [
      'text-input-actions',
      'pane-actions',
      'parameter-customization',
    ],
  },
}

export function launcherHostHasCapability(
  hostId: LauncherHostId,
  capability: LauncherHostCapability,
): boolean {
  return LAUNCHER_HOSTS[hostId].capabilities.includes(capability)
}

export function getLauncherHostConfig(hostId: LauncherHostId): LauncherHostConfig {
  return LAUNCHER_HOSTS[hostId]
}

export const LAUNCHER_SURFACE_IDS: readonly LauncherSurfaceId[] = [
  'command-palette',
  'editor-command-bar',
  'global-launcher',
  'quick-editor-command',
] as const

export function isLauncherSurfaceId(value: unknown): value is LauncherSurfaceId {
  return value === 'command-palette' || value === 'editor-command-bar' || value === 'global-launcher' || value === 'quick-editor-command'
}

export function normalizeLauncherSurfaceId(surfaceId: LauncherSurfaceId): LauncherHostId {
  return surfaceId === 'command-palette' ? 'editor-command-bar' : surfaceId
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
  /** Custom kind label shown as the tag pill. Overrides the default derived label. */
  kindLabel?: string
  /** i18n for kindLabel (design §5.1); UI resolves by locale when present. */
  kindLabelI18n?: Partial<Record<Locale, string>>
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
  /** Explicit opt-in for persisting this parameter in a Saved Action. */
  saveable?: boolean
  /** Required upper bound for saveable text parameters. */
  saveableMaxLength?: number
}

export type ActionEffect = 'pure' | 'read' | 'local-write' | 'external-write' | 'destructive' | 'unknown'

export type ToolActionPolicy = {
  effect: ActionEffect
  learnable: boolean
}

export const DEFAULT_TOOL_ACTION_POLICY: ToolActionPolicy = {
  effect: 'unknown',
  learnable: false,
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
  /** Icon shown in place of the generic "×" glyph; omit for destructive actions (close/delete). */
  icon?: IconRef
  run: LauncherResultActionHandler
}

export type OutputIntent =
  | 'copy'
  | 'replace-active-text'
  | 'insert'
  | 'return-to-launcher'
  | 'open-quick-editor'

export type WorkflowObjectItemMetadata = {
  kind: 'workflow-object'
  objectId: string
  objectType: string
}

export type WorkflowActionChoiceMetadata = {
  kind: 'workflow-action'
  objectId: string
  actionId: string
  outputTarget?: string
}

export type LauncherItemMetadata = WorkflowObjectItemMetadata

export type LauncherResultChoiceMetadata = WorkflowActionChoiceMetadata

export type LauncherResultChoice = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  subtitleI18n?: Partial<Record<Locale, string>>
  /** Optional leading icon (e.g. site favicon for history suggestions). */
  icon?: IconRef
  /**
   * Visual tone for L2 choice rows (confirm dialogs).
   * `danger` = destructive primary; `muted` = cancel / secondary.
   */
  tone?: 'default' | 'danger' | 'muted'
  preview?: string
  metadata?: LauncherResultChoiceMetadata
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
    panes: Record<string, {
      title?: string
      language?: string
      stickyScroll?: boolean
      /** Snapshot text content when available (e.g. quick-editor panes). */
      text?: string
      /** Where this pane lives; plugins use it for choice labels. */
      origin?: 'editor' | 'quick-editor'
    }>
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
  /**
   * Hand text back to the surface that can turn it into a first-class object
   * (e.g. Global Launcher's Object Block). Surfaces with no such concept (Quick
   * Editor command bar) fall back to the same behavior as insertText.
   */
  returnToLauncher(text: string): Promise<void>
  copyText(text: string): Promise<void>
  openUrl(url: string): Promise<void>
  showEditorWindow(): Promise<string | undefined>
  showPluginsPage(): Promise<void>
  showSettingsPage(): Promise<void>
  createPane(options?: { text?: string; title?: string; language?: string; focus?: boolean; direction?: 'left' | 'right' | 'top' | 'bottom' }): Promise<string | undefined>
  dispatchEffects(effects: FluxEffect[]): EffectRunnerResult
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
  /** Open text-diff plugin surface with two sides (product UI is the plugin). */
  openDiffPage(payload: { original: DiffSourcePayload; modified: DiffSourcePayload }): void
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

/**
 * Optional collect-input suggestions (e.g. per-entry query history).
 * Host calls this when the collect-input frame is entered or inputText changes.
 * Return empty choices / null to hide the list.
 */
export type LauncherSuggestContext<TSettings = unknown> = {
  surfaceId: LauncherSurfaceId
  inputText: string
  settings: TSettings
  locale: Locale
  api: PluginLauncherApi
  storage: PluginPrivateStorageApi
  network: PluginNetworkApi
  shell: PluginShellApi
  t: (key: string, vars?: Record<string, string | number>) => string
  /** Plugin identity for storage-scoped assets (e.g. favicon blob refs). */
  pluginId?: string
  source?: 'builtin' | 'installed' | 'dev'
}

export type LauncherSuggestHandler<TSettings = unknown> = (
  ctx: LauncherSuggestContext<TSettings>,
) => Promise<LauncherOutput | null | undefined> | LauncherOutput | null | undefined

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
  /** Host-reserved key for explicit built-in host entries such as plugin settings. */
  hostEntry?: 'plugin-settings'
  /** Restrict where the item appears. Missing = both main surfaces. */
  surfaces?: LauncherSurfaceId[]
  inputPolicy?: TextInputPolicy
  params?: LauncherParamSpec[]
  defaultParams?: Record<string, unknown>
  /** When true, selecting the item always opens the parameter flow before execution. */
  requireParamSelection?: boolean
  /**
   * Opt into long-term usage recording for dynamic items with stable ids.
   * Static plugin/host items always record unless the host suppresses via select options.
   * Dynamic items default to false (one-shot / content-derived results).
   */
  recordUsage?: boolean
  /**
   * Declarative intent coarse filter. Host copies this onto the resolved item
   * for ranking / accepts evaluation (static tools already carry accepts).
   */
  accepts?: ContentAccepts
  /**
   * Optional intent fine matcher (filter semantics). Only invoked after accepts
   * hits; empty/null/throw/timeout → no intent boost. Copied onto resolved item.
   */
  match?: (ctx: IntentMatchContext) => IntentHit[] | null
  /**
   * Declare that this item is a computed ANSWER for the current input rather
   * than a command to pick (its title is the result). Exempts it from the
   * query-present text filter.
   *
   * Boolean by design: the ranking nudge is host-assigned. If plugins could set
   * their own answer priority, every plugin would claim to be the top answer —
   * the same reason `staticPriority` is host-only.
   */
  directAnswer?: boolean
  /**
   * Content matcher for ranking boost (textMatchBoost). Same field as tools.
   */
  textMatch?: (text: string) => boolean
  /**
   * Optional suggestions for collect-input frames (filtered by current inputText).
   * Host infrastructure only — product semantics (history, etc.) stay in the plugin.
   */
  suggest?: LauncherSuggestHandler<TSettings>
  execute: LauncherExecuteHandler<TSettings>
  executeWithParams?: LauncherExecuteWithParamsHandler<TSettings>
}

// ─── Dynamic Items ───────────────────────────────────────────────────────────

export type LauncherDynamicContext = {
  /** Host-resolved input text. Plugins do not need to know whether it came from typed query or Object Block. */
  query: string
  surfaceId: LauncherSurfaceId
  locale: Locale
  settings: unknown
  api: PluginLauncherApi
  storage: PluginPrivateStorageApi
  network: PluginNetworkApi
  shell: PluginShellApi
  t: (key: string, vars?: Record<string, string | number>) => string
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
  /**
   * Abort when the query changes or the session tears down.
   * Providers should check signal.aborted and ideally pass it to network work.
   */
  signal?: AbortSignal
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
  /** Product-level provider name, e.g. JSON Tools, not the raw plugin id. */
  productProvider?: string
  source?: 'builtin' | 'installed' | 'dev'
  display: LauncherItemDisplay
  behavior: LauncherBehavior
  surfaces?: LauncherSurfaceId[]
  inputPolicy?: TextInputPolicy
  /** Tool behavior metadata. Missing means {@link DEFAULT_TOOL_ACTION_POLICY}. */
  actionPolicy?: ToolActionPolicy
  /** Stable behavior contract hash; labels and saveability metadata are excluded. */
  contractFingerprint?: string
  /** Saved Action projections enter the same Commit Gate with a distinct source. */
  commitVia?: CommitVia
  /** Journal-management commands use the gate but do not journal themselves. */
  experienceRecord?: boolean
  /** Host-only ranking nudge for a small number of host-owned items. */
  staticPriority?: number
  /** Host-owned ranking metadata. Plugins never construct resolved launcher items. */
  ranking?: {
    /** Milliseconds since epoch; used as a small freshness boost for recently installed apps. */
    installedAt?: number
    /**
     * Source-level boost from DesktopTargetProvider.priority (clamped ≤ 50).
     * Host-owned; see desktopTargets/constants.ts PROVIDER_PRIORITY_CAP.
     */
    providerPriorityBoost?: number
    /**
     * Optional per-item score bias from DesktopTarget.scoreBias (clamped |bias| ≤ 500).
     * Product policy lives on the provider; host only applies the clamp.
     */
    scoreBias?: number
  }
  /**
   * Host-only legacy usage keys (e.g. the backing command id) consulted as a
   * fallback by ranking so pre-migration usage history is preserved. Never
   * exposed to plugins.
   */
  legacyUsageKeys?: string[]
  /** Host-owned parameter schema for system adapters that support Cmd/Ctrl+Enter customization. */
  params?: LauncherParamSpec[]
  requiredCapabilities?: LauncherHostCapability[]
  preferredCapabilities?: LauncherHostCapability[]
  metadata?: LauncherItemMetadata
  /** Explicit default values used when entering the parameter form. */
  defaultParams?: Record<string, unknown>
  /** Host-owned execution policy: defaults can prefill UI but must not skip parameter selection. */
  requireParamSelection?: boolean
  /** Content matcher: returns true if this tool can process the given text. Boosted in ranking. */
  textMatch?: (text: string) => boolean
  /**
   * Declarative intent coarse filter (host pure-data evaluation).
   * Runtime field only — not serialized across process boundaries.
   */
  accepts?: ContentAccepts
  /**
   * Optional intent fine matcher; only invoked after accepts hits.
   * Runtime function field (same lifetime as textMatch).
   */
  match?: (ctx: IntentMatchContext) => IntentHit[] | null
  /**
   * Marks this item as a computed ANSWER for the current input rather than a
   * command to pick — the "input → result, no command step" paradigm.
   *
   * Ranking treats it as first-class in two ways (see ranking.ts):
   *  - it is exempt from the query-present text filter, because an answer's
   *    title IS the result ("1,234" for "1000+234") and by construction does
   *    not contain the query;
   *  - its `priority` is honored regardless of `kind`, unlike `staticPriority`
   *    which is host-only.
   *
   * Both exist because answer producers previously had to fake being a matching
   * dynamic item (`kind:'dynamic'` + `aliases:[query]`), which silently zeroed
   * their priority and disabled frecency ordering. Set this instead.
   */
  directAnswer?: {
    /** Ranking nudge; clamped to the same ceiling as staticPriority. */
    priority?: number
    /**
     * Learned answers rank above built-in ones but never suppress them —
     * a stale personal rule must not bury an obviously-correct default.
     */
    origin?: 'builtin' | 'learned'
  }
  /**
   * When true, selection writes to launcher usage for ranking.
   * Dynamic items must opt in with a stable systemKey; static items omit this (treated as true).
   */
  recordUsage?: boolean
  /**
   * Host may keep a cross-session recent snapshot when true (plugin-declared
   * durable content such as contacts / chats / docs). Requires persistPayload.
   */
  persistable?: boolean
  /**
   * Snapshot used by host recents store. Only set when persistable is true.
   */
  persistPayload?: import('./persistableRecents').PersistableLauncherPayload
  /** Optional collect-input suggestions loader (host-resolved from contribution). */
  suggest?: LauncherSuggestHandler
  execute: LauncherExecuteHandler
  executeWithParams?: LauncherExecuteWithParamsHandler
}

export function filterEditorCommandBarItems(items: LauncherItem[]): LauncherItem[] {
  return items.filter(isEditorCommandBarItem)
}

export function isEditorCommandBarItem(item: LauncherItem): boolean {
  if (item.systemKey.startsWith('plugin-settings:')) return false
  if (item.kind !== 'host') return true
  const surfaces = item.surfaces?.map(normalizeLauncherSurfaceId)
  if (surfaces?.length && !surfaces.includes('editor-command-bar')) return false
  return (
    item.systemKey.startsWith('host:pane:') ||
    item.systemKey.startsWith('host:editor:') ||
    item.systemKey.startsWith('host:text:') ||
    item.systemKey.startsWith('host:pipeline:') ||
    // host:view:devtools opts into editor-command-bar/quick-editor-command via
    // its own `surfaces` (see hostActions.ts) so it can debug those windows —
    // the surfaces check above already scopes this, this only widens the prefix.
    item.systemKey.startsWith('host:view:')
  )
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
}

export type ToolPanelOptions = {
  placement?: 'bottom' | 'right' | 'left' | 'pane-bottom'
}

export type PluginToolSurfaces = {
  launcher?: boolean | ToolLauncherOptions
  panel?: boolean | ToolPanelOptions
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
  /**
   * Shell runtime when the plugin requested `shell.run`.
   * Unauthorized / missing → calls throw a permission error.
   */
  shell: PluginShellApi
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
  policy?: ToolActionPolicy
  params?: LauncherParamSpec[]
  defaultParams?: Record<string, unknown>
  /** When true, launcher selection prompts for params even when defaults exist. */
  requireParamSelection?: boolean
  /**
   * Content matcher: returns true if this tool can process the given text.
   * Used for both clipboard content and direct user input in the launcher.
   * Matched tools are boosted to the top of the command list.
   */
  textMatch?: (text: string) => boolean
  /**
   * Declarative intent coarse filter. Host evaluates without running plugin code.
   * Missing accepts → tool does not participate in intent recommendation.
   */
  accepts?: ContentAccepts
  /**
   * Optional fine-grained intent matcher. Only called after accepts hits.
   * Synchronous, local, budgeted by the host intent engine.
   */
  match?: (ctx: IntentMatchContext) => IntentHit[] | null
  /**
   * Declare that this tool's result IS the answer to the current input, not a
   * command to pick — same semantics as {@link LauncherItemContribution.directAnswer}.
   * Boolean by design; the ranking nudge is host-assigned (see normalizeContribution.ts).
   */
  directAnswer?: boolean
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
