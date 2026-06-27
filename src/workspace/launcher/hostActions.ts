import { useWorkspaceStore } from '../workspaceStore'
import { translate } from '../../i18n'
import type { LauncherItem, LauncherParamOption } from './types'

type SystemPowerAction = 'restart' | 'shutdown' | 'lock-screen'

const LANGUAGE_OPTIONS: LauncherParamOption[] = [
  { label: 'Auto Detect', value: 'auto', labelI18n: { zh: '自动检测' } },
  { label: 'Plain Text', value: 'plaintext', labelI18n: { zh: '纯文本' } },
  { label: 'JSON', value: 'json' },
  { label: 'JavaScript', value: 'javascript' },
  { label: 'TypeScript', value: 'typescript' },
  { label: 'HTML', value: 'html' },
  { label: 'CSS', value: 'css' },
  { label: 'Markdown', value: 'markdown' },
  { label: 'YAML', value: 'yaml' },
  { label: 'XML', value: 'xml' },
  { label: 'SQL', value: 'sql' },
  { label: 'Python', value: 'python' },
  { label: 'Shell', value: 'shell' },
  { label: 'Go', value: 'go' },
  { label: 'Rust', value: 'rust' },
  { label: 'Java', value: 'java' },
  { label: 'C#', value: 'csharp' },
  { label: 'C++', value: 'cpp' },
]

const EDITOR_LANGUAGE_VALUES = new Set(
  LANGUAGE_OPTIONS
    .map((option) => typeof option === 'string' ? option : option.value)
    .filter((value) => value !== 'auto'),
)

function focusRelativePane(delta: 1 | -1): void {
  const state = useWorkspaceStore.getState()
  const index = state.paneOrder.indexOf(state.activePaneId)
  if (index < 0 || state.paneOrder.length === 0) return
  const nextIndex = (index + delta + state.paneOrder.length) % state.paneOrder.length
  state.setActivePaneId(state.paneOrder[nextIndex])
}

function setActivePaneLanguage(requested: unknown): void {
  const language = String(requested ?? 'auto')
  const state = useWorkspaceStore.getState()
  const paneId = state.activePaneId
  if (language === 'auto') {
    state.updatePaneLanguageSource(paneId, 'auto')
    return
  }
  const normalized = EDITOR_LANGUAGE_VALUES.has(language) ? language : 'plaintext'
  state.updatePaneLanguage(paneId, normalized)
  useWorkspaceStore.getState().updatePaneLanguageSource(paneId, 'manual')
}

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
      pinnable: false,
      execute: async () => performSystemPowerAction('lock-screen'),
    },
  ]
}

export function getHostPaneControlItems(): LauncherItem[] {
  return [
    {
      systemKey: 'host:view:editor',
      kind: 'host',
      display: {
        title: 'Editor',
        titleI18n: { zh: '编辑器' },
        subtitle: 'Open the main workspace',
        subtitleI18n: { zh: '打开主工作区' },
        icon: 'PanelTopOpen',
        aliases: ['main', 'home', 'editor', 'main-panel', '主面板', '编辑器'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      pinnable: false,
      legacyUsageKeys: ['show-main-panel', 'core-pane.show-main-panel'],
      execute: async (ctx) => {
        await ctx.api.showMainPanel()
        return { ok: true }
      },
    },
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
      pinnable: false,
      legacyUsageKeys: ['show-plugins-page'],
      execute: async (ctx) => {
        await ctx.api.showPluginsPage()
        return { ok: true }
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
      pinnable: false,
      legacyUsageKeys: ['show-settings-page'],
      execute: async (ctx) => {
        await ctx.api.showSettingsPage()
        return { ok: true }
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
      pinnable: false,
      execute: async () => {
        useWorkspaceStore.getState().createPane({ text: '', focus: true, direction: 'right' })
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
      pinnable: false,
      execute: async () => {
        useWorkspaceStore.getState().createPane({ text: '', focus: true, direction: 'right' })
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
      pinnable: false,
      execute: async () => {
        useWorkspaceStore.getState().createPane({ text: '', focus: true, direction: 'bottom' })
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:close',
      kind: 'host',
      display: {
        title: 'Close Current Pane',
        titleI18n: { zh: '关闭当前面板' },
        subtitle: 'Close the active pane or surface',
        subtitleI18n: { zh: '关闭当前面板或面板内表面' },
        icon: 'PanelRightClose',
        aliases: ['close pane', 'close panel', '关闭面板'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      pinnable: false,
      execute: async () => {
        useWorkspaceStore.getState().closeActiveSurfaceOrPane()
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:focus-next',
      kind: 'host',
      display: {
        title: 'Focus Next Pane',
        titleI18n: { zh: '聚焦下一个面板' },
        icon: 'ArrowRight',
        aliases: ['next pane', 'focus next pane', '下一个面板'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      pinnable: false,
      execute: async () => {
        focusRelativePane(1)
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:focus-previous',
      kind: 'host',
      display: {
        title: 'Focus Previous Pane',
        titleI18n: { zh: '聚焦上一个面板' },
        icon: 'ArrowLeft',
        aliases: ['previous pane', 'focus previous pane', '上一个面板'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      pinnable: false,
      execute: async () => {
        focusRelativePane(-1)
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:toggle-sticky-scroll',
      kind: 'host',
      display: {
        title: 'Toggle Sticky Scroll',
        titleI18n: { zh: '切换层级吸顶' },
        subtitle: 'Enable or disable sticky scroll in the active pane',
        subtitleI18n: { zh: '开启或关闭当前面板的层级吸顶' },
        icon: 'PanelTop',
        aliases: ['sticky-scroll', 'toggle-sticky-scroll', '层级吸顶', '吸顶'],
      },
      behavior: { type: 'perform' },
      surfaces: ['command-palette'],
      pinnable: false,
      legacyUsageKeys: ['core-pane.toggle-sticky-scroll'],
      execute: async (ctx) => {
        const state = useWorkspaceStore.getState()
        const pane = state.panes[state.activePaneId]
        if (!pane) return { ok: false, message: translate(ctx.locale, 'workspace', 'pane.noActive') }
        const next = pane.stickyScroll !== true
        state.updatePaneStickyScroll(state.activePaneId, next)
        ctx.api.showMessage(
          translate(ctx.locale, 'workspace', next ? 'pane.stickyScroll.enabled' : 'pane.stickyScroll.disabled'),
          'info',
        )
        return { ok: true }
      },
    },
    {
      systemKey: 'host:pane:set-language',
      kind: 'host',
      display: {
        title: 'Set Language',
        titleI18n: { zh: '设置语言' },
        subtitle: 'Change the active pane language mode',
        subtitleI18n: { zh: '修改当前面板的语言模式' },
        icon: 'Code2',
        aliases: ['language', 'set-language', '语言'],
      },
      behavior: { type: 'perform' },
      surfaces: ['command-palette'],
      pinnable: false,
      legacyUsageKeys: ['core-pane.set-language'],
      params: [
        {
          key: 'language',
          label: 'Language',
          labelI18n: { zh: '语言' },
          type: 'single-select',
          options: LANGUAGE_OPTIONS,
          default: 'auto',
          required: true,
        },
      ],
      requireParamSelection: true,
      execute: async () => {
        setActivePaneLanguage('auto')
        return { ok: true }
      },
      executeWithParams: async (_ctx, params) => {
        setActivePaneLanguage(params.language)
        return { ok: true }
      },
    },
  ]
}
