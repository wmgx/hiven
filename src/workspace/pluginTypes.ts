/**
 * FluxText Plugin System - Type Definitions
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
}

/** Result returned by command.run */
export type PluginCommandResult = {
  effects: FluxEffect[]
}

/** New-model command contribution from a plugin */
export type CommandContribution = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  tags?: string[]
  icon?: string
  inputs?: InputSlot[]
  inputResolution?: InputResolution
  params?: CommandParam[]
  optionalParams?: boolean
  run(ctx: PluginCommandContext): PluginCommandResult
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
  defaultPlacement?: 'bottom' | 'right' | 'left'
  component: ComponentType<PanelPropsV2<unknown>>
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

/** The full plugin definition returned by definePlugin */
export type PluginDefinition = {
  id: string
  title: string
  version: string
  commands?: CommandContribution[]
  renderers?: RendererContribution[]
  panels?: PanelContributionV2[]
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
