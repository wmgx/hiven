/**
 * hiven Plugin System - Type Definitions
 * Defines types for the plugin system: CommandContribution, RendererContribution,
 * PanelContribution, PluginDefinition, and related types.
 */

import type { ComponentType } from 'react'
import type { Locale } from '../i18n'
import type { FluxEffect, PaneId } from './types'

// ─── Input Types ─────────────────────────────────────────────────────────────

export type InputSlotKind = 'pane' | 'text' | 'clipboard'

export type InputSlot = {
  key: string
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  kind: InputSlotKind
  required: boolean
}

export type InputResolutionStrategy = 'use-active' | 'auto-fill' | 'always-prompt'

export type InputResolution = {
  strategy: InputResolutionStrategy
  fallback: 'prompt' | 'fail'
}

// ─── Resolved Input Values ────────────────────────────────────────────────────

export type PaneInput = {
  kind: 'pane'
  paneId: PaneId
  text: string
  title?: string
  language?: string
  stickyScroll?: boolean
}

export type TextInput = {
  kind: 'text'
  text: string
  paneId?: PaneId
}

export type ResolvedInputs = Record<string, PaneInput | TextInput>

// ─── Param Types ──────────────────────────────────────────────────────────────

export type ParamType = 'boolean' | 'text' | 'number' | 'single-select' | 'multi-select'

export type CommandParam = {
  key: string
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  type: ParamType
  options?: string[] | { label: string; value: string; labelI18n?: Partial<Record<Locale, string>> }[]
  default?: unknown
  required?: boolean
  hint?: string
  hintI18n?: Partial<Record<Locale, string>>
}

// ─── Command Contribution ─────────────────────────────────────────────────────

/** Context passed to command.run */
export type PluginCommandContext = {
  inputs: ResolvedInputs
  params: Record<string, unknown>
  settings?: unknown
}

// ─── Command Output Types ────────────────────────────────────────────────────

export type PluginCommandTextOutput = {
  kind: 'text'
  text: string
}

export type PluginCommandErrorOutput = {
  kind: 'error'
  text: string
}

export type PluginCommandOutput = PluginCommandTextOutput | PluginCommandErrorOutput

/** Result returned by command.run */
export type PluginCommandResult = {
  output?: PluginCommandOutput
  effects?: FluxEffect[]
}

export type TextCommandSurfaces = {
  quickText?: false | {
    enabled?: boolean
    trigger?: 'on-input' | 'manual'
    debounceMs?: number
    defaultParams?: Record<string, unknown>
  }
}

export type LiveActionCapability = {
  pinnable?: boolean
  live?: {
    enabled: boolean
    debounceMs?: number
    trigger?: 'on-input' | 'manual' | 'on-blur'
    sideEffects: 'none' | 'read-only' | 'writes'
  }
  controls?: {
    panelId: string
    placement: 'bottom' | 'right' | 'left' | 'floating'
    defaultOpen?: boolean
  }
}

/** New-model command contribution from a plugin */
export type CommandContribution = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  aliases?: string[]
  icon?: string
  inputs?: InputSlot[]
  inputResolution?: InputResolution
  params?: CommandParam[]
  optionalParams?: boolean
  live?: LiveActionCapability
  surfaces?: TextCommandSurfaces
  run(ctx: PluginCommandContext): PluginCommandResult | Promise<PluginCommandResult>
}

// ─── Renderer Contribution ────────────────────────────────────────────────────

/** API exposed to renderer components */
export type RendererHostApi = {
  /** Close this renderer (clears pane renderer state) */
  close: () => void
  /** Mark a pane as active from inside a renderer surface */
  focusPane: (paneId: PaneId) => void
  /** Update pane text from an editable renderer surface */
  updatePaneText: (paneId: PaneId, text: string) => void
  /** Dispatch effects from within the renderer */
  dispatch: (effects: FluxEffect[]) => void
}

/** Props passed to renderer components (push model) */
export type RendererProps<TInputs = unknown> = {
  inputs: TInputs
  surfaceId: string
  host: RendererHostApi
}

/** Renderer contribution registered by a plugin */
export type RendererContribution = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  /** Where this renderer should occupy UI space. Defaults to pane. */
  surface?: 'pane' | 'workspace'
  inputKinds?: InputSlotKind[]
  component: ComponentType<RendererProps<unknown>>
}

// ─── Panel Contribution ───────────────────────────────────────────────────────

/** API exposed to panel components */
export type PanelHostApi = {
  close: () => void
  dispatch: (effects: FluxEffect[]) => void
}

/** Props passed to panel components */
export type PanelPropsV2<TInputs = unknown> = {
  inputs: TInputs
  panelId: string
  host: PanelHostApi
}

/** Panel contribution (new model) */
export type PanelContributionV2 = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  defaultPlacement?: 'bottom' | 'right' | 'left' | 'pane-bottom'
  /** Custom height for bottom panels (e.g. '36px' for compact bars). Defaults to '240px'. */
  height?: string
  component: ComponentType<PanelPropsV2<unknown>>
}

// ─── Toolbar Contribution ─────────────────────────────────────────────────────

/** Toolbar regions a plugin can contribute buttons to */
export type ToolbarPlacement = 'editor-top-right'

/** A toolbar button contributed by a plugin. Clicking runs an existing command. */
export type ToolbarContribution = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  icon?: string
  /** Id of the command to execute on click (with default params). */
  commandId: string
  /** Toolbar region this button belongs to. Defaults to editor-top-right. */
  placement?: ToolbarPlacement
  /** Sort weight within the region; smaller comes first. */
  order?: number
}

// ─── Instant Suggestion Contribution ─────────────────────────────────────────

/** Context passed to an instant suggestion provider */
export type InstantSuggestionContext = {
  query: string
  locale: Locale
  /** Plugin-scoped translate function. Resolves keys from the plugin's locales/ dictionaries. */
  t: (key: string, vars?: Record<string, string | number>) => string
}

/** Action to perform when user selects an instant suggestion */
export type InstantSuggestionAction =
  | { type: 'copy'; text: string }
  | { type: 'insert'; text: string }
  | { type: 'effects'; effects: FluxEffect[] }

/** A single instant suggestion result */
export type InstantSuggestion = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  subtitleI18n?: Partial<Record<Locale, string>>
  value: string
  icon?: string
  actionLabel?: string
  actionLabelI18n?: Partial<Record<Locale, string>>
  action: InstantSuggestionAction
}

/** An instant suggestion provider contributed by a plugin */
export type InstantSuggestionProvider = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  priority?: number
  suggest(ctx: InstantSuggestionContext): InstantSuggestion | InstantSuggestion[] | null
}

// ─── Plugin Settings ─────────────────────────────────────────────────────────

export type PluginSettingsBodyProps<TSettings = unknown> = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  value: TSettings
  defaultValue: TSettings
  setValue: (next: TSettings) => void
  updateValue: (patch: Partial<TSettings>) => void
  resetValue: () => void
  openExternal: (url: string) => Promise<void>
}

export type PluginSettingsContribution<TSettings = unknown> = {
  title?: string
  titleI18n?: Partial<Record<Locale, string>>
  version?: number
  defaultValue: TSettings
  migrate?: (stored: unknown, fromVersion: number) => TSettings
  component: ComponentType<PluginSettingsBodyProps<TSettings>>
}

// ─── Launcher Quick Entry ────────────────────────────────────────────────────

export type LauncherQuickEntryContext = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  locale: Locale
  settings: unknown
}

export type LauncherQuickEntry = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  subtitle?: string
  subtitleI18n?: Partial<Record<Locale, string>>
  icon?: string
  aliases: string[]
  placeholder?: string
  placeholderI18n?: Partial<Record<Locale, string>>
  allowEmptyInput?: boolean
  emptyInputMessage?: string
  emptyInputMessageI18n?: Partial<Record<Locale, string>>
  run(input: string, ctx: LauncherQuickEntryContext): PluginCommandResult | Promise<PluginCommandResult>
}

export type LauncherQuickEntryProvider = {
  getEntries(ctx: { settings: unknown; locale: Locale }): LauncherQuickEntry[]
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

/** The full plugin definition returned by definePlugin */
export type PluginDefinition<TSettings = unknown> = {
  commands?: CommandContribution[]
  renderers?: RendererContribution[]
  panels?: PanelContributionV2[]
  toolbar?: ToolbarContribution[]
  instantSuggestions?: InstantSuggestionProvider[]
  settings?: PluginSettingsContribution<TSettings>
  launcherQuickEntries?: LauncherQuickEntryProvider
}

// ─── Plugin Manifest ──────────────────────────────────────────────────────────

/** manifest.json structure for a plugin package */
export type PluginManifest = {
  pluginId: string
  displayName?: string
  displayNameI18n?: Partial<Record<Locale, string>>
  version?: string
  capabilities?: string[]
}

// ─── Plugin Runtime State ─────────────────────────────────────────────────────

export type InstalledPluginStatus = 'disabled' | 'enabled' | 'error' | 'loading'
export type PluginPackageSource = 'local' | 'github' | 'zip' | 'builtin'

export type PluginPackageUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'up-to-date' | 'error'
  latestVersion?: string
  checkedAt?: number
  error?: string
}

/** Persisted record for an installed (production) plugin */
export type InstalledPlugin = {
  pluginId: string
  displayName: string
  displayNameI18n?: Partial<Record<Locale, string>>
  version: string
  entry: string
  capabilities: string[]
  folderPath: string
  packagePath?: string
  source: 'local' | 'github' | 'zip' | 'builtin'
  sourceUrl?: string
  status: InstalledPluginStatus
  error?: string
  update?: PluginPackageUpdateState
  installedAt: number
  updatedAt: number
}

/** Session-scoped dev plugin (not persisted) */
export type DevPlugin = {
  pluginId: string
  displayName: string
  displayNameI18n?: Partial<Record<Locale, string>>
  version: string
  folderPath: string
  packagePath?: string
  source?: PluginPackageSource
  sourceUrl?: string
  capabilities?: string[]
  status: 'active' | 'error'
  error?: string
  loadedAt: number
  updatedAt?: number
  /** Whether this dev plugin has an active file watcher for auto-reload */
  watching?: boolean
}

export type PluginFileTree = {
  name: string
  path: string
  isDir: boolean
  children?: PluginFileTree[]
}

// ─── Contribution Source ──────────────────────────────────────────────────────

export type ContributionSource = 'production' | 'dev'

/** Metadata attached to a registered contribution */
export type ContributionMeta = {
  pluginId: string
  source: ContributionSource
}

// ─── Plugin Index ─────────────────────────────────────────────────────────────

/** Computed index for a loaded plugin (from PluginDefinition) */
export type InstalledPluginIndex = {
  pluginId: string
  commands: string[]
  renderers: string[]
  panels: string[]
}

// Re-export surface state types from types.ts for convenience
export type { PaneRendererState, PanelInstanceV2 } from './types'
