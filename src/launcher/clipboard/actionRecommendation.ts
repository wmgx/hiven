/**
 * Action Recommendation — MVP rule-based recommendations for an Object Block.
 *
 * Design: hiven_clipboard_object_block_recommendation_ai_task.md §7
 *
 * Phase R1: recommend actions based on detected clipboard type.
 */

import type { LauncherObjectBlock, ObjectBlockKind } from './objectBlock'
import { discoverActionsForBlock, type DiscoveredPluginAction } from './pluginActionManifest'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RecommendedOutputTarget =
  | 'copy'
  | 'copy-and-keep-open'
  | 'open-editor'
  | 'open-plugin-surface'
  | 'open-url'
  | 'replace-selection'
  | 'replace-pane'
  | 'new-pane'
  | 'insert-below'
  | 'open-bottom-panel'
  | 'set-renderer'

export type RecommendedAction = {
  id: string
  title: string
  titleZh: string
  subtitle?: string
  icon?: string
  pluginId?: string
  /** Product-level provider label shown to users; plugin ids stay internal. */
  provider?: string
  defaultOutput: RecommendedOutputTarget
  alternativeOutputs?: RecommendedOutputTarget[]
  requiresParams?: boolean
  hasPreview?: boolean
  riskLevel?: 'none' | 'low' | 'medium' | 'high'
  riskText?: string
  state?: 'ready' | 'loading' | 'disabled' | 'error' | 'needs-config' | 'partial'
  defaultKeyHint?: string
}

// ─── Action Catalogs ───────────────────────────────────────────────────────────

const JSON_ACTIONS: RecommendedAction[] = [
  {
    id: 'format-clipboard-json',
    title: 'Format Clipboard JSON',
    titleZh: '格式化剪贴板 JSON',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
  },
  {
    id: 'open-clipboard-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
  {
    id: 'json-to-yaml',
    title: 'Convert JSON to YAML',
    titleZh: '转换 JSON 为 YAML',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
  },
  {
    id: 'minify-json',
    title: 'Minify JSON',
    titleZh: '压缩 JSON 为单行',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
  },
  {
    id: 'sort-json-keys',
    title: 'Sort JSON Keys',
    titleZh: '排序 JSON keys',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
    hasPreview: true,
  },
  {
    id: 'json-expression',
    title: 'Extract JSON with Expression',
    titleZh: '用表达式提取 JSON',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'open-bottom-panel',
    alternativeOutputs: ['open-editor', 'copy'],
    requiresParams: true,
    hasPreview: true,
  },
]

const URL_ACTIONS: RecommendedAction[] = [
  {
    id: 'open-clipboard-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
  {
    id: 'open-url-in-browser',
    title: 'Open URL in Browser',
    titleZh: '打开链接',
    pluginId: 'web-open',
    provider: 'Web Open',
    defaultOutput: 'open-url',
  },
]

const ENCODE_DECODE_ACTIONS: RecommendedAction[] = [
  {
    id: 'base64-encode',
    title: 'Base64 Encode',
    titleZh: 'Base64 编码',
    pluginId: 'encode-decode-tools',
    provider: 'Encode / Decode Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
    requiresParams: true,
    hasPreview: true,
  },
  {
    id: 'base64-decode',
    title: 'Base64 Decode',
    titleZh: 'Base64 解码',
    pluginId: 'encode-decode-tools',
    provider: 'Encode / Decode Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
    requiresParams: true,
    hasPreview: true,
  },
  {
    id: 'url-encode',
    title: 'URL Encode',
    titleZh: 'URL encode',
    pluginId: 'encode-decode-tools',
    provider: 'Encode / Decode Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
    requiresParams: true,
    hasPreview: true,
  },
  {
    id: 'url-decode',
    title: 'URL Decode',
    titleZh: 'URL decode',
    pluginId: 'encode-decode-tools',
    provider: 'Encode / Decode Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
    requiresParams: true,
    hasPreview: true,
  },
  {
    id: 'html-encode',
    title: 'HTML Encode',
    titleZh: 'HTML encode',
    pluginId: 'encode-decode-tools',
    provider: 'Encode / Decode Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
    requiresParams: true,
    hasPreview: true,
  },
  {
    id: 'html-decode',
    title: 'HTML Decode',
    titleZh: 'HTML decode',
    pluginId: 'encode-decode-tools',
    provider: 'Encode / Decode Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
    requiresParams: true,
    hasPreview: true,
  },
]

const TEXT_ACTIONS: RecommendedAction[] = [
  {
    id: 'translate-clipboard',
    title: 'Translate Clipboard Text',
    titleZh: '翻译剪贴板文本',
    pluginId: 'translate',
    provider: 'Translate',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-plugin-surface', 'open-editor'],
  },
  ...ENCODE_DECODE_ACTIONS,
  {
    id: 'open-clipboard-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
  {
    id: 'summarize-clipboard',
    title: 'Summarize Clipboard Text',
    titleZh: '总结剪贴板文本',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
  },
]


const CSV_ACTIONS: RecommendedAction[] = [
  {
    id: 'open-csv-tools-surface',
    title: 'Open CSV Tools Surface',
    titleZh: '打开表格转换器',
    pluginId: 'csv',
    provider: 'CSV Tools',
    defaultOutput: 'open-plugin-surface',
    requiresParams: true,
    hasPreview: true,
  },
]

const SQL_ACTIONS: RecommendedAction[] = [
  {
    id: 'format-sql',
    title: 'Format SQL',
    titleZh: '格式化 SQL',
    pluginId: 'sql-tools',
    provider: 'SQL Tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
  },
]

const FORMATTER_ACTIONS_BY_KIND: Partial<Record<ObjectBlockKind, RecommendedAction[]>> = {
  css: [{ id: 'format-css', title: 'Format CSS', titleZh: '格式化 CSS', pluginId: 'css', provider: 'CSS Formatter', defaultOutput: 'copy', alternativeOutputs: ['open-editor'] }],
  xml: [{ id: 'format-xml', title: 'Format XML', titleZh: '格式化 XML', pluginId: 'xml', provider: 'XML Formatter', defaultOutput: 'copy', alternativeOutputs: ['open-editor'] }],
  jwt: [{ id: 'decode-jwt', title: 'Decode JWT', titleZh: '解码 JWT', pluginId: 'jwt', provider: 'JWT Tools', defaultOutput: 'copy', riskLevel: 'low', riskText: '只解码，不验证签名' }],
  timestamp: [{ id: 'convert-timestamp', title: 'Convert Timestamp', titleZh: '转换时间戳', pluginId: 'date-time-assistant', provider: 'Date Time Assistant', defaultOutput: 'copy', alternativeOutputs: ['open-editor'] }],
}

const COMMAND_ACTIONS: RecommendedAction[] = [
  {
    id: 'open-clipboard-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
]

const YAML_ACTIONS: RecommendedAction[] = [
  {
    id: 'yaml-to-json',
    title: 'Convert YAML to JSON',
    titleZh: 'YAML 转 JSON',
    pluginId: 'yaml',
    provider: 'YAML',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
  },
  {
    id: 'open-clipboard-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
]

const QUERY_STRING_ACTIONS: RecommendedAction[] = [
  {
    id: 'query-string-to-json',
    title: 'Query String → JSON',
    titleZh: 'Query String 转 JSON',
    pluginId: 'queryString',
    provider: 'Query String',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
  },
  {
    id: 'open-clipboard-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
]

const SECRET_ACTIONS: RecommendedAction[] = [
  // Secret content: suppressed network actions, only local open
  {
    id: 'open-clipboard-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
]

const FALLBACK_ACTIONS: RecommendedAction[] = [
  {
    id: 'open-clipboard-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
  {
    id: 'open-clipboard-history',
    title: 'Open Clipboard History',
    titleZh: '打开剪贴板历史',
    pluginId: 'clipboard-history',
    provider: 'Clipboard History',
    defaultOutput: 'open-plugin-surface',
  },
]

// ─── Editor Selection Actions ──────────────────────────────────────────────────

const EDITOR_JSON_ACTIONS: RecommendedAction[] = [
  {
    id: 'format-selection',
    title: 'Format Selection',
    titleZh: '格式化当前选区',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'replace-selection',
  },
  {
    id: 'selection-to-yaml',
    title: 'Convert Selection to YAML',
    titleZh: '转换当前选区为 YAML',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'replace-selection',
  },
  {
    id: 'minify-selection',
    title: 'Minify Selection',
    titleZh: '压缩当前选区',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'replace-selection',
  },
  {
    id: 'sort-json-keys',
    title: 'Sort Selection JSON Keys',
    titleZh: '排序当前选区 JSON keys',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'replace-selection',
    alternativeOutputs: ['new-pane', 'copy'],
    hasPreview: true,
  },
  {
    id: 'json-expression',
    title: 'Extract JSON with Expression',
    titleZh: '用表达式提取 JSON',
    pluginId: 'json-tools',
    provider: 'JSON Tools',
    defaultOutput: 'open-bottom-panel',
    alternativeOutputs: ['new-pane', 'copy'],
    requiresParams: true,
    hasPreview: true,
  },
]

const EDITOR_TEXT_ACTIONS: RecommendedAction[] = [
  ...ENCODE_DECODE_ACTIONS.map((action) => ({
    ...action,
    titleZh: action.titleZh.replace('剪贴板', '当前选区'),
    defaultOutput: 'replace-selection' as const,
    alternativeOutputs: ['new-pane' as const, 'copy' as const],
  })),
  {
    id: 'format-selection',
    title: 'Format Selection',
    titleZh: '格式化当前选区',
    defaultOutput: 'copy',
  },
]

// ─── Recommendation logic ──────────────────────────────────────────────────────

/** History-item text: paste/copy first; transforms still come from ranking + objectBlockText. */
const TEXT_HISTORY_ACTIONS: RecommendedAction[] = [
  {
    id: 'paste-history-text',
    title: 'Paste to Front App',
    titleZh: '粘贴到前台应用',
    provider: 'Clipboard History',
    defaultOutput: 'copy',
  },
  {
    id: 'copy-history-text',
    title: 'Copy to Clipboard',
    titleZh: '复制到剪贴板',
    provider: 'Clipboard History',
    defaultOutput: 'copy',
  },
  {
    id: 'open-history-in-quick-editor',
    title: 'Open in Quick Editor',
    titleZh: '打开到快捷编辑器',
    provider: 'Quick Editor',
    defaultOutput: 'open-editor',
  },
]

const IMAGE_HISTORY_ACTIONS: RecommendedAction[] = [
  {
    id: 'paste-history-image',
    title: 'Paste Image',
    titleZh: '粘贴图片',
    provider: 'Clipboard History',
    defaultOutput: 'copy',
  },
  {
    id: 'copy-history-image',
    title: 'Copy Image to Clipboard',
    titleZh: '复制图片到剪贴板',
    provider: 'Clipboard History',
    defaultOutput: 'copy',
  },
]

const FILES_HISTORY_ACTIONS: RecommendedAction[] = [
  {
    id: 'paste-history-files',
    title: 'Paste Files',
    titleZh: '粘贴文件',
    provider: 'Clipboard History',
    defaultOutput: 'copy',
  },
  {
    id: 'copy-history-file-paths',
    title: 'Copy File Paths',
    titleZh: '复制文件路径',
    provider: 'Clipboard History',
    defaultOutput: 'copy',
  },
]

const CLIPBOARD_ACTIONS_BY_KIND: Record<ObjectBlockKind, RecommendedAction[]> = {
  json: JSON_ACTIONS,
  url: URL_ACTIONS,
  text: TEXT_ACTIONS,
  command: COMMAND_ACTIONS,
  secret: SECRET_ACTIONS,
  'secret-like': SECRET_ACTIONS,
  unknown: FALLBACK_ACTIONS,
  markdown: TEXT_ACTIONS,
  'plain-text': TEXT_ACTIONS,
  csv: CSV_ACTIONS,
  sql: SQL_ACTIONS,
  css: FORMATTER_ACTIONS_BY_KIND.css ?? FALLBACK_ACTIONS,
  xml: FORMATTER_ACTIONS_BY_KIND.xml ?? FALLBACK_ACTIONS,
  jwt: FORMATTER_ACTIONS_BY_KIND.jwt ?? FALLBACK_ACTIONS,
  timestamp: FORMATTER_ACTIONS_BY_KIND.timestamp ?? FALLBACK_ACTIONS,
  yaml: YAML_ACTIONS,
  'query-string': QUERY_STRING_ACTIONS,
  image: IMAGE_HISTORY_ACTIONS,
  files: FILES_HISTORY_ACTIONS,
}

const EDITOR_ACTIONS_BY_KIND: Partial<Record<ObjectBlockKind, RecommendedAction[]>> = {
  json: EDITOR_JSON_ACTIONS,
  text: EDITOR_TEXT_ACTIONS,
  markdown: EDITOR_TEXT_ACTIONS,
  'plain-text': EDITOR_TEXT_ACTIONS,
  sql: SQL_ACTIONS.map((action) => ({ ...action, defaultOutput: 'replace-selection' as const })),
  css: (FORMATTER_ACTIONS_BY_KIND.css ?? []).map((action) => ({ ...action, defaultOutput: 'replace-selection' as const })),
  xml: (FORMATTER_ACTIONS_BY_KIND.xml ?? []).map((action) => ({ ...action, defaultOutput: 'replace-selection' as const })),
  csv: CSV_ACTIONS,
}

export function recommendActionsForBlock(block: LauncherObjectBlock): RecommendedAction[] {
  if (block.source === 'history-item') {
    // Image/files: host injects these as list rows (no textMatch path).
    // Text: paste/copy as primary host rows; format/encode still via ranking + objectBlockText.
    if (block.kind === 'image') return IMAGE_HISTORY_ACTIONS
    if (block.kind === 'files') return FILES_HISTORY_ACTIONS
    return TEXT_HISTORY_ACTIONS
  }
  if (block.source === 'clipboard') {
    return CLIPBOARD_ACTIONS_BY_KIND[block.kind] ?? FALLBACK_ACTIONS
  }
  if (block.source === 'editor-selection' || block.source === 'editor-document') {
    return EDITOR_ACTIONS_BY_KIND[block.kind] ?? EDITOR_TEXT_ACTIONS
  }
  // tool-result / snapshot / query / etc.: always offer Quick Editor overwrite
  if (block.payloadText != null || block.preview != null) {
    return [
      {
        id: 'open-in-quick-editor',
        title: 'Open in Quick Editor',
        titleZh: '打开到快捷编辑器',
        provider: 'Quick Editor',
        defaultOutput: 'open-editor',
      },
      ...FALLBACK_ACTIONS.filter((action) => action.id !== 'open-clipboard-editor'),
    ]
  }
  return FALLBACK_ACTIONS
}

export function getSearchOnlyActions(): RecommendedAction[] {
  return [
    {
      id: 'open-editor',
      title: 'Open Quick Editor',
      titleZh: '打开快捷编辑器',
      provider: 'Quick Editor',
      defaultOutput: 'open-editor',
    },
    {
      id: 'open-clipboard-history',
      title: 'Open Clipboard History',
      titleZh: '打开剪贴板历史',
      pluginId: 'clipboard-history',
      provider: 'Clipboard History',
      defaultOutput: 'open-plugin-surface',
    },
  ]
}


// ─── Merged recommendation (static + plugin manifest) ─────────────────────────
// Accepts-based tool recommendations live in acceptsRecommendation.ts
// (recommendActionsFromToolAccepts). Hosts may merge both sources.

/** Max actions returned for one object block (1 primary + secondaries). */
export const RECOMMENDED_ACTIONS_MAX = 5

export function recommendActionsWithPlugins(block: LauncherObjectBlock): RecommendedAction[] {
  const staticActions = recommendActionsForBlock(block)

  const discovered = discoverActionsForBlock({
    kind: block.kind,
    source: block.source as 'clipboard' | 'editor-selection' | 'editor-document',
    textLength: block.preview?.length ?? 0,
    isSecret: block.secretMasked ?? false,
  })

  // Convert discovered plugin actions to RecommendedAction format
  const pluginActions: RecommendedAction[] = discovered
    .filter((d) => !staticActions.some((s) => s.id === d.id))
    .map((d): RecommendedAction => ({
      id: d.id,
      title: d.title,
      titleZh: d.titleZh,
      icon: d.icon,
      pluginId: d.pluginId,
      provider: d.provider ?? d.pluginId,
      defaultOutput: d.defaultOutput,
      alternativeOutputs: d.outputTargets.filter((t) => t !== d.defaultOutput),
    }))

  // Primary = first static (kind catalog order); then plugins; cap for scannable list.
  return [...staticActions, ...pluginActions].slice(0, RECOMMENDED_ACTIONS_MAX)
}
