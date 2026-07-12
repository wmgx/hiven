import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { showToast } from './workspace/toast'
import type { Locale } from './i18n'
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

export type ActionUsageSource =
  | 'command-palette'
  | 'editor-command-bar'
  | 'global-launcher'

export type ActionUsageBucket = {
  recentActionNames: string[]
  actionUsageCounts: Record<string, number>
}

/** UI model for a launcher parameter field (used to normalize plugin CommandParam for rendering). */
export interface LauncherParamModel {
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
  initialText?: string
}

export type LauncherHostSurfaceTarget = 'system-settings' | 'system-plugins' | 'quick-editor'

interface AppState {
  // Editor command bar
  editorCommandBarOpen: boolean
  setEditorCommandBarOpen: (open: boolean) => void
  globalLauncherOpen: boolean
  globalLauncherOverlay: boolean
  setGlobalLauncherOpen: (open: boolean) => void
  openGlobalLauncherOverlay: () => void
  pluginSurfaceToolTarget: PluginSurfaceOpenTarget | null
  openPluginSurfaceTool: (target: PluginSurfaceOpenTarget) => void
  clearPluginSurfaceTool: () => void
  launcherHostSurfaceTarget: LauncherHostSurfaceTarget | null
  /**
   * Host surface suspended while a plugin tool surface is open (e.g. Diff over
   * Quick Editor). ESC/back restores this instead of closing the launcher.
   */
  previousLauncherHostSurfaceTarget: LauncherHostSurfaceTarget | null
  openLauncherHostSurface: (target: LauncherHostSurfaceTarget) => void
  clearLauncherHostSurface: () => void
  /** Restore host surface suspended by openPluginSurfaceTool; returns true if restored. */
  restorePreviousLauncherHostSurface: () => boolean

  // Quick Editor
  quickEditorCommandOpen: boolean
  quickEditorCommandInitialQuery: string
  openQuickEditorCommand: (initialQuery?: string) => void
  closeQuickEditorCommand: () => void

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

function stripShortcutRuntimeStatus(shortcut: GlobalPinnedLauncherShortcut): GlobalPinnedLauncherShortcut {
  if (shortcut.kind === 'accelerator') return { kind: 'accelerator', accelerator: shortcut.accelerator }
  if (shortcut.kind === 'double-modifier') return { kind: 'double-modifier', modifier: shortcut.modifier }
  return { kind: 'disabled' }
}

export const useAppStore = create<AppState>()(persist((set) => ({
  // Editor command bar
  editorCommandBarOpen: false,
  setEditorCommandBarOpen: (open) => set({ editorCommandBarOpen: open }),
  globalLauncherOpen: false,
  globalLauncherOverlay: false,
  pluginSurfaceToolTarget: null,
  launcherHostSurfaceTarget: null,
  previousLauncherHostSurfaceTarget: null,
  setGlobalLauncherOpen: (open) => set((state) => ({
    globalLauncherOpen: open,
    globalLauncherOverlay: open ? state.globalLauncherOverlay : false,
    ...(open ? {} : {
      launcherHostSurfaceTarget: null,
      previousLauncherHostSurfaceTarget: null,
      pluginSurfaceToolTarget: null,
      quickEditorCommandOpen: false,
      quickEditorCommandInitialQuery: '',
    }),
  })),
  openGlobalLauncherOverlay: () => set({ globalLauncherOpen: true, globalLauncherOverlay: true }),
  openPluginSurfaceTool: (target) => set((state) => ({
    pluginSurfaceToolTarget: target,
    // Suspend the host surface (e.g. quick-editor) so ESC can restore it.
    previousLauncherHostSurfaceTarget:
      state.launcherHostSurfaceTarget ?? state.previousLauncherHostSurfaceTarget,
    launcherHostSurfaceTarget: null,
    // Diff / tool surfaces replace the quick-editor command overlay.
    quickEditorCommandOpen: false,
    quickEditorCommandInitialQuery: '',
  })),
  clearPluginSurfaceTool: () => set({ pluginSurfaceToolTarget: null }),
  openLauncherHostSurface: (target) => set({
    launcherHostSurfaceTarget: target,
    pluginSurfaceToolTarget: null,
    previousLauncherHostSurfaceTarget: null,
    globalLauncherOpen: true,
  }),
  clearLauncherHostSurface: () => set({ launcherHostSurfaceTarget: null }),
  restorePreviousLauncherHostSurface: () => {
    let restored = false
    set((state) => {
      const previous = state.previousLauncherHostSurfaceTarget
      if (!previous) return {}
      restored = true
      return {
        launcherHostSurfaceTarget: previous,
        previousLauncherHostSurfaceTarget: null,
        pluginSurfaceToolTarget: null,
        globalLauncherOpen: true,
      }
    })
    return restored
  },

  // Quick Editor
  quickEditorCommandOpen: false,
  quickEditorCommandInitialQuery: '',
  openQuickEditorCommand: (initialQuery?: string) => set({ quickEditorCommandOpen: true, quickEditorCommandInitialQuery: initialQuery ?? '' }),
  closeQuickEditorCommand: () => set({ quickEditorCommandOpen: false, quickEditorCommandInitialQuery: '' }),

  // Last command status
  lastCommandStatus: null,
  setLastCommandStatus: (status) => {
    set({ lastCommandStatus: status })
    if (status && status.status === 'success') {
      showToast(status.message || status.title, 'success')
    } else if (status && status.status === 'error') {
      showToast(status.message || status.title, 'error')
    }
  },

  // Source-scoped usage
  actionUsageBySource: {
    'command-palette': { recentActionNames: [], actionUsageCounts: {} },
    'editor-command-bar': { recentActionNames: [], actionUsageCounts: {} },
    'global-launcher': { recentActionNames: [], actionUsageCounts: {} },
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
        'editor-command-bar': {
          recentActionNames: persistedState.recentActionNames ?? [],
          actionUsageCounts: persistedState.actionUsageCounts ?? {},
        },
        'global-launcher': { recentActionNames: [], actionUsageCounts: {} },
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
        Object.keys(persistedLauncherUsage['editor-command-bar'] ?? {}).length > 0 ||
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
    return merged
  },
}))
