import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Locale } from './i18n'
import { useWorkspaceStore } from './workspace/workspaceStore'
import {
  DEFAULT_PINNED_RUNTIME_CONFIG,
  activatePinnedRuntime,
  discardPinnedTombstoneAfterPatch,
  disposePinnedRuntime,
  pruneIdlePinnedRuntimes,
  restorePinnedFromTombstone,
  tombstonePinnedRuntime,
} from './workspace/pinnedActionRuntime'
import type { PinnedRuntimeConfig as WorkspacePinnedRuntimeConfig } from './workspace/pinnedActionRuntime'
import type { LiveActionCapability } from './workspace/pluginTypes'
import { samePinnedPluginCommandIdentity } from './workspace/pinnedActionIdentity'
import { createPinnedPluginCommandAction } from './workspace/pinnedActionFactory'
import { migrateLocalStorageKey } from './utils/persistMigration'
import type {
  LauncherSurfaceId,
  LauncherUsageBySurface,
  SystemLauncherItemKey,
} from './workspace/launcher/types'
import {
  emptyUsageBySurface,
  recordSelection as recordSelectionPure,
  migrateLegacyUsage,
} from './workspace/launcher/usage'

migrateLocalStorageKey('fluxtext-settings', 'hiven-settings')

export type ViewId = 'editor' | 'scripts' | 'plugin-editor' | 'pinned-runner' | 'settings'

export type ActionUsageSource =
  | 'command-palette'
  | 'global-launcher'
  | 'pinned-runner'

export type ActionUsageBucket = {
  recentActionNames: string[]
  actionUsageCounts: Record<string, number>
}

export type PinnedOutputKind = 'text' | 'error' | 'presentation' | 'stale'
export type PinnedActionKind = 'plugin-command'

export type PinnedPluginCommandInput = {
  kind: 'plugin-command'
  actionId: string
  pluginId: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  icon?: string
  isDev?: boolean
  params?: Record<string, unknown>
  live?: LiveActionCapability
}

export interface PinnedAction {
  id: string
  kind?: PinnedActionKind
  actionId: string
  pluginId?: string
  isDev?: boolean
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  icon?: string
  inputText: string
  outputText: string
  outputKind: PinnedOutputKind
  params: Record<string, unknown>
  autoRun: boolean
  debounceMs: number
  controlsOpen: boolean
  controlPanelInstanceId?: string
  lastRunAt?: number
  lastDurationMs?: number
  lastError?: string
}

export type PinnedRuntime = import('./workspace/pinnedActionRuntime').PinnedRuntime
export type PinnedTombstone = import('./workspace/pinnedActionRuntime').PinnedTombstone
export type PinnedRuntimeConfig = {
  idleTimeoutMs: WorkspacePinnedRuntimeConfig['idleTimeoutMs']
  maxWarmRuntimes: WorkspacePinnedRuntimeConfig['maxWarmRuntimes']
}
export type PinnedTombstoneOutputSummary = {
  outputSummary?: {
    kind: 'empty' | 'text' | 'error' | 'stale'
    preview?: string
    generatedAt?: number
  }
}

export type PluginEditorState = {
  pluginId: string
  folderPath: string
  activeFile?: string
  readOnly?: boolean
  source?: 'builtin' | 'installed' | 'dev'
}

/** UI model for a command-palette parameter form field (used to normalize plugin CommandParam for rendering). */
export interface PaletteParamModel {
  key: string
  label: string
  labelI18n?: Partial<Record<Locale, string>>
  type: 'boolean' | 'text' | 'textarea' | 'number' | 'single-select' | 'multi-select'
  default?: any
  options?: { label: string; value: string; labelI18n?: Partial<Record<Locale, string>> }[] | string[]
  /** Dynamic options: called at render time to get the current option list */
  optionsFn?: () => { label: string; value: string }[]
  /** For multi-select: max items user can select. Auto-confirms when reached. */
  maxSelect?: number
  /** Hint text shown at bottom, e.g. "选择对比面板" */
  hint?: string
  hintI18n?: Partial<Record<Locale, string>>
  visibleWhen?: Record<string, any>
  required?: boolean
}

// 根据 locale 获取本地化文本，无翻译则返回默认值
export function localized(text: string, i18nMap?: Partial<Record<Locale, string>>, locale?: Locale): string {
  if (i18nMap && locale && i18nMap[locale]) return i18nMap[locale]!
  return text
}

export interface ScriptItem {
  name: string
  title: string
  description?: string
  tags?: string[]
  path?: string
  status: 'built-in' | 'loaded' | 'error'
  error?: string
  source?: string
}

export interface ConsoleLog {
  type: 'dim' | 'ok' | 'warn' | 'err'
  message: string
}

export type LastCommandStatus = {
  title: string
  status: 'running' | 'success' | 'error'
  message?: string
  updatedAt: number
}

export type AppTheme = 'dark' | 'light'
export type GlobalLauncherMode = 'full' | 'pinned-only'
export type GlobalPinnedLauncherDoubleModifier = 'Command' | 'Shift' | 'Option'
export type GlobalLauncherPosition = {
  x: number;
  y: number;
  lastDraggedAt?: number;
  screenWidth?: number;
  screenHeight?: number;
}

export type GlobalPinnedLauncherShortcut =
  | { kind: 'accelerator'; accelerator: string; registrationStatus?: string; registrationError?: string }
  | { kind: 'double-modifier'; modifier: GlobalPinnedLauncherDoubleModifier; registrationStatus?: string; registrationError?: string }
  | { kind: 'disabled'; registrationStatus?: string; registrationError?: string }

export type PluginSurfaceOpenTarget = {
  source: 'builtin' | 'installed' | 'dev'
  pluginId: string
  surfaceId: string
}

interface AppState {
  // Navigation
  activeView: ViewId
  setActiveView: (view: ViewId) => void
  pluginEditor: PluginEditorState | null
  openPluginEditor: (plugin: PluginEditorState) => void
  closePluginEditor: () => void

  // Pinned Action / Live Runner
  pinnedActions: PinnedAction[]
  activePinnedActionId: string | null
  pinnedRuntimes: Record<string, PinnedRuntime>
  pinnedTombstones: Record<string, PinnedTombstone>
  pinnedRuntimeConfig: PinnedRuntimeConfig
  pinPluginCommand: (command: PinnedPluginCommandInput) => string
  unpinAction: (pinnedId: string) => void
  reorderPinnedActions: (orderedIds: string[]) => void
  setActivePinnedAction: (pinnedId: string) => void
  activatePinnedAction: (pinnedId: string) => void
  openPinnedAction: (pinnedId: string) => void
  updatePinnedAction: (pinnedId: string, patch: Partial<PinnedAction>) => void
  updatePinnedRuntime: (pinnedId: string, patch: Partial<PinnedRuntime>) => void
  releasePinnedRuntime: (pinnedId: string, reason?: PinnedTombstone['reason']) => void
  prunePinnedRuntimes: (now?: number) => void

  // Editor
  editorText: string
  setEditorText: (text: string) => void
  editorInstance: any | null
  setEditorInstance: (editor: any) => void

  // Command Palette
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
  globalLauncherOpen: boolean
  globalLauncherMode: GlobalLauncherMode
  globalLauncherOverlay: boolean
  setGlobalLauncherOpen: (open: boolean, mode?: GlobalLauncherMode) => void
  openGlobalLauncher: (mode: GlobalLauncherMode) => void
  openGlobalLauncherOverlay: (mode: GlobalLauncherMode) => void
  pluginSurfaceToolTarget: PluginSurfaceOpenTarget | null
  openPluginSurfaceTool: (target: PluginSurfaceOpenTarget) => void
  clearPluginSurfaceTool: () => void

  // Last command status
  lastCommandStatus: LastCommandStatus | null
  setLastCommandStatus: (status: LastCommandStatus | null) => void

  // Source-scoped usage (per surface)
  actionUsageBySource: Record<ActionUsageSource, ActionUsageBucket>
  pushRecentAction: (name: string, source?: ActionUsageSource) => void

  // Launcher usage (per surface, scoped by system launcher item key)
  launcherUsageBySurface: LauncherUsageBySurface
  recordLauncherSelection: (surfaceId: LauncherSurfaceId, itemKey: SystemLauncherItemKey) => void

  // Saved params per action (for persistParams feature)
  savedActionParams: Record<string, Record<string, any>>
  saveActionParams: (actionName: string, params: Record<string, any>) => void

  // Settings
  settings: {
    watchDirectory: string
    fontSize: number
    wordWrap: boolean
    lineNumbers: boolean
    persistParams: boolean
    persistPinnedInput: boolean
    persistPinnedTombstone: boolean
    outputPreviewLimit: number
    tombstoneTtlDays: number
    theme: 'dark' | 'light'
    locale: Locale
    disabledBuiltins: string[]
    disabledCustoms: string[]
    globalPinnedLauncherShortcut: GlobalPinnedLauncherShortcut
    globalLauncherWindowPosition?: GlobalLauncherPosition
    globalLauncherWindowPositionSource?: 'user'
  }
  updateSetting: (key: string, value: any) => void
  toggleBuiltinDisabled: (name: string) => void
  toggleCustomDisabled: (name: string) => void
  locale: Locale
  setLocale: (locale: Locale) => void
}

function serializePinnedTombstones(state: AppState): Record<string, PinnedTombstone> {
  const ttlMs = Math.max(0, state.settings.tombstoneTtlDays) * 24 * 60 * 60 * 1000
  const now = Date.now()
  return Object.fromEntries(Object.entries(state.pinnedTombstones)
    .filter(([, tombstone]) => ttlMs === 0 || now - tombstone.disposedAt <= ttlMs)
    .map(([id, tombstone]) => [
      id,
      {
        ...tombstone,
        inputText: state.settings.persistPinnedInput ? tombstone.inputText : '',
        outputSummary: tombstone.outputSummary
          ? {
            ...tombstone.outputSummary,
            preview: tombstone.outputSummary.preview?.slice(0, state.settings.outputPreviewLimit),
          }
          : undefined,
      },
    ]))
}

function stripShortcutRuntimeStatus(shortcut: GlobalPinnedLauncherShortcut): GlobalPinnedLauncherShortcut {
  if (shortcut.kind === 'accelerator') return { kind: 'accelerator', accelerator: shortcut.accelerator }
  if (shortcut.kind === 'double-modifier') return { kind: 'double-modifier', modifier: shortcut.modifier }
  return { kind: 'disabled' }
}

function shouldAllowCommandPaletteOpen(state: AppState): boolean {
  return state.activeView === 'editor'
}

export const useAppStore = create<AppState>()(persist((set) => ({
  // Navigation
  activeView: 'editor',
  setActiveView: (view) => set(view === 'editor' ? { activeView: view } : { activeView: view, commandPaletteOpen: false }),
  pluginEditor: null,
  openPluginEditor: (plugin) => set({ pluginEditor: plugin, activeView: 'plugin-editor', commandPaletteOpen: false }),
  closePluginEditor: () => set({ pluginEditor: null, activeView: 'scripts', commandPaletteOpen: false }),

  // Pinned Action / Live Runner
  pinnedActions: [],
  activePinnedActionId: null,
  pinnedRuntimes: {},
  pinnedTombstones: {},
  pinnedRuntimeConfig: DEFAULT_PINNED_RUNTIME_CONFIG,
  pinPluginCommand: (command) => {
    const current = useAppStore.getState()
    const existing = current.pinnedActions.find((pinned) => samePinnedPluginCommandIdentity(pinned, command))
    if (existing) {
      current.activatePinnedAction(existing.id)
      return existing.id
    }
    const pinned = createPinnedPluginCommandAction(command)
    set((state) => ({
      pinnedActions: [...state.pinnedActions, pinned],
      activePinnedActionId: pinned.id,
      activeView: 'pinned-runner',
      pinnedRuntimes: {
        ...state.pinnedRuntimes,
        [pinned.id]: activatePinnedRuntime(pinned, state.pinnedRuntimes[pinned.id], state.pinnedTombstones[pinned.id]),
      },
    }))
    return pinned.id
  },
  unpinAction: (pinnedId) => set((state) => {
    const { [pinnedId]: _runtime, ...pinnedRuntimes } = state.pinnedRuntimes
    const { [pinnedId]: _tombstone, ...pinnedTombstones } = state.pinnedTombstones
    const remaining = state.pinnedActions.filter((pinned) => pinned.id !== pinnedId)
    const nextActiveView = state.activePinnedActionId === pinnedId && remaining.length === 0 ? 'editor' : state.activeView
    return {
      pinnedActions: remaining,
      pinnedRuntimes,
      pinnedTombstones,
      activePinnedActionId: state.activePinnedActionId === pinnedId ? remaining[0]?.id ?? null : state.activePinnedActionId,
      activeView: nextActiveView,
      commandPaletteOpen: nextActiveView === 'editor' ? state.commandPaletteOpen : false,
    }
  }),
  reorderPinnedActions: (orderedIds) => set((state) => {
    const byId = new Map(state.pinnedActions.map((pinned) => [pinned.id, pinned]))
    const ordered = orderedIds.map((id) => byId.get(id)).filter((pinned): pinned is PinnedAction => !!pinned)
    const leftovers = state.pinnedActions.filter((pinned) => !orderedIds.includes(pinned.id))
    return { pinnedActions: [...ordered, ...leftovers] }
  }),
  setActivePinnedAction: (pinnedId) => set((state) => (
    state.pinnedActions.some((pinned) => pinned.id === pinnedId)
      ? { activePinnedActionId: pinnedId, activeView: 'pinned-runner' }
      : {}
  )),
  activatePinnedAction: (pinnedId) => set((state) => {
    const pinned = state.pinnedActions.find((item) => item.id === pinnedId)
    if (!pinned) return {}
    const restoredPinned = restorePinnedFromTombstone(pinned, state.pinnedTombstones[pinnedId])
    const nextRuntimes: Record<string, PinnedRuntime> = {}
    for (const [id, runtime] of Object.entries(state.pinnedRuntimes)) {
      nextRuntimes[id] = id === pinnedId ? runtime : { ...runtime, status: runtime.status === 'active' ? 'idle' : runtime.status }
    }
    nextRuntimes[pinnedId] = activatePinnedRuntime(restoredPinned, nextRuntimes[pinnedId], state.pinnedTombstones[pinnedId])
    const { [pinnedId]: _restoredTombstone, ...nextTombstones } = state.pinnedTombstones
    return {
      pinnedActions: state.pinnedActions.map((item) => item.id === pinnedId ? restoredPinned : item),
      activePinnedActionId: pinnedId,
      activeView: 'pinned-runner',
      pinnedRuntimes: nextRuntimes,
      pinnedTombstones: nextTombstones,
      commandPaletteOpen: false,
    }
  }),
  openPinnedAction: (pinnedId) => {
    useAppStore.getState().activatePinnedAction(pinnedId)
  },
  updatePinnedAction: (pinnedId, patch) => set((state) => {
    const shouldDiscardTombstone = discardPinnedTombstoneAfterPatch(patch)
    const nextTombstones = shouldDiscardTombstone && state.pinnedTombstones[pinnedId]
      ? Object.fromEntries(Object.entries(state.pinnedTombstones).filter(([id]) => id !== pinnedId))
      : state.pinnedTombstones
    return {
      pinnedActions: state.pinnedActions.map((pinned) => (
        pinned.id === pinnedId ? { ...pinned, ...patch } : pinned
      )),
      pinnedTombstones: nextTombstones,
    }
  }),
  updatePinnedRuntime: (pinnedId, patch) => set((state) => {
    const current = state.pinnedRuntimes[pinnedId]
    if (!current) return {}
    return {
      pinnedRuntimes: {
        ...state.pinnedRuntimes,
        [pinnedId]: { ...current, ...patch, lastInteractedAt: Date.now() },
      },
    }
  }),
  prunePinnedRuntimes: (now) => set((state) => {
    const pruneIds = pruneIdlePinnedRuntimes(
      state.pinnedRuntimes,
      state.activePinnedActionId,
      state.pinnedRuntimeConfig,
      now,
    )
    if (pruneIds.length === 0) return {}
    const nextRuntimes = { ...state.pinnedRuntimes }
    const nextTombstones = { ...state.pinnedTombstones }
    for (const pinnedId of pruneIds) {
      const runtime = nextRuntimes[pinnedId]
      const pinned = state.pinnedActions.find((item) => item.id === pinnedId)
      if (!runtime || !pinned) continue
      nextRuntimes[pinnedId] = disposePinnedRuntime(runtime)
      nextTombstones[pinnedId] = tombstonePinnedRuntime(pinned, runtime, 'idle-timeout')
    }
    return {
      pinnedRuntimes: nextRuntimes,
      pinnedTombstones: nextTombstones,
    }
  }),
  releasePinnedRuntime: (pinnedId, reason = 'manual') => set((state) => {
    const runtime = state.pinnedRuntimes[pinnedId]
    const pinned = state.pinnedActions.find((item) => item.id === pinnedId)
    if (!runtime || !pinned) return {}
    const tombstone = tombstonePinnedRuntime(pinned, runtime, reason)
    return {
      pinnedRuntimes: {
        ...state.pinnedRuntimes,
        [pinnedId]: disposePinnedRuntime(runtime),
      },
      pinnedTombstones: {
        ...state.pinnedTombstones,
        [pinnedId]: tombstone,
      },
    }
  }),

  // Editor (bridged to workspace store for backwards compat)
  editorText: '',
  setEditorText: (text) => {
    set({ editorText: text })
    // Sync to workspace store
    useWorkspaceStore.getState().setActivePaneText(text)
  },
  editorInstance: null,
  setEditorInstance: (editor) => set({ editorInstance: editor }),

  // Command Palette
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set((state) => ({
    commandPaletteOpen: open ? shouldAllowCommandPaletteOpen(state) : false,
  })),
  globalLauncherOpen: false,
  globalLauncherMode: 'full',
  globalLauncherOverlay: false,
  pluginSurfaceToolTarget: null,
  setGlobalLauncherOpen: (open, mode) => set((state) => ({
    globalLauncherOpen: open,
    globalLauncherMode: mode ?? (open ? state.globalLauncherMode : 'full'),
    globalLauncherOverlay: open ? state.globalLauncherOverlay : false,
  })),
  openGlobalLauncher: (mode) => set({ globalLauncherOpen: true, globalLauncherMode: mode }),
  openGlobalLauncherOverlay: (mode) => set({ globalLauncherOpen: true, globalLauncherMode: mode, globalLauncherOverlay: true }),
  openPluginSurfaceTool: (target) => set({ pluginSurfaceToolTarget: target }),
  clearPluginSurfaceTool: () => set({ pluginSurfaceToolTarget: null }),

  // Last command status
  lastCommandStatus: null,
  setLastCommandStatus: (status) => set({ lastCommandStatus: status }),

  // Source-scoped usage
  actionUsageBySource: {
    'command-palette': { recentActionNames: [], actionUsageCounts: {} },
    'global-launcher': { recentActionNames: [], actionUsageCounts: {} },
    'pinned-runner': { recentActionNames: [], actionUsageCounts: {} },
  },
  pushRecentAction: (name, source = 'command-palette') => set((state) => {
    const bucket = state.actionUsageBySource[source]
    const filtered = bucket.recentActionNames.filter((n) => n !== name)
    const newBucket: ActionUsageBucket = {
      recentActionNames: [name, ...filtered].slice(0, 50),
      actionUsageCounts: { ...bucket.actionUsageCounts, [name]: (bucket.actionUsageCounts[name] ?? 0) + 1 },
    }
    return {
      actionUsageBySource: { ...state.actionUsageBySource, [source]: newBucket },
    }
  }),

  // Launcher usage (per surface, scoped by system launcher item key)
  launcherUsageBySurface: emptyUsageBySurface(),
  recordLauncherSelection: (surfaceId: LauncherSurfaceId, itemKey: SystemLauncherItemKey) => set((state) => ({
    launcherUsageBySurface: recordSelectionPure(state.launcherUsageBySurface, surfaceId, itemKey, Date.now()),
  })),

  // Saved params per action
  savedActionParams: {},
  saveActionParams: (actionName, params) => set((state) => ({
    savedActionParams: { ...state.savedActionParams, [actionName]: params }
  })),

  // Settings
  settings: {
    watchDirectory: '~/.local/hiven/plugins/installed',
    fontSize: 13,
    wordWrap: false,
    lineNumbers: true,
    persistParams: true,
    persistPinnedInput: true,
    persistPinnedTombstone: true,
    outputPreviewLimit: 2048,
    tombstoneTtlDays: 30,
    theme: 'dark',
    locale: 'en' as Locale,
    disabledBuiltins: [],
    disabledCustoms: [],
    globalPinnedLauncherShortcut: { kind: 'accelerator', accelerator: 'Shift+Cmd+Space' },
    globalLauncherWindowPosition: undefined,
    globalLauncherWindowPositionSource: undefined,
  },
  updateSetting: (key, value) =>
    set((state) => {
      const newSettings = { ...state.settings, [key]: value }
      if (key === 'locale') {
        return { settings: newSettings, locale: value as Locale }
      }
      return { settings: newSettings }
    }),
  toggleBuiltinDisabled: (name) =>
    set((state) => {
      const list = state.settings.disabledBuiltins
      const newList = list.includes(name) ? list.filter(n => n !== name) : [...list, name]
      return { settings: { ...state.settings, disabledBuiltins: newList } }
    }),
  toggleCustomDisabled: (name) =>
    set((state) => {
      const list = state.settings.disabledCustoms
      const newList = list.includes(name) ? list.filter(n => n !== name) : [...list, name]
      return { settings: { ...state.settings, disabledCustoms: newList } }
    }),
  locale: 'en' as Locale,
  setLocale: (locale) =>
    set((state) => ({ locale, settings: { ...state.settings, locale } })),
}), {
  name: 'hiven-settings',
  partialize: (state) => ({
    settings: {
      ...state.settings,
      globalPinnedLauncherShortcut: stripShortcutRuntimeStatus(state.settings.globalPinnedLauncherShortcut),
    },
    locale: state.locale,
    savedActionParams: state.savedActionParams,
    actionUsageBySource: state.actionUsageBySource,
    launcherUsageBySurface: state.launcherUsageBySurface,
    pinnedActions: state.pinnedActions.map(({ outputText: _outputText, lastError: _lastError, lastDurationMs: _lastDurationMs, controlPanelInstanceId: _controlPanelInstanceId, ...pinned }) => ({
      ...pinned,
      inputText: state.settings.persistPinnedInput ? pinned.inputText : '',
      outputText: '',
      outputKind: 'text' as PinnedOutputKind,
    })),
    activePinnedActionId: state.activePinnedActionId,
    pinnedRuntimeConfig: state.pinnedRuntimeConfig,
    pinnedTombstones: state.settings.persistPinnedTombstone
      ? serializePinnedTombstones(state)
      : {},
  }),
  merge: (persisted, current) => {
    const persistedState = persisted as Partial<AppState> & {
      recentActionNames?: string[]
      actionUsageCounts?: Record<string, number>
      launcherUsageBySurface?: LauncherUsageBySurface
    }
    const merged = { ...current, ...persistedState }
    merged.settings = { ...current.settings, ...persistedState.settings }
    merged.settings.globalPinnedLauncherShortcut = stripShortcutRuntimeStatus(
      merged.settings.globalPinnedLauncherShortcut ?? current.settings.globalPinnedLauncherShortcut
    )
    // Migrate legacy top-level recentActionNames/actionUsageCounts into command-palette bucket
    if (!persistedState.actionUsageBySource && (persistedState.recentActionNames || persistedState.actionUsageCounts)) {
      merged.actionUsageBySource = {
        'command-palette': {
          recentActionNames: persistedState.recentActionNames ?? [],
          actionUsageCounts: persistedState.actionUsageCounts ?? {},
        },
        'global-launcher': { recentActionNames: [], actionUsageCounts: {} },
        'pinned-runner': { recentActionNames: [], actionUsageCounts: {} },
      }
    } else if (persistedState.actionUsageBySource) {
      merged.actionUsageBySource = {
        ...current.actionUsageBySource,
        ...persistedState.actionUsageBySource,
      }
    }
    // Restore persisted launcher usage; ensure both surfaces exist.
    const persistedLauncherUsage = persistedState.launcherUsageBySurface
    const hasPersistedLauncherUsage =
      persistedLauncherUsage != null &&
      (Object.keys(persistedLauncherUsage['command-palette'] ?? {}).length > 0 ||
        Object.keys(persistedLauncherUsage['global-launcher'] ?? {}).length > 0)
    if (hasPersistedLauncherUsage) {
      merged.launcherUsageBySurface = {
        ...emptyUsageBySurface(),
        ...persistedLauncherUsage,
      }
    } else if (merged.actionUsageBySource) {
      // First run after migration: seed launcher usage from legacy action usage.
      // Identity map command ids to system keys; launcher items expose the same
      // command id via legacyUsageKeys, so ranking still finds this history.
      merged.launcherUsageBySurface = migrateLegacyUsage(
        merged.actionUsageBySource,
        (legacyKey) => legacyKey,
        Date.now(),
      )
    } else {
      merged.launcherUsageBySurface = emptyUsageBySurface()
    }
    // Drop pinned actions persisted from the removed legacy action system;
    // only plugin-command pins remain valid.
    if (Array.isArray(merged.pinnedActions)) {
      const validPins = merged.pinnedActions.filter((pinned) => pinned.kind === 'plugin-command')
      merged.pinnedActions = validPins
      if (merged.activePinnedActionId && !validPins.some((p) => p.id === merged.activePinnedActionId)) {
        merged.activePinnedActionId = validPins.length > 0 ? validPins[0].id : null
      }
    }
    return merged
  },
}))
