import { useWorkspaceStore } from '../workspaceStore'
import { translate } from '../../i18n'
import { createEditorPane, openEditorPanel } from '../editorBridge'
import { applyEffects } from '../effectRunner'
import { showLauncherWindow } from '../windowManager/launcherWindow'
import {
  compressTextToThreeSentences,
  convertJsonTextToYaml,
  extractJsonFieldPaths,
  formatTextAsBullets,
  minifyJsonText,
  quoteTextAsCodeBlock,
  rewriteTextPolitely,
} from '../../workflow/editorTextTransforms'
import type { LauncherItem, LauncherParamOption, TextRange } from './types'
import { runtimeRegistry } from '../runtimeRegistry'
import { PLUGIN_SURFACE_PANEL_ID } from '../../components/pluginSurface/PluginSurfacePanel'

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

function getActiveEditorSurfaceText(): string | undefined {
  const state = useWorkspaceStore.getState()
  const paneId = state.activePaneId
  const pane = state.panes[paneId]
  const editor = runtimeRegistry.getCodeEditor(paneId)
  const selection = editor?.getSelection?.()
  const selectedText = selection && !selection.isEmpty?.()
    ? editor?.getModel?.()?.getValueInRange(selection)
    : undefined
  const text = selectedText ?? pane?.text ?? ''
  return text ? text : undefined
}

async function attachBuiltinPluginSurfacePanel(pluginId: string, withInitialText = false): Promise<void> {
  const text = withInitialText ? getActiveEditorSurfaceText() : undefined
  await openEditorPanel({
    panelId: PLUGIN_SURFACE_PANEL_ID,
    placement: 'right',
    inputs: {
      text,
      target: {
        source: 'builtin',
        pluginId,
        surfaceId: 'main',
        initialText: text,
      },
    },
  })
}

function getActiveEditorTextTarget(): { text: string; paneId: string; range?: TextRange } | undefined {
  const state = useWorkspaceStore.getState()
  const paneId = state.activePaneId
  const pane = state.panes[paneId]
  if (!pane) return undefined
  const editor = runtimeRegistry.getCodeEditor(paneId)
  const selection = editor?.getSelection?.()
  const selectedText = selection && !selection.isEmpty?.()
    ? editor?.getModel?.()?.getValueInRange(selection)
    : undefined
  if (selectedText) {
    return {
      text: selectedText,
      paneId,
      range: {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      },
    }
  }
  return { text: pane.text ?? '', paneId }
}

function replaceEditorTextTarget(target: { text: string; paneId: string; range?: TextRange }, text: string): void {
  applyEffects([{
    type: 'text.replace',
    target: target.range ? { paneId: target.paneId, range: target.range } : { paneId: target.paneId },
    text,
  }])
}

function rewriteActiveEditorTextPolitely(): boolean {
  const target = getActiveEditorTextTarget()
  if (!target || !target.text.trim()) return false
  replaceEditorTextTarget(target, rewriteTextPolitely(target.text))
  return true
}

function compressActiveEditorTextToThreeSentences(): boolean {
  const target = getActiveEditorTextTarget()
  if (!target || !target.text.trim()) return false
  replaceEditorTextTarget(target, compressTextToThreeSentences(target.text))
  return true
}

function formatActiveEditorTextAsBullets(): boolean {
  const target = getActiveEditorTextTarget()
  if (!target || !target.text.trim()) return false
  const formatted = formatTextAsBullets(target.text)
  if (!formatted) return false
  replaceEditorTextTarget(target, formatted)
  return true
}

function quoteActiveEditorTextAsCodeBlock(): boolean {
  const target = getActiveEditorTextTarget()
  if (!target || !target.text.trim()) return false
  replaceEditorTextTarget(target, quoteTextAsCodeBlock(target.text))
  return true
}

function minifyActiveEditorJson(): boolean {
  const target = getActiveEditorTextTarget()
  if (!target || !target.text.trim()) return false
  const minified = minifyJsonText(target.text)
  if (!minified) return false
  replaceEditorTextTarget(target, minified)
  return true
}

function convertActiveEditorJsonToYaml(): boolean {
  const target = getActiveEditorTextTarget()
  if (!target || !target.text.trim()) return false
  const yaml = convertJsonTextToYaml(target.text)
  if (!yaml) return false
  replaceEditorTextTarget(target, yaml)
  return true
}

function extractActiveEditorJsonFields(): boolean {
  const target = getActiveEditorTextTarget()
  if (!target || !target.text.trim()) return false
  const fields = extractJsonFieldPaths(target.text)
  if (!fields) return false
  replaceEditorTextTarget(target, fields.join('\n'))
  return true
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
      systemKey: 'host:global:search-all-hiven',
      kind: 'host',
      display: {
        title: 'Search all Hiven...',
        titleI18n: { zh: '搜索整个 Hiven...' },
        subtitle: 'Open the global launcher',
        subtitleI18n: { zh: '打开全局 Launcher' },
        icon: 'Search',
        aliases: ['global search', 'search all', 'launcher', 'all hiven', '全局搜索', '启动器'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      pinnable: false,
      staticPriority: 110,
      execute: async () => {
        await showLauncherWindow()
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
      requiredCapabilities: ['settings'],
      pinnable: false,
      legacyUsageKeys: ['show-plugins-page'],
      execute: async (ctx) => {
        await ctx.api.showPluginsPage()
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
      execute: async (ctx) => {
        await ctx.api.showSettingsPage()
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
    {
      systemKey: 'host:editor:rewrite-politely',
      kind: 'host',
      display: {
        title: 'Rewrite More Politely',
        titleI18n: { zh: '改得更礼貌' },
        subtitle: 'Rewrite the current selection or pane in a polite tone',
        subtitleI18n: { zh: '将当前选区或面板内容改写得更礼貌' },
        icon: 'MessageSquareReply',
        aliases: ['polite', 'rewrite politely', '礼貌', '润色'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['text-input-actions'],
      pinnable: false,
      execute: async () => ({ ok: rewriteActiveEditorTextPolitely() }),
    },
    {
      systemKey: 'host:editor:compress-three-sentences',
      kind: 'host',
      display: {
        title: 'Compress to Three Sentences',
        titleI18n: { zh: '压缩成三句话' },
        subtitle: 'Compress the current selection or pane to three sentences',
        subtitleI18n: { zh: '将当前选区或面板内容压缩成三句话' },
        icon: 'ListCollapse',
        aliases: ['compress', 'three sentences', 'summary', '三句话', '压缩'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['text-input-actions'],
      pinnable: false,
      execute: async () => ({ ok: compressActiveEditorTextToThreeSentences() }),
    },
    {
      systemKey: 'host:editor:format-bullets',
      kind: 'host',
      display: {
        title: 'Format as Bullet List',
        titleI18n: { zh: '整理成项目符号' },
        subtitle: 'Turn the current selection or pane into a bullet list',
        subtitleI18n: { zh: '将当前选区或面板内容整理成项目符号列表' },
        icon: 'List',
        aliases: ['bullet list', 'format bullets', '项目符号', '列表'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['text-input-actions'],
      pinnable: false,
      execute: async () => ({ ok: formatActiveEditorTextAsBullets() }),
    },
    {
      systemKey: 'host:editor:quote-code-block',
      kind: 'host',
      display: {
        title: 'Quote as Code Block',
        titleI18n: { zh: '引用为代码块' },
        subtitle: 'Wrap the current selection or pane in a Markdown code block',
        subtitleI18n: { zh: '将当前选区或面板内容包装为 Markdown 代码块' },
        icon: 'CodeXml',
        aliases: ['code block', 'quote code', '代码块', '引用'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['text-input-actions'],
      pinnable: false,
      execute: async () => ({ ok: quoteActiveEditorTextAsCodeBlock() }),
    },
    {
      systemKey: 'host:editor:attach-translate-panel',
      kind: 'host',
      display: {
        title: 'Attach Translate Panel',
        titleI18n: { zh: '附着翻译面板' },
        subtitle: 'Attach Translate to the current editor',
        subtitleI18n: { zh: '将翻译 Surface 附着到当前编辑器' },
        icon: 'Languages',
        aliases: ['translate panel', 'attach translate', '翻译面板'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['pane-actions'],
      pinnable: false,
      execute: async () => {
        await attachBuiltinPluginSurfacePanel('translate', true)
        return { ok: true }
      },
    },
    {
      systemKey: 'host:editor:attach-clipboard-panel',
      kind: 'host',
      display: {
        title: 'Attach Clipboard Panel',
        titleI18n: { zh: '附着剪贴板面板' },
        subtitle: 'Attach Clipboard History to the current editor',
        subtitleI18n: { zh: '将剪贴板历史 Surface 附着到当前编辑器' },
        icon: 'Clipboard',
        aliases: ['clipboard panel', 'attach clipboard', '剪贴板面板'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['pane-actions'],
      pinnable: false,
      execute: async () => {
        await attachBuiltinPluginSurfacePanel('clipboard-history')
        return { ok: true }
      },
    },
    {
      systemKey: 'host:editor:json-minify',
      kind: 'host',
      display: {
        title: 'Compress JSON to Single Line',
        titleI18n: { zh: 'JSON 压缩为单行' },
        subtitle: 'Minify the current JSON selection or pane',
        subtitleI18n: { zh: '压缩当前 JSON 选区或面板内容' },
        icon: 'Braces',
        aliases: ['json minify', 'single line json', 'json 单行', 'json 压缩'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['text-input-actions'],
      pinnable: false,
      execute: async () => ({ ok: minifyActiveEditorJson() }),
    },
    {
      systemKey: 'host:editor:json-to-yaml',
      kind: 'host',
      display: {
        title: 'Convert JSON to YAML',
        titleI18n: { zh: 'JSON 转 YAML' },
        subtitle: 'Convert the current JSON selection or pane to YAML',
        subtitleI18n: { zh: '将当前 JSON 选区或面板内容转为 YAML' },
        icon: 'FileCode2',
        aliases: ['json yaml', 'json to yaml', 'yaml', '转 yaml'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['text-input-actions'],
      pinnable: false,
      execute: async () => ({ ok: convertActiveEditorJsonToYaml() }),
    },
    {
      systemKey: 'host:editor:json-extract-fields',
      kind: 'host',
      display: {
        title: 'Extract JSON Fields',
        titleI18n: { zh: '提取 JSON 字段' },
        subtitle: 'List field paths from the current JSON selection or pane',
        subtitleI18n: { zh: '列出当前 JSON 选区或面板内容的字段路径' },
        icon: 'ListTree',
        aliases: ['json fields', 'extract fields', '字段', '提取字段'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['text-input-actions'],
      pinnable: false,
      execute: async () => ({ ok: extractActiveEditorJsonFields() }),
    },
    {
      systemKey: 'host:editor:attach-json-panel',
      kind: 'host',
      display: {
        title: 'Attach JSON Panel',
        titleI18n: { zh: '附着 JSON 面板' },
        subtitle: 'Attach JSON to the current editor',
        subtitleI18n: { zh: '将 JSON Surface 附着到当前编辑器' },
        icon: 'Braces',
        aliases: ['json panel', 'attach json', 'json 面板'],
      },
      behavior: { type: 'perform' },
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['pane-actions'],
      pinnable: false,
      execute: async () => {
        await attachBuiltinPluginSurfacePanel('json', true)
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
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['pane-actions'],
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
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['pane-actions'],
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
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['pane-actions'],
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
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['pane-actions'],
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
      surfaces: ['editor-command-bar'],
      requiredCapabilities: ['pane-actions', 'parameter-customization'],
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
