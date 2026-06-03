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

export type ViewId = 'editor' | 'scripts' | 'plugin-editor' | 'pinned-runner' | 'debugger' | 'settings'

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

export interface DebuggerTab {
  id: string
  fileName: string
  script: string
  input: string
  output: string
  params: Record<string, any>
  consoleLogs: ConsoleLog[]
  dirty: boolean
  running: boolean
  builtin?: boolean
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
  registerActions: (actions: ActionDef[]) => void
  setCustomActions: (customs: ActionDef[]) => void
  setBuiltinActionsFromDisk: (diskBuiltins: ActionDef[]) => void

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

  // Debugger
  debuggerScript: string
  setDebuggerScript: (script: string) => void
  debuggerInput: string
  setDebuggerInput: (input: string) => void
  debuggerOutput: string
  setDebuggerOutput: (output: string) => void
  debuggerParams: Record<string, any>
  setDebuggerParams: (params: Record<string, any>) => void
  consoleLogs: ConsoleLog[]
  addConsoleLog: (log: ConsoleLog) => void
  clearConsoleLogs: () => void
  debuggerFileName: string
  setDebuggerFileName: (name: string) => void
  debuggerDirty: boolean
  setDebuggerDirty: (dirty: boolean) => void
  debuggerRunning: boolean
  setDebuggerRunning: (running: boolean) => void
  debuggerBuiltin: boolean

  // Debugger Tabs
  debuggerTabs: DebuggerTab[]
  activeDebuggerTabId: string
  addDebuggerTab: (tab: DebuggerTab) => void
  removeDebuggerTab: (id: string) => void
  switchDebuggerTab: (id: string) => void

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

function _snapshotActiveTab(state: AppState): DebuggerTab {
  return {
    id: state.activeDebuggerTabId,
    fileName: state.debuggerFileName,
    script: state.debuggerScript,
    input: state.debuggerInput,
    output: state.debuggerOutput,
    params: state.debuggerParams,
    consoleLogs: state.consoleLogs,
    dirty: state.debuggerDirty,
    running: state.debuggerRunning,
    builtin: state.debuggerBuiltin,
  }
}

function _loadTabState(tab: DebuggerTab) {
  return {
    activeDebuggerTabId: tab.id,
    debuggerFileName: tab.fileName,
    debuggerScript: tab.script,
    debuggerInput: tab.input,
    debuggerOutput: tab.output,
    debuggerParams: tab.params,
    consoleLogs: tab.consoleLogs,
    debuggerDirty: tab.dirty,
    debuggerRunning: tab.running,
    debuggerBuiltin: !!tab.builtin,
  }
}

function _makePinnedId(actionId: string): string {
  return `pinned-${actionId.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`
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
    const pinned: PinnedAction = {
      id: _makePinnedId(command.actionId),
      kind: 'plugin-command',
      actionId: command.actionId,
      pluginId: command.pluginId,
      isDev: !!command.isDev,
      title: command.title,
      titleI18n: command.titleI18n,
      icon: command.icon,
      inputText: '',
      outputText: '',
      outputKind: 'text',
      params: command.params ?? {},
      autoRun: shouldAutoRunLiveAction(command.live),
      debounceMs: command.live?.live?.debounceMs ?? 250,
      controlsOpen: command.live?.controls?.defaultOpen ?? false,
    }
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
  registerActions: (actions) => set((state) => ({ actions: [...state.actions, ...actions] })),
  setCustomActions: (customs) => set((state) => ({
    actions: [...state.actions.filter(a => a.builtin), ...customs]
  })),
  setBuiltinActionsFromDisk: (diskBuiltins: ActionDef[]) => set((state) => {
    const diskMap = new Map(diskBuiltins.map(a => [a.name, a]))
    // 用磁盘版本覆盖同名硬编码版本，解析失败的保留硬编码
    const merged: ActionDef[] = []
    for (const hc of builtinActions) {
      const disk = diskMap.get(hc.name)
      merged.push(disk ? { ...disk, builtin: true } : hc)
      diskMap.delete(hc.name)
    }
    // 远程可能新增了硬编码中没有的脚本
    for (const [, a] of diskMap) {
      merged.push({ ...a, builtin: true })
    }
    const customs = state.actions.filter(a => !a.builtin)
    // 保留 workspace 扩展注册的内置命令（不在脚本 builtinActions 中）
    const scriptNames = new Set([...builtinActions.map(a => a.name), ...diskBuiltins.map(a => a.name)])
    const extensionBuiltins = state.actions.filter(a => a.builtin && !scriptNames.has(a.name))
    return { actions: [...merged, ...extensionBuiltins, ...customs] }
  }),

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

  // Debugger
  debuggerScript: `import { defineAction } from 'fluxtext'

export default defineAction({
  name: 'extract-emails',
  title: 'Extract Email Addresses',
  tags: ['extract', 'email'],

  params: [
    {
      key: 'unique',
      label: 'Deduplicate',
      type: 'boolean',
      default: true,
    },
    {
      key: 'format',
      label: 'Output format',
      type: 'single-select',
      options: ['one per line', 'comma separated'],
      default: 'one per line',
    },
  ],

  run(ctx) {
    const re = /[a-z0-9._%+-]+@[a-z0-9.-]+\\.[a-z]{2,}/gi
    const allMatches = ctx.input.text.match(re) || []
    let results = ctx.params.unique
      ? [...new Set(allMatches.map(e => e.toLowerCase()))]
      : allMatches
    return {
      text: ctx.params.format === 'comma separated'
        ? results.join(', ')
        : results.join('\\n')
    }
  }
})`,
  setDebuggerScript: (script) => set({ debuggerScript: script, debuggerDirty: true }),
  debuggerInput: `Contact us at hello@fluxtext.app
or support@fluxtext.app for help.
Billing: billing@company.io
Spam: not-an-email, foo@
hello@fluxtext.app (duplicate)`,
  setDebuggerInput: (input) => set({ debuggerInput: input }),
  debuggerOutput: '',
  setDebuggerOutput: (output) => set({ debuggerOutput: output }),
  debuggerParams: { unique: true, format: 'one per line' },
  setDebuggerParams: (params) => set({ debuggerParams: params }),
  consoleLogs: [{ type: 'dim', message: '— ready —' }],
  addConsoleLog: (log) => set((state) => {
    const logs = [...state.consoleLogs, log]
    // 限制最多 500 条日志，防止无限增长
    return { consoleLogs: logs.length > 500 ? logs.slice(-500) : logs }
  }),
  clearConsoleLogs: () => set({ consoleLogs: [{ type: 'dim', message: '— cleared —' }] }),
  debuggerFileName: 'extract-emails.ts',
  setDebuggerFileName: (name) => set({ debuggerFileName: name }),
  debuggerDirty: false,
  setDebuggerDirty: (dirty) => set({ debuggerDirty: dirty }),
  debuggerRunning: false,
  setDebuggerRunning: (running) => set({ debuggerRunning: running }),
  debuggerBuiltin: false,

  // Debugger Tabs
  debuggerTabs: [{
    id: 'default',
    fileName: 'extract-emails.ts',
    script: '', input: '', output: '',
    params: {}, consoleLogs: [],
    dirty: false, running: false,
  }],
  activeDebuggerTabId: 'default',
  addDebuggerTab: (tab) => set((state) => {
    const snapshot = _snapshotActiveTab(state)
    const updatedTabs = state.debuggerTabs.map(t => t.id === state.activeDebuggerTabId ? snapshot : t)
    return { debuggerTabs: [...updatedTabs, tab], ..._loadTabState(tab) }
  }),
  removeDebuggerTab: (id) => set((state) => {
    if (state.debuggerTabs.length <= 1) return {}
    const snapshot = _snapshotActiveTab(state)
    const snapshotTabs = state.debuggerTabs.map(t => t.id === state.activeDebuggerTabId ? snapshot : t)
    const remaining = snapshotTabs.filter(t => t.id !== id)
    if (id !== state.activeDebuggerTabId) return { debuggerTabs: remaining }
    const idx = snapshotTabs.findIndex(t => t.id === id)
    const next = remaining[Math.min(idx, remaining.length - 1)]
    return { debuggerTabs: remaining, ..._loadTabState(next) }
  }),
  switchDebuggerTab: (id) => set((state) => {
    if (id === state.activeDebuggerTabId) return {}
    const target = state.debuggerTabs.find(t => t.id === id)
    if (!target) return {}
    const snapshot = _snapshotActiveTab(state)
    const updatedTabs = state.debuggerTabs.map(t => t.id === state.activeDebuggerTabId ? snapshot : t)
    return { debuggerTabs: updatedTabs, ..._loadTabState(target) }
  }),

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

/**
 * 将自定义脚本源码解析为 ActionDef
 * 支持 export default defineAction({...}) 和 export default {...} 两种格式
 */
export function parseScriptToAction(content: string): ActionDef | null {
  try {
    let code = content
      // 移除 import 语句
      .replace(/^\s*import\s+.*?['"].*?['"]\s*;?\s*$/gm, '')
      .trim()

    let hadDefineAction = false
    if (/export\s+default\s+defineAction\s*\(/.test(code)) {
      code = code.replace(/export\s+default\s+defineAction\s*\(\s*/, '')
      hadDefineAction = true
    } else {
      code = code.replace(/export\s+default\s+/, '')
      code = code.replace(/module\.exports\s*=\s*/, '')
    }

    if (hadDefineAction) {
      // 移除 defineAction(...) 的末尾 )
      code = code.replace(/\)\s*;?\s*$/, '')
    }

    // 移除常见 TypeScript 泛型
    code = code.replace(/<(?:string|number|boolean|any|void|never|unknown|[A-Z]\w*)(?:\s*,\s*(?:string|number|boolean|any|void|never|unknown|[A-Z]\w*))*>/g, '')

    const fn = new Function(`return (${code})`)
    const def = fn()

    if (!def || typeof def !== 'object' || !def.name || typeof def.run !== 'function') {
      return null
    }

    return { ...def, builtin: false, source: content }
  } catch {
    return null
  }
}
