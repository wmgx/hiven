import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Locale } from './i18n'
import { builtinActions } from './actions/builtins'
import { useWorkspaceStore } from './workspace/workspaceStore'
import { workspaceActions } from './commands/workspaceCommands'
import {
  DEFAULT_PINNED_RUNTIME_CONFIG,
  activatePinnedRuntime,
  disposePinnedRuntime,
  pruneIdlePinnedRuntimes,
  restorePinnedFromTombstone,
  tombstonePinnedRuntime,
} from './workspace/pinnedActionRuntime'
import type { PinnedRuntimeConfig as WorkspacePinnedRuntimeConfig } from './workspace/pinnedActionRuntime'
import type { LiveActionCapability } from './workspace/pluginTypes'
import { samePinnedPluginCommandIdentity } from './workspace/pinnedActionIdentity'
import { createPinnedPluginCommandAction, makePinnedId } from './workspace/pinnedActionFactory'

export type ViewId = 'editor' | 'scripts' | 'plugin-editor' | 'pinned-runner' | 'settings'

export type PinnedOutputKind = 'text' | 'error' | 'presentation' | 'stale'
export type PinnedActionKind = 'legacy' | 'plugin-command'

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

export interface ActionParam {
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

export interface ActionDef {
  name: string
  title: string
  titleI18n?: Partial<Record<Locale, string>>
  icon?: string
  aliases?: string[]
  description?: string
  descriptionI18n?: Partial<Record<Locale, string>>
  tags?: string[]
  params?: ActionParam[]
  optionalParams?: boolean
  live?: LiveActionCapability
  run: (ctx: ActionContext) => { text: string } | Promise<{ text: string }> | void
  builtin?: boolean
  source?: string
  error?: string
}

// 根据 locale 获取本地化文本，无翻译则返回默认值
export function localized(text: string, i18nMap?: Partial<Record<Locale, string>>, locale?: Locale): string {
  if (i18nMap && locale && i18nMap[locale]) return i18nMap[locale]!
  return text
}

export interface ActionContext {
  input: { text: string }
  params: Record<string, any>
  readClipboard: () => Promise<string>
  /** 从 URL 加载远程模块，带本地持久缓存 */
  loadCDN: (url: string) => Promise<any>
  /** @deps 声明的依赖，系统自动加载后注入 */
  deps: Record<string, any>
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
  pinAction: (action: ActionDef | string) => string
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

  // Action System
  actions: ActionDef[]
  registerAction: (action: ActionDef) => void

  // Command Palette
  commandPaletteOpen: boolean
  setCommandPaletteOpen: (open: boolean) => void
  globalLauncherOpen: boolean
  setGlobalLauncherOpen: (open: boolean) => void

  // Last command status
  lastCommandStatus: LastCommandStatus | null
  setLastCommandStatus: (status: LastCommandStatus | null) => void

  // Recent actions (most recent first)
  recentActionNames: string[]
  pushRecentAction: (name: string) => void
  // Usage frequency per action (cumulative count)
  actionUsageCounts: Record<string, number>

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
    locale: Locale
    disabledBuiltins: string[]
    disabledCustoms: string[]
  }
  updateSetting: (key: string, value: any) => void
  toggleBuiltinDisabled: (name: string) => void
  toggleCustomDisabled: (name: string) => void
  locale: Locale
  setLocale: (locale: Locale) => void
}

function _makePinnedId(actionId: string): string {
  return makePinnedId(actionId)
}

function shouldAutoRunLiveAction(live?: LiveActionCapability): boolean {
  return live?.live?.enabled === true &&
    live.live.sideEffects !== 'writes' &&
    live.live.trigger !== 'manual'
}

function _actionToPinnedAction(action: ActionDef | string, actions: ActionDef[]): PinnedAction {
  const actionId = typeof action === 'string' ? action : action.name
  const def = typeof action === 'string' ? actions.find(a => a.name === action) : action
  const live = def?.live
  return {
    id: _makePinnedId(actionId),
    kind: 'legacy',
    actionId,
    title: def?.title ?? actionId,
    titleI18n: def?.titleI18n,
    icon: def?.icon,
    inputText: '',
    outputText: '',
    outputKind: 'text',
    params: {},
    autoRun: shouldAutoRunLiveAction(live),
    debounceMs: live?.live?.debounceMs ?? 250,
    controlsOpen: live?.controls?.defaultOpen ?? false,
  }
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

export const useAppStore = create<AppState>()(persist((set) => ({
  // Navigation
  activeView: 'editor',
  setActiveView: (view) => set({ activeView: view }),
  pluginEditor: null,
  openPluginEditor: (plugin) => set({ pluginEditor: plugin, activeView: 'plugin-editor' }),
  closePluginEditor: () => set({ pluginEditor: null, activeView: 'scripts' }),

  // Pinned Action / Live Runner
  pinnedActions: [],
  activePinnedActionId: null,
  pinnedRuntimes: {},
  pinnedTombstones: {},
  pinnedRuntimeConfig: DEFAULT_PINNED_RUNTIME_CONFIG,
  pinAction: (action) => {
    const current = useAppStore.getState()
    const actionId = typeof action === 'string' ? action : action.name
    const existing = current.pinnedActions.find((pinned) => (pinned.kind ?? 'legacy') === 'legacy' && pinned.actionId === actionId)
    if (existing) {
      current.activatePinnedAction(existing.id)
      return existing.id
    }
    const pinned = _actionToPinnedAction(action, current.actions)
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
    return {
      pinnedActions: remaining,
      pinnedRuntimes,
      pinnedTombstones,
      activePinnedActionId: state.activePinnedActionId === pinnedId ? remaining[0]?.id ?? null : state.activePinnedActionId,
      activeView: state.activePinnedActionId === pinnedId && remaining.length === 0 ? 'editor' : state.activeView,
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
    return {
      pinnedActions: state.pinnedActions.map((item) => item.id === pinnedId ? restoredPinned : item),
      activePinnedActionId: pinnedId,
      activeView: 'pinned-runner',
      pinnedRuntimes: nextRuntimes,
    }
  }),
  openPinnedAction: (pinnedId) => {
    useAppStore.getState().activatePinnedAction(pinnedId)
  },
  updatePinnedAction: (pinnedId, patch) => set((state) => ({
    pinnedActions: state.pinnedActions.map((pinned) => (
      pinned.id === pinnedId ? { ...pinned, ...patch } : pinned
    )),
  })),
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

  // Action System
  actions: [...builtinActions, ...workspaceActions],
  registerAction: (action) => set((state) => ({ actions: [...state.actions, action] })),

  // Command Palette
  commandPaletteOpen: false,
  setCommandPaletteOpen: (open) => set({ commandPaletteOpen: open }),
  globalLauncherOpen: false,
  setGlobalLauncherOpen: (open) => set({ globalLauncherOpen: open }),

  // Last command status
  lastCommandStatus: null,
  setLastCommandStatus: (status) => set({ lastCommandStatus: status }),

  // Recent actions
  recentActionNames: [],
  pushRecentAction: (name) => set((state) => {
    const filtered = state.recentActionNames.filter((n) => n !== name)
    const newCounts = { ...state.actionUsageCounts, [name]: (state.actionUsageCounts[name] ?? 0) + 1 }
    return {
      recentActionNames: [name, ...filtered].slice(0, 50),
      actionUsageCounts: newCounts,
    }
  }),
  actionUsageCounts: {},

  // Saved params per action
  savedActionParams: {},
  saveActionParams: (actionName, params) => set((state) => ({
    savedActionParams: { ...state.savedActionParams, [actionName]: params }
  })),

  // Settings
  settings: {
    watchDirectory: '~/.local/fluxtext/scripts',
    fontSize: 13,
    wordWrap: false,
    lineNumbers: true,
    persistParams: true,
    persistPinnedInput: true,
    persistPinnedTombstone: true,
    outputPreviewLimit: 2048,
    tombstoneTtlDays: 30,
    locale: 'en' as Locale,
    disabledBuiltins: [],
    disabledCustoms: [],
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
  name: 'fluxtext-settings',
  partialize: (state) => ({
    settings: state.settings,
    locale: state.locale,
    savedActionParams: state.savedActionParams,
    recentActionNames: state.recentActionNames,
    actionUsageCounts: state.actionUsageCounts,
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
}))
