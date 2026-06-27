/**
 * hiven Plugin System - Type Definitions
 * Defines types for the plugin system: CommandContribution, RendererContribution,
 * PanelContribution, PluginDefinition, and related types.
 */

import type { ComponentType } from 'react'
import type { Locale } from '../i18n'
import type { FluxEffect, PaneId } from './types'
import type {
  LauncherItemContribution,
  LauncherDynamicItemProvider,
  PluginToolContribution,
  PanelActionContribution,
  PluginLauncherApi,
} from './launcher/types'

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
  options?: string[] | { label: string; value: string; labelI18n?: Partial<Record<Locale, string>>; description?: string; descriptionI18n?: Partial<Record<Locale, string>> }[]
  default?: unknown
  required?: boolean
  hint?: string
  hintI18n?: Partial<Record<Locale, string>>
  /** For multi-select params: minimum selected items required before submit. */
  minSelect?: number
  /** For multi-select params: maximum selected items. */
  maxSelect?: number
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
  /** @deprecated Launcher parameter customization is inferred from params with explicit defaults. */
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
  /** Set a short status label shown in the global status bar while this renderer is active. */
  setStatus: (label: string | null, level?: 'info' | 'error') => void
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

// ─── Plugin Settings ─────────────────────────────────────────────────────────

export type PluginSettingsBodyProps<TSettings = unknown> = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  locale: Locale
  t: (key: string, vars?: Record<string, string | number>) => string
  value: TSettings
  defaultValue: TSettings
  setValue: (next: TSettings) => void
  updateValue: (patch: Partial<TSettings>) => void
  resetValue: () => void
  openExternal: (url: string) => Promise<void>
  host: PluginSettingsHostApi
}

export type PluginSettingsModalBodyProps<TSettings = unknown> = PluginSettingsBodyProps<TSettings> & {
  modalId: string
  close: () => void
}

export type PluginSettingsHostApi = {
  permissions: PluginPermissionSnapshot
  storage: PluginPrivateStorageApi
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
}

export type PluginSettingsOption = {
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  value: string
}

export type PluginSettingsOptionSource = {
  listKey: string
  valueKey: string
  labelKey?: string
  fallbackLabelKey?: string
}

export type PluginSettingsCondition = {
  key: string
  equals?: unknown
  notEquals?: unknown
  in?: unknown[]
  truthy?: boolean
}

export type PluginSettingsPresetNumberOption = {
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  value: number
}

export type PluginSettingsObjectListGroup = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  collapsed?: boolean
}

export type PluginSettingsFieldBase<TSettings = unknown> = {
  key: keyof TSettings & string
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  icon?: string
  requires?: PluginPermission[]
  disabled?: boolean
}

export type PluginSettingsSwitchField<TSettings = unknown> = PluginSettingsFieldBase<TSettings> & {
  kind: 'switch'
}

export type PluginSettingsNumberField<TSettings = unknown> = PluginSettingsFieldBase<TSettings> & {
  kind: 'number'
  min?: number
  max?: number
  step?: number
  unit?: string
  unitI18n?: Partial<Record<Locale, string>>
  /** Multiplies the displayed number before storing it, e.g. 1048576 for MB-backed byte fields. */
  storageScale?: number
}

export type PluginSettingsSelectField<TSettings = unknown> = PluginSettingsFieldBase<TSettings> & {
  kind: 'select'
  options: PluginSettingsOption[]
  optionsFromList?: PluginSettingsOptionSource
}

export type PluginSettingsTextField<TSettings = unknown> = PluginSettingsFieldBase<TSettings> & {
  kind: 'text'
  placeholder?: string
  placeholderI18n?: Partial<Record<Locale, string>>
  mono?: boolean
}

export type PluginSettingsTextareaField<TSettings = unknown> = PluginSettingsFieldBase<TSettings> & {
  kind: 'textarea'
  placeholder?: string
  placeholderI18n?: Partial<Record<Locale, string>>
  rows?: number
  mono?: boolean
}

export type PluginSettingsListField<TSettings = unknown> = PluginSettingsFieldBase<TSettings> & {
  kind: 'list'
}

export type PluginSettingsObjectListItemField = {
  key: string
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  kind: 'text' | 'number' | 'preset-number' | 'secret' | 'textarea' | 'switch' | 'select' | 'string-list' | 'callout'
  placeholder?: string
  placeholderI18n?: Partial<Record<Locale, string>>
  rows?: number
  options?: PluginSettingsOption[]
  presets?: PluginSettingsPresetNumberOption[]
  mono?: boolean
  sensitive?: boolean
  wide?: boolean
  inline?: boolean
  groupId?: string
  visibleWhen?: PluginSettingsCondition
  required?: boolean
  requiredWhen?: PluginSettingsCondition
  tone?: 'info' | 'warning' | 'danger'
}

export type PluginSettingsObjectListSummaryField = {
  key: string
  label?: string
  labelI18n?: Partial<Record<Locale, string>>
  emptyText?: string
  emptyTextI18n?: Partial<Record<Locale, string>>
}

export type PluginSettingsObjectListField<TSettings = unknown> = PluginSettingsFieldBase<TSettings> & {
  kind: 'object-list'
  display?: 'cards' | 'master-detail'
  detailColumns?: 1 | 2
  itemLabel?: string
  itemLabelI18n?: Partial<Record<Locale, string>>
  itemTitleKey?: string
  addLabel?: string
  addLabelI18n?: Partial<Record<Locale, string>>
  emptyText?: string
  emptyTextI18n?: Partial<Record<Locale, string>>
  itemDefaults?: Record<string, unknown>
  summaryFields?: PluginSettingsObjectListSummaryField[]
  groups?: PluginSettingsObjectListGroup[]
  fields: PluginSettingsObjectListItemField[]
}

export type PluginSettingsModalContribution<TSettings = unknown> = {
  id: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  width?: number
  height?: number
  component: ComponentType<PluginSettingsModalBodyProps<TSettings>>
}

export type PluginSettingsModalField<TSettings = unknown> = Omit<PluginSettingsFieldBase<TSettings>, 'key'> & {
  kind: 'modal'
  id: string
  modalId?: string
  surfaceId?: string
  buttonLabel?: string
  buttonLabelI18n?: Partial<Record<Locale, string>>
  component?: ComponentType<PluginSettingsModalBodyProps<TSettings>>
}

export type PluginSettingsField<TSettings = unknown> =
  | PluginSettingsSwitchField<TSettings>
  | PluginSettingsNumberField<TSettings>
  | PluginSettingsSelectField<TSettings>
  | PluginSettingsTextField<TSettings>
  | PluginSettingsTextareaField<TSettings>
  | PluginSettingsListField<TSettings>
  | PluginSettingsObjectListField<TSettings>
  | PluginSettingsModalField<TSettings>

export type PluginSettingsSection<TSettings = unknown> = {
  id: string
  title?: string
  titleI18n?: Partial<Record<Locale, string>>
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  fields: PluginSettingsField<TSettings>[]
}

export type PluginSettingsSchema<TSettings = unknown> = {
  sections: PluginSettingsSection<TSettings>[]
}

export type PluginSettingsContribution<TSettings = unknown> = {
  title?: string
  titleI18n?: Partial<Record<Locale, string>>
  version?: number
  defaultValue: TSettings
  migrate?: (stored: unknown, fromVersion: number) => TSettings
  schema?: PluginSettingsSchema<TSettings>
  modals?: PluginSettingsModalContribution<TSettings>[]
  component?: ComponentType<PluginSettingsBodyProps<TSettings>>
}

// ─── Launcher Quick Entry ────────────────────────────────────────────────────
// Removed: migrated to launcher.items (see src/workspace/launcher/types.ts).

// ─── Plugin Permission Types ─────────────────────────────────────────────────

export type PluginPermission =
  | 'clipboard.read'
  | 'clipboard.write'
  | 'clipboard.watch'
  | 'clipboard.image'
  | 'clipboard.files'
  | 'storage.private'
  | 'storage.blob'
  | 'app.discover'
  | 'app.launch'
  | 'globalShortcut.register'
  | 'accessibility.paste'
  | 'network.request'

export type PluginPermissionGrant = {
  granted: boolean
  grantedAt?: number
  deniedAt?: number
}

export type PluginPermissionSnapshot = Record<PluginPermission, PluginPermissionGrant>

// ─── Plugin Private Storage API ──────────────────────────────────────────────

export type PluginBlobRef = {
  blobId: string
  byteSize: number
  contentType: string
}

export type PluginStoragePrunePolicy = {
  maxItems?: number
  maxBytes?: number
  maxAgeDays?: number
}

export type PluginPrivateStorageApi = {
  kv: {
    get<T = unknown>(key: string): Promise<T | undefined>
    set<T = unknown>(key: string, value: T): Promise<void>
    delete(key: string): Promise<void>
    list(prefix?: string): Promise<Array<{ key: string; updatedAt: number }>>
  }
  blob: {
    put(input: { bytes: Uint8Array; contentType: string; extension?: string }): Promise<PluginBlobRef>
    get(blobId: string): Promise<Uint8Array | undefined>
    delete(blobId: string): Promise<void>
    url(blobId: string): Promise<string>
  }
  quota: {
    usage(): Promise<{ bytes: number; itemCount: number }>
    prune(policy: PluginStoragePrunePolicy): Promise<{ removedBytes: number; removedItems: number }>
  }
}

// ─── Plugin Clipboard API ────────────────────────────────────────────────────

export type ClipboardChange =
  | {
      kind: 'text'
      text: string
      byteSize: number
      hash: string
      changedAt: number
      sourceApp?: string
    }
  | {
      kind: 'image'
      blobId: string
      previewBlobId: string
      contentType: string
      byteSize: number
      width?: number
      height?: number
      hash: string
      changedAt: number
      sourceApp?: string
    }
  | {
      kind: 'files'
      paths: string[]
      fileNames: string[]
      hash: string
      changedAt: number
      sourceApp?: string
    }

export type ClipboardWatchOptions = {
  text?: boolean
  images?: boolean
  files?: boolean
  pollIntervalMs?: number
  imagePollIntervalMs?: number
  maxTextBytes?: number
  maxImageBytes?: number
}

export type PluginClipboardApi = {
  readText(): Promise<string>
  writeText(text: string): Promise<void>
  writeImage(blobId: string): Promise<void>
  writeFiles(paths: string[]): Promise<void>
  watch(options: ClipboardWatchOptions, onChange: (change: ClipboardChange) => void): Promise<() => void>
}

// ─── Plugin Paste API ────────────────────────────────────────────────────────

export type PluginPasteResult =
  | { ok: true }
  | { ok: false; fallback: 'copied'; message: string }
  | { ok: false; fallback: 'none'; message: string }

export type PluginPasteApi = {
  pasteText(text: string): Promise<PluginPasteResult>
  pasteImage(blobId: string): Promise<PluginPasteResult>
  pasteFiles(paths: string[]): Promise<PluginPasteResult>
}

// ─── Plugin Network API ─────────────────────────────────────────────────────

export type PluginNetworkRequest = {
  url: string
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  headers?: Record<string, string>
  body?: string
}

export type PluginNetworkResponse = {
  status: number
  headers: Record<string, string>
  body: string
}

export type PluginNetworkApi = {
  request(input: PluginNetworkRequest): Promise<PluginNetworkResponse>
}

// ─── Plugin UI Surface Types ─────────────────────────────────────────────────

export type PluginUiSurfaceKind = 'custom-view'

export type PluginSurfaceHostApi = {
  close(): void
  requestBack(): void
  openSettings(): void
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
  storage: PluginPrivateStorageApi
  clipboard: PluginClipboardApi
  paste: PluginPasteApi
  network: PluginNetworkApi
}

export type PluginSurfaceProps<TSettings = unknown> = {
  pluginId: string
  surfaceId: string
  locale: Locale
  t: (key: string, vars?: Record<string, string | number>) => string
  settings: TSettings
  permissions: PluginPermissionSnapshot
  host: PluginSurfaceHostApi
}

export type PluginSurfaceOpenContext<TSettings = unknown> = {
  pluginId: string
  surfaceId: string
  source: 'builtin' | 'installed' | 'dev'
  locale: Locale
  t: (key: string, vars?: Record<string, string | number>) => string
  settings: TSettings
  permissions: PluginPermissionSnapshot
  storage: PluginPrivateStorageApi
  clipboard: PluginClipboardApi
  paste: PluginPasteApi
  network: PluginNetworkApi
}

export type PluginUiSurfaceContribution<TSettings = unknown> = {
  id: string
  kind: PluginUiSurfaceKind
  instancePolicy?: 'singleton' | 'multi'
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  icon?: string
  aliases?: string[]
  component: ComponentType<PluginSurfaceProps<TSettings>>
  beforeOpen?(ctx: PluginSurfaceOpenContext<TSettings>): Promise<void> | void
  entry?: {
    launcher?: boolean
    shortcutBindable?: boolean
    recommendedShortcut?: string
    shortcutPresentation?: 'launcher' | 'window'
  }
  shell?: {
    defaultWidth?: number
    defaultHeight?: number
    minWidth?: number
    minHeight?: number
    closeOnBlur?: boolean
    destroyTimeout?: number
    resizable?: boolean
  }
}

export type PluginUiContribution<TSettings = unknown> = {
  surfaces?: PluginUiSurfaceContribution<TSettings>[]
}

// ─── Plugin Background Types ─────────────────────────────────────────────────

export type PluginBackgroundStop = () => void | Promise<void>

export type PluginBackgroundContext<TSettings = unknown> = {
  pluginId: string
  locale: Locale
  settings: TSettings
  permissions: PluginPermissionSnapshot
  storage: PluginPrivateStorageApi
  clipboard: PluginClipboardApi
  paste: PluginPasteApi
  network: PluginNetworkApi
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
}

export type PluginBackgroundContribution<TSettings = unknown> = {
  start(ctx: PluginBackgroundContext<TSettings>): Promise<PluginBackgroundStop | void> | PluginBackgroundStop | void
}

// ─── Plugin Hooks ────────────────────────────────────────────────────────────

export type PluginStartupHookContext<TSettings = unknown> = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  locale: Locale
  settings: TSettings
  permissions: PluginPermissionSnapshot
  storage: PluginPrivateStorageApi
  clipboard: PluginClipboardApi
  paste: PluginPasteApi
  network: PluginNetworkApi
  api: PluginLauncherApi
  t: (key: string, vars?: Record<string, string | number>) => string
  showMessage(message: string, level?: 'info' | 'success' | 'warning' | 'error'): void
}

export type PluginHooksContribution<TSettings = unknown> = {
  startup?(ctx: PluginStartupHookContext<TSettings>): Promise<void> | void
}

// ─── Plugin Definition ────────────────────────────────────────────────────────

/** The full plugin definition returned by definePlugin */
export type PluginDefinition<TSettings = unknown> = {
  /** Preferred tool-first authoring API (host adapts into launcher items + panel actions). */
  tools?: PluginToolContribution<TSettings>[]
  /** Launcher contributions (custom launcher lifecycle/output UX). */
  launcher?: {
    items?: LauncherItemContribution<TSettings>[]
    dynamicItems?: LauncherDynamicItemProvider
  }
  /** Panel-only actions (separate surface from launcher). */
  panel?: {
    actions?: PanelActionContribution<TSettings>[]
  }
  commands?: CommandContribution[]
  renderers?: RendererContribution[]
  panels?: PanelContributionV2[]
  toolbar?: ToolbarContribution[]
  settings?: PluginSettingsContribution<TSettings>
  /** Plugin UI surfaces (host-openable custom views). */
  ui?: PluginUiContribution<TSettings>
  /** Plugin background lifecycle (long-running tasks). */
  background?: PluginBackgroundContribution<TSettings>
  /** One-shot plugin lifecycle hooks. */
  hooks?: PluginHooksContribution<TSettings>
}

// ─── Plugin Manifest ──────────────────────────────────────────────────────────

/** manifest.json structure for a plugin package */
export type PluginManifest = {
  pluginId: string
  displayName?: string
  displayNameI18n?: Partial<Record<Locale, string>>
  version?: string
  capabilities?: string[]
  permissions?: PluginPermission[]
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
  permissions?: PluginPermission[]
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
  permissions?: PluginPermission[]
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

// Re-export launcher domain types for convenience
export type {
  LauncherSurfaceId,
  SystemLauncherItemKey,
  LauncherItemDisplay,
  LauncherBehavior,
  LauncherInputSpec,
  LauncherItemContribution,
  LauncherDynamicContext,
  LauncherDynamicItemProvider,
  LauncherExecutionContext,
  LauncherExecuteHandler,
  LauncherExecuteResult,
  LauncherOutput,
  LauncherResultChoice,
  LauncherResultAction,
  LauncherResultActionHandler,
  PluginLauncherApi,
  PluginToolContribution,
  PluginToolContext,
  PluginToolResult,
  PluginToolSurfaces,
  PluginToolOutput,
  PanelActionContribution,
  PanelActionContext,
  PanelActionResult,
  PanelActionApi,
  TextInputMode,
  TextInputPolicy,
  ResolvedTextInput,
  TextRange,
  IconRef,
} from './launcher/types'
