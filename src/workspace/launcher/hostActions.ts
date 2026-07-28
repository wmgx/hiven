import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'
import { useAppStore } from '../../store'
import type { LauncherItem } from './types'
import { getHostEditorActionItems } from './hostEditorActions'
import { isQuickEditorWindowOpen, showQuickEditorWindow } from '../windowManager/quickEditorWindow'

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
          // Prefer the current window; fall back to launcher label.
          await invoke('open_devtools')
          return { ok: true, keepOpen: true }
        } catch (error) {
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
