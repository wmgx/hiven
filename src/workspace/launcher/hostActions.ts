import type { LauncherExecuteResult } from './types'
import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'
import { useAppStore } from '../../store'
import type { LauncherItem } from './types'
import { getHostEditorActionItems } from './hostEditorActions'
import { isQuickEditorWindowOpen, showQuickEditorWindow } from '../windowManager/quickEditorWindow'
import { clearStandaloneLauncherBlurDevtoolsSuppress, suppressStandaloneLauncherBlurForDevtools } from '../launcherBlurGuard'
import {
  clearAllExperienceEvents,
  clearExperienceEventsSince,
  exportExperienceEvents,
  isExperienceLearningPaused,
  setExperienceLearningPaused,
} from '../experience/journal'
import type { LastSaveableRunState } from '../savedActions/types'
import { getLastSaveableRun } from '../savedActions/lastSaveableRun'
import { createSavedAction, deleteSavedAction, getSavedActionForRename, listSavedActions, renameSavedAction } from '../savedActions/store'
import { recordSavedActionEvent } from '../savedActions/events'
import { isGlobalLauncherSavedActionOutput } from '../savedActions/compatibility'
import { describeSavedAction } from '../savedActions/display'
import { translate } from '../../i18n'

type SystemPowerAction = 'restart' | 'shutdown' | 'lock-screen'

function confirmExperienceClear(
  scope: 'today' | 'all',
  clear: () => Promise<void>,
): LauncherExecuteResult {
  const all = scope === 'all'
  return {
    ok: true,
    output: {
      choices: [
        {
          id: `host.experience.clear-${scope}.confirm`,
          title: all ? 'Confirm clearing all learning events' : "Confirm clearing today's learning events",
          titleI18n: { zh: all ? '确认清除全部学习事件' : '确认清除今天的学习事件' },
          tone: 'danger',
          primaryAction: async () => {
            await clear()
          },
        },
        {
          id: `host.experience.clear-${scope}.cancel`,
          title: 'Cancel',
          titleI18n: { zh: '取消' },
          tone: 'muted',
          primaryAction: async () => ({ ok: true, keepOpen: true }),
        },
      ],
    },
  }
}

async function performSystemPowerAction(action: SystemPowerAction): Promise<LauncherExecuteResult> {
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    await invoke('perform_system_power_action', { action })
    return { ok: true }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, message }
  }
}

export function getHostSystemPowerItems(): LauncherItem[] {
  return [
    {
      systemKey: 'host:system:restart',
      kind: 'host',
      display: {
        title: 'Restart',
        titleI18n: { zh: '重启' },
        subtitle: 'Restart this computer',
        subtitleI18n: { zh: '重启这台电脑' },
        icon: 'RotateCcw',
        aliases: ['restart', 'reboot', 'system restart', '重启', '重新启动'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['system-power'],
      execute: async () => performSystemPowerAction('restart'),
    },
    {
      systemKey: 'host:system:shutdown',
      kind: 'host',
      display: {
        title: 'Shut Down',
        titleI18n: { zh: '关机' },
        subtitle: 'Shut down this computer',
        subtitleI18n: { zh: '关闭这台电脑' },
        icon: 'Power',
        aliases: ['shutdown', 'shut down', 'power off', 'system shutdown', '关机', '关闭电脑'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['system-power'],
      execute: async () => performSystemPowerAction('shutdown'),
    },
    {
      systemKey: 'host:system:lock-screen',
      kind: 'host',
      display: {
        title: 'Lock Screen',
        titleI18n: { zh: '锁屏' },
        subtitle: 'Lock the current session',
        subtitleI18n: { zh: '锁定当前会话' },
        icon: 'Lock',
        aliases: ['lock', 'lock screen', 'screen lock', '锁屏', '锁定'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['system-power'],
      execute: async () => performSystemPowerAction('lock-screen'),
    },
  ]
}

export function getHostExperienceJournalItems(): LauncherItem[] {
  return [
    {
      systemKey: 'host:experience:learning-inbox',
      kind: 'host',
      display: {
        title: 'Learning Inbox',
        titleI18n: { zh: '学习收件箱' },
        subtitle: 'Review repeated non-default actions',
        subtitleI18n: { zh: '查看重复出现的非默认动作' },
        icon: 'Inbox',
        aliases: ['learning candidate', 'saved action candidate', '学习候选', '可能值得保存'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      experienceRecord: false,
      execute: async () => {
        await requestOpenLauncherHostSurface('learning-inbox')
        return { ok: true, keepOpen: true }
      },
    },
    {
      systemKey: 'host:experience:export',
      kind: 'host',
      display: {
        title: 'Export Learning Events',
        titleI18n: { zh: '导出学习事件' },
        subtitle: 'Copy the no-content event log as JSON',
        subtitleI18n: { zh: '将无正文事件日志复制为 JSON' },
        icon: 'Download',
        aliases: ['learning export', 'experience journal', '导出学习事件'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      experienceRecord: false,
      execute: async (ctx) => {
        try {
          await ctx.api.copyText(await exportExperienceEvents())
          return { ok: true }
        } catch (error) {
          return { ok: false, message: error instanceof Error ? error.message : String(error) }
        }
      },
    },
    {
      systemKey: 'host:experience:clear-today',
      kind: 'host',
      display: {
        title: "Clear Today's Learning Events",
        titleI18n: { zh: '清除今天的学习事件' },
        subtitle: 'Delete events recorded since local midnight',
        subtitleI18n: { zh: '删除本地时间今天零点后的事件' },
        icon: 'CalendarX',
        aliases: ['clear learning today', '清除今天学习事件'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      experienceRecord: false,
      execute: async () => confirmExperienceClear('today', async () => {
          const midnight = new Date()
          midnight.setHours(0, 0, 0, 0)
          await clearExperienceEventsSince(midnight.getTime())
      }),
    },
    {
      systemKey: 'host:experience:clear-all',
      kind: 'host',
      display: {
        title: 'Clear All Learning Events',
        titleI18n: { zh: '清除全部学习事件' },
        subtitle: 'Delete the complete local experience journal',
        subtitleI18n: { zh: '删除全部本地学习事件' },
        icon: 'Trash2',
        aliases: ['clear all learning', '清除全部学习事件'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      experienceRecord: false,
      execute: async () => confirmExperienceClear('all', clearAllExperienceEvents),
    },
    {
      systemKey: 'host:experience:pause',
      kind: 'host',
      display: {
        title: 'Pause / Resume Personal Learning',
        titleI18n: { zh: '暂停 / 恢复个性化学习' },
        subtitle: 'Toggle Experience Journal recording',
        subtitleI18n: { zh: '切换学习事件记录状态' },
        icon: 'PauseCircle',
        aliases: ['pause learning', 'resume learning', '暂停学习', '恢复学习'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      experienceRecord: false,
      execute: async () => {
        setExperienceLearningPaused(!isExperienceLearningPaused())
        return { ok: true }
      },
    },
  ]
}

/** Shared naming flow for search and a nearby offer bound before it is displayed. */
export function createSaveLastRunItem(options: {
  run?: LastSaveableRunState
  display?: LauncherItem['display']
  validate?: () => boolean
} = {}): LauncherItem {
  const offeredRun = options.run ? structuredClone(options.run) : undefined
  const saveLastItem: LauncherItem =
    {
      systemKey: 'host:saved-action:save-last',
      kind: 'host',
      display: options.display ?? {
        title: 'Save Last Run as a Tool',
        titleI18n: { zh: '把上一次运行保存为工具' },
        subtitle: 'Use “Name | alias one, alias two”',
        subtitleI18n: { zh: '输入“名称 | 别名一, 别名二”' },
        icon: 'BookmarkPlus',
        aliases: ['save action', 'save tool', 'saved action', '保存工具', '保存上次运行'],
      },
      behavior: {
        type: 'collect-input',
        input: {
          placeholder: 'Name | optional aliases',
          placeholderI18n: { zh: '名称 | 可选别名' },
          emptyInputMessage: 'A name is required',
          emptyInputMessageI18n: { zh: '请输入名称' },
        },
      },
      surfaces: ['global-launcher'],
      experienceRecord: false,
      metadataInput: true,
      prepare: async (ctx) => {
        // Freeze the completed run when naming starts. A later delivery cannot
        // replace the user's selected save target while this frame is open.
        const lastRun: LastSaveableRunState | null = structuredClone(offeredRun ?? await getLastSaveableRun())
        if (!lastRun) throw new Error(translate(ctx.locale, 'palette', 'savedActionNoRecent'))
        if (options.validate && !options.validate()) throw new Error(translate(ctx.locale, 'palette', 'savedActionOfferUnavailable'))
        if (lastRun.status === 'blocked') {
          throw new Error(translate(ctx.locale, 'palette', 'savedActionBlockedParams', { keys: lastRun.blockedKeys.join(', ') }))
        }
        if (!isGlobalLauncherSavedActionOutput(lastRun.outputIntent)) {
          throw new Error(translate(ctx.locale, 'palette', 'savedActionEditorOutputUnsupported'))
        }
        return {
          ...saveLastItem,
          prepare: undefined,
          execute: async (inputCtx) => {
            if (options.validate && !options.validate()) return { ok: false, message: translate(inputCtx.locale, 'palette', 'savedActionOfferUnavailable') }
            const [rawName, ...rawAliasParts] = (inputCtx.input?.text ?? '').split('|')
            const rawAliases = rawAliasParts.join('|')
            if (!rawName?.trim()) return { ok: false, message: translate(inputCtx.locale, 'palette', 'savedActionNameRequired') }
            try {
              const artifact = createSavedAction(lastRun, rawName, rawAliases.split(','))
              recordSavedActionEvent('artifact.saved', artifact)
              return { ok: true, keepOpen: true }
            } catch (error) {
              console.warn('[hiven] Failed to save Saved Action:', error)
              return { ok: false, message: translate(inputCtx.locale, 'palette', 'savedActionSaveFailed') }
            }
          },
        }
      },
      // Execution without entering the naming session must fail closed.
      execute: async (ctx) => ({ ok: false, message: translate(ctx.locale, 'palette', 'savedActionNoRecent') }),
    }
  return saveLastItem
}

/** A row action names metadata only; it never executes the underlying tool. */
export function createRenameSavedActionItem(artifactId: string): LauncherItem {
  const item: LauncherItem = {
    systemKey: `host:saved-action:rename:${artifactId}`,
    kind: 'host',
    display: { title: 'Rename saved tool', titleI18n: { zh: '重命名已保存工具' }, icon: 'Pencil' },
    surfaces: ['global-launcher'],
    metadataInput: true,
    experienceRecord: false,
    recordUsage: false,
    behavior: {
      type: 'collect-input',
      input: {
        placeholder: 'New name (up to 80 characters)',
        placeholderI18n: { zh: '新名称（最多 80 个字符）' },
        emptyInputMessage: 'A name is required',
        emptyInputMessageI18n: { zh: '请输入名称' },
      },
    },
    prepare: (ctx) => {
      let selected
      try {
        selected = getSavedActionForRename(artifactId)
      } catch {
        throw new Error(translate(ctx.locale, 'palette', 'savedActionRenameReadFailed'))
      }
      if (!selected) throw new Error(translate(ctx.locale, 'palette', 'savedActionRenameMissing'))
      const originalName = selected.name
      return {
        ...item,
        prepare: undefined,
        display: {
          ...item.display,
          title: `Rename “${originalName}”`,
          titleI18n: { zh: `重命名“${originalName}”` },
        },
        execute: async (inputCtx) => {
          try {
            const result = renameSavedAction(artifactId, inputCtx.input?.text ?? '', originalName)
            if (result.status === 'renamed') return { ok: true, keepOpen: true }
            const key = result.status === 'missing' ? 'savedActionRenameMissing'
              : result.status === 'changed' ? 'savedActionRenameChanged' : 'savedActionRenameInvalid'
            return { ok: false, message: translate(inputCtx.locale, 'palette', key) }
          } catch {
            return { ok: false, message: translate(inputCtx.locale, 'palette', 'savedActionRenameFailed') }
          }
        },
      }
    },
    execute: async (ctx) => ({ ok: false, message: translate(ctx.locale, 'palette', 'savedActionRenameMissing') }),
  }
  return item
}

export function getHostSavedActionItems(resolveBaseItems: () => LauncherItem[] = () => []): LauncherItem[] {
  const describe = (artifact: ReturnType<typeof listSavedActions>[number], baseItems = resolveBaseItems()) => {
    const candidates = baseItems.filter((item) => item.systemKey === artifact.baseActionKey)
    const { subtitle, subtitleI18n } = describeSavedAction(artifact, candidates.length === 1 ? candidates[0] : null, undefined, candidates.length > 1)
    return { subtitle, subtitleI18n }
  }
  return [createSaveLastRunItem(),
    {
      systemKey: 'host:saved-action:delete',
      kind: 'host',
      display: {
        title: 'Delete a Saved Tool',
        titleI18n: { zh: '删除已保存工具' },
        subtitle: 'Choose a Saved Action to remove',
        subtitleI18n: { zh: '选择要删除的已保存工具' },
        icon: 'BookmarkX',
        aliases: ['delete saved action', 'remove saved tool', '删除已保存工具'],
      },
      behavior: {
        type: 'collect-input',
        input: {
          placeholder: 'Search saved tools',
          placeholderI18n: { zh: '搜索已保存工具' },
          allowEmptyInput: true,
        },
      },
      surfaces: ['global-launcher'],
      experienceRecord: false,
      metadataInput: true,
      suggest: async (ctx) => {
        const query = ctx.inputText.trim().toLocaleLowerCase()
        const baseItems = resolveBaseItems()
        return {
          choices: listSavedActions()
            .filter((artifact) => !query || [artifact.name, ...artifact.aliases].some((value) => value.toLocaleLowerCase().includes(query)))
            .map((artifact) => ({
              id: `saved-action-delete-${artifact.id}`,
              title: artifact.name,
              ...describe(artifact, baseItems),
              primaryAction: async () => ({
                ok: true as const,
                output: {
                  choices: [
                    {
                      id: `saved-action-delete-confirm-${artifact.id}`,
                      title: `Confirm deleting “${artifact.name}”`,
                      titleI18n: { zh: `确认删除“${artifact.name}”` },
                      ...describe(artifact),
                      tone: 'danger' as const,
                      primaryAction: async () => {
                        try {
                          const removed = deleteSavedAction(artifact.id)
                          if (removed) recordSavedActionEvent('artifact.deleted', removed)
                          return { ok: true as const }
                        } catch {
                          return { ok: false as const, message: translate(ctx.locale, 'palette', 'savedActionDeleteFailed') }
                        }
                      },
                    },
                    {
                      id: `saved-action-delete-cancel-${artifact.id}`,
                      title: 'Cancel',
                      titleI18n: { zh: '取消' },
                      tone: 'muted' as const,
                      primaryAction: async () => ({ ok: true as const, keepOpen: true }),
                    },
                  ],
                },
              }),
            })),
        }
      },
      execute: async () => ({ ok: true, keepOpen: true }),
    },
  ]
}

export function getHostPaneControlItems(): LauncherItem[] {
  return [
    {
      systemKey: 'host:view:plugins',
      kind: 'host',
      display: {
        title: 'Plugins',
        titleI18n: { zh: '插件' },
        subtitle: 'Open plugin manager',
        subtitleI18n: { zh: '打开插件管理' },
        icon: 'Puzzle',
        aliases: ['plugin', 'plugins', 'extension', 'extensions', 'scripts', 'plugin manager', '插件', '扩展'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['settings'],
      legacyUsageKeys: ['show-plugins-page'],
      execute: async () => {
        await requestOpenLauncherHostSurface('system-plugins')
        return { ok: true, keepOpen: true }
      },
    },
    {
      systemKey: 'host:view:settings',
      kind: 'host',
      display: {
        title: 'Settings',
        titleI18n: { zh: '设置' },
        subtitle: 'Open app settings',
        subtitleI18n: { zh: '打开应用设置' },
        icon: 'Settings',
        aliases: ['setting', 'settings', 'preference', 'preferences', 'app settings', '设置', '偏好设置'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['settings'],
      legacyUsageKeys: ['show-settings-page'],
      execute: async () => {
        await requestOpenLauncherHostSurface('system-settings')
        return { ok: true, keepOpen: true }
      },
    },
    {
      systemKey: 'host:view:devtools',
      kind: 'host',
      display: {
        title: 'Open DevTools',
        titleI18n: { zh: '打开控制台' },
        subtitle: 'Open WebView developer tools for this window',
        subtitleI18n: { zh: '打开当前窗口的开发者工具（看日志）' },
        icon: 'Terminal',
        aliases: [
          'devtools',
          'dev tools',
          'console',
          'inspector',
          'debug console',
          'web inspector',
          '控制台',
          '开发者工具',
          '调试',
          '日志',
          '打开控制台',
          '打开调试',
        ],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher', 'editor-command-bar', 'quick-editor-command'],
      execute: async () => {
        try {
          const { invoke } = await import('@tauri-apps/api/core')
          // DevTools opens as its own native panel outside the webview-window
          // registry — the blur-dismiss listener would otherwise see this as
          // "user left" and close the launcher out from under the console.
          suppressStandaloneLauncherBlurForDevtools()
          // Prefer the current window; fall back to launcher label.
          await invoke('open_devtools')
          return { ok: true, keepOpen: true }
        } catch (error) {
          clearStandaloneLauncherBlurDevtoolsSuppress()
          const message = error instanceof Error ? error.message : String(error)
          return { ok: false, message }
        }
      },
    },
    // Pane split / new-pane live only on editor-command-bar & quick-editor-command
    // (see hostEditorActions). Global launcher should not expose panel controls.
    ...getHostEditorActionItems(),
    {
      systemKey: 'host:view:quick-editor',
      kind: 'host',
      display: {
        title: 'Quick Editor',
        titleI18n: { zh: '快捷编辑器' },
        subtitle: 'Open inline editor',
        subtitleI18n: { zh: '打开内嵌编辑器' },
        icon: 'SquarePen',
        aliases: ['quick editor', 'editor', 'scratch', 'scratchpad', 'notepad', '编辑器', '快捷编辑', '记事本', '草稿'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['pane-actions'],
      execute: async () => {
        // Single-instance rule: if the editor lives in the detached window,
        // focus it instead of opening the surface.
        if (await isQuickEditorWindowOpen()) {
          await showQuickEditorWindow()
          return { ok: true }
        }
        useAppStore.getState().openLauncherHostSurface('quick-editor')
        return { ok: true, keepOpen: true }
      },
    },
  ]
}
