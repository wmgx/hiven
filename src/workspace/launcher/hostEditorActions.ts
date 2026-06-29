import { PLUGIN_SURFACE_PANEL_ID } from '../../components/pluginSurface/PluginSurfacePanel'
import {
  compressTextToThreeSentences,
  convertJsonTextToYaml,
  extractJsonFieldPaths,
  formatTextAsBullets,
  minifyJsonText,
  quoteTextAsCodeBlock,
  rewriteTextPolitely,
} from '../../workflow/editorTextTransforms'
import { openEditorPanel } from '../editorBridge'
import { applyEffects } from '../effectRunner'
import { runtimeRegistry } from '../runtimeRegistry'
import { useWorkspaceStore } from '../workspaceStore'
import { translate } from '../../i18n'
import type { LauncherItem, LauncherParamOption, TextRange } from './types'

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

const EDITOR_WINDOW_REQUIRED_MESSAGE = 'Editor command actions can only run in the editor window'

function isEditorWindowRuntime(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'editor'
  } catch {
    return false
  }
}

function guardEditorWindowRuntime(): { ok: false; message: string } | undefined {
  return isEditorWindowRuntime() ? undefined : { ok: false, message: EDITOR_WINDOW_REQUIRED_MESSAGE }
}

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

export function getHostEditorActionItems(): LauncherItem[] {
  return [
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
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
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
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
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
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
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
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
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
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
        setActivePaneLanguage('auto')
        return { ok: true }
      },
      executeWithParams: async (_ctx, params) => {
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
        setActivePaneLanguage(params.language)
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
      execute: async () => guardEditorWindowRuntime() ?? { ok: rewriteActiveEditorTextPolitely() },
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
      execute: async () => guardEditorWindowRuntime() ?? { ok: compressActiveEditorTextToThreeSentences() },
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
      execute: async () => guardEditorWindowRuntime() ?? { ok: formatActiveEditorTextAsBullets() },
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
      execute: async () => guardEditorWindowRuntime() ?? { ok: quoteActiveEditorTextAsCodeBlock() },
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
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
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
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
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
      execute: async () => guardEditorWindowRuntime() ?? { ok: minifyActiveEditorJson() },
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
      execute: async () => guardEditorWindowRuntime() ?? { ok: convertActiveEditorJsonToYaml() },
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
      execute: async () => guardEditorWindowRuntime() ?? { ok: extractActiveEditorJsonFields() },
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
        const guard = guardEditorWindowRuntime()
        if (guard) return guard
        await attachBuiltinPluginSurfacePanel('json', true)
        return { ok: true }
      },
    },
  ]
}
