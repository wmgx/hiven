import { createEditorPane } from '../editorBridge'
import { requestOpenPluginSurfaceTool } from '../pluginSurfaceOpenRequest'
import type { LauncherItem } from './types'
import { getHostEditorActionItems } from './hostEditorActions'

type SystemPowerAction = 'restart' | 'shutdown' | 'lock-screen'

async function performSystemPowerAction(action: SystemPowerAction): Promise<{ ok: boolean; message?: string }> {
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
      pinnable: false,
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
      pinnable: false,
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
      pinnable: false,
      execute: async () => performSystemPowerAction('lock-screen'),
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
      pinnable: false,
      legacyUsageKeys: ['show-plugins-page'],
      execute: async () => {
        await requestOpenPluginSurfaceTool({
          source: 'builtin',
          pluginId: 'system-settings',
          surfaceId: 'main',
        })
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
      pinnable: false,
      legacyUsageKeys: ['show-settings-page'],
      execute: async () => {
        await requestOpenPluginSurfaceTool({
          source: 'builtin',
          pluginId: 'system-settings',
          surfaceId: 'main',
        })
        return { ok: true, keepOpen: true }
      },
    },
    {
      systemKey: 'host:pane:new',
      kind: 'host',
      display: {
        title: 'New Pane',
        titleI18n: { zh: '新建面板' },
        subtitle: 'Create a new empty pane',
        subtitleI18n: { zh: '创建一个空白面板' },
        icon: 'PanelRightOpen',
        aliases: ['pane', 'new pane', 'panel', '新建面板', '分栏'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['pane-actions'],
      pinnable: false,
      execute: async () => {
        await createEditorPane({ text: '', focus: true, direction: 'right' })
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:split-right',
      kind: 'host',
      display: {
        title: 'Split Pane Right',
        titleI18n: { zh: '向右分栏' },
        subtitle: 'Open an empty pane to the right',
        subtitleI18n: { zh: '在右侧打开一个空白面板' },
        icon: 'PanelRight',
        aliases: ['split', 'split right', 'pane right', '右侧分栏', '分栏'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['pane-actions'],
      pinnable: false,
      execute: async () => {
        await createEditorPane({ text: '', focus: true, direction: 'right' })
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:split-down',
      kind: 'host',
      display: {
        title: 'Split Pane Down',
        titleI18n: { zh: '向下分栏' },
        subtitle: 'Open an empty pane below',
        subtitleI18n: { zh: '在下方打开一个空白面板' },
        icon: 'PanelBottom',
        aliases: ['split', 'split down', 'pane down', '向下分栏', '分栏'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      requiredCapabilities: ['pane-actions'],
      pinnable: false,
      execute: async () => {
        await createEditorPane({ text: '', focus: true, direction: 'bottom' })
        return { ok: true }
      },
    },
    ...getHostEditorActionItems(),
  ]
}
