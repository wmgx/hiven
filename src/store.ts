import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { Locale } from './i18n'
import { builtinActions } from './actions/builtins'
import { useWorkspaceStore } from './workspace/workspaceStore'
import { workspaceActions } from './commands/workspaceCommands'

export type ViewId = 'editor' | 'scripts' | 'debugger' | 'settings'

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
  fileNameEditing: boolean
  builtin?: boolean
}

interface AppState {
  // Navigation
  activeView: ViewId
  setActiveView: (view: ViewId) => void

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

  // Last Action Result
  lastResult: string | null
  setLastResult: (result: string | null) => void
  lastActionName: string | null
  setLastActionName: (name: string | null) => void

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
  debuggerFileNameEditing: boolean
  setDebuggerFileNameEditing: (editing: boolean) => void
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
    fileNameEditing: false,
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
    debuggerFileNameEditing: tab.fileNameEditing,
    debuggerBuiltin: !!tab.builtin,
  }
}

export const useAppStore = create<AppState>()(persist((set) => ({
  // Navigation
  activeView: 'editor',
  setActiveView: (view) => set({ activeView: view }),

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
  setCommandPaletteOpen: (open) => set((state) => {
    // 只在编辑器主页面允许打开面板
    if (open && state.activeView !== 'editor') return {}
    return { commandPaletteOpen: open }
  }),

  // Last Action Result
  lastResult: null,
  setLastResult: (result) => set({ lastResult: result }),
  lastActionName: null,
  setLastActionName: (name) => set({ lastActionName: name }),

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
  debuggerFileNameEditing: false,
  setDebuggerFileNameEditing: (editing) => set({ debuggerFileNameEditing: editing }),
  debuggerBuiltin: false,

  // Debugger Tabs
  debuggerTabs: [{
    id: 'default',
    fileName: 'extract-emails.ts',
    script: '', input: '', output: '',
    params: {}, consoleLogs: [],
    dirty: false, running: false, fileNameEditing: false,
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
  partialize: (state) => ({ settings: state.settings, locale: state.locale, savedActionParams: state.savedActionParams, recentActionNames: state.recentActionNames, actionUsageCounts: state.actionUsageCounts }),
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
