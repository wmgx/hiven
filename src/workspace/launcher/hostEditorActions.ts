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
import type { LauncherItem, TextRange } from './types'

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
  ]
}
