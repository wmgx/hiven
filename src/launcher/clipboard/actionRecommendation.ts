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

export type RecommendedOutputTarget = 'copy' | 'paste-to-foreground' | 'open-editor' | 'open-plugin-surface'

export type RecommendedAction = {
  id: string
  title: string
  titleZh: string
  subtitle?: string
  icon?: string
  pluginId?: string
  defaultOutput: RecommendedOutputTarget
  alternativeOutputs?: RecommendedOutputTarget[]
}

// ─── Action Catalogs ───────────────────────────────────────────────────────────

const JSON_ACTIONS: RecommendedAction[] = [
  {
    id: 'format-clipboard-json',
    title: 'Format Clipboard JSON',
    titleZh: '格式化剪贴板 JSON',
    pluginId: 'json-tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor', 'paste-to-foreground'],
  },
  {
    id: 'open-clipboard-editor',
    title: 'Open Clipboard in Editor',
    titleZh: '打开剪贴板到编辑器',
    defaultOutput: 'open-editor',
  },
  {
    id: 'json-to-yaml',
    title: 'Convert JSON to YAML',
    titleZh: '转换 JSON 为 YAML',
    pluginId: 'json-tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor', 'paste-to-foreground'],
  },
  {
    id: 'minify-json',
    title: 'Minify JSON',
    titleZh: '压缩 JSON 为单行',
    pluginId: 'json-tools',
    defaultOutput: 'copy',
    alternativeOutputs: ['open-editor'],
  },
]

const URL_ACTIONS: RecommendedAction[] = [
  {
    id: 'open-clipboard-editor',
    title: 'Open Clipboard in Editor',
    titleZh: '打开剪贴板到编辑器',
    defaultOutput: 'open-editor',
  },
  {
    id: 'open-url-in-browser',
    title: 'Open URL in Browser',
    titleZh: '打开链接',
    defaultOutput: 'paste-to-foreground',
  },
]

const TEXT_ACTIONS: RecommendedAction[] = [
  {
    id: 'translate-clipboard',
    title: 'Translate Clipboard Text',
    titleZh: '翻译剪贴板文本',
    pluginId: 'translator',
    defaultOutput: 'copy',
    alternativeOutputs: ['paste-to-foreground', 'open-editor'],
  },
  {
    id: 'open-clipboard-editor',
    title: 'Open Clipboard in Editor',
    titleZh: '打开剪贴板到编辑器',
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

const COMMAND_ACTIONS: RecommendedAction[] = [
  {
    id: 'open-clipboard-editor',
    title: 'Open Clipboard in Editor',
    titleZh: '打开剪贴板到编辑器',
    defaultOutput: 'open-editor',
  },
]

const SECRET_ACTIONS: RecommendedAction[] = [
  // Secret content: suppressed network actions, only local open
  {
    id: 'open-clipboard-editor',
    title: 'Open Clipboard in Editor',
    titleZh: '打开剪贴板到编辑器',
    defaultOutput: 'open-editor',
  },
]

const FALLBACK_ACTIONS: RecommendedAction[] = [
  {
    id: 'open-clipboard-editor',
    title: 'Open Clipboard in Editor',
    titleZh: '打开剪贴板到编辑器',
    defaultOutput: 'open-editor',
  },
  {
    id: 'open-clipboard-history',
    title: 'Open Clipboard History',
    titleZh: '打开剪贴板历史',
    pluginId: 'clipboard-history',
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
    defaultOutput: 'copy',
  },
  {
    id: 'selection-to-yaml',
    title: 'Convert Selection to YAML',
    titleZh: '转换当前选区为 YAML',
    pluginId: 'json-tools',
    defaultOutput: 'copy',
  },
  {
    id: 'minify-selection',
    title: 'Minify Selection',
    titleZh: '压缩当前选区',
    pluginId: 'json-tools',
    defaultOutput: 'copy',
  },
]

const EDITOR_TEXT_ACTIONS: RecommendedAction[] = [
  {
    id: 'translate-selection',
    title: 'Translate Selection',
    titleZh: '翻译当前选区',
    pluginId: 'translator',
    defaultOutput: 'copy',
  },
  {
    id: 'format-selection',
    title: 'Format Selection',
    titleZh: '格式化当前选区',
    defaultOutput: 'copy',
  },
]

// ─── Recommendation logic ──────────────────────────────────────────────────────

const CLIPBOARD_ACTIONS_BY_KIND: Record<ObjectBlockKind, RecommendedAction[]> = {
  json: JSON_ACTIONS,
  url: URL_ACTIONS,
  text: TEXT_ACTIONS,
  command: COMMAND_ACTIONS,
  secret: SECRET_ACTIONS,
  unknown: FALLBACK_ACTIONS,
  markdown: TEXT_ACTIONS,
  'plain-text': TEXT_ACTIONS,
}

const EDITOR_ACTIONS_BY_KIND: Partial<Record<ObjectBlockKind, RecommendedAction[]>> = {
  json: EDITOR_JSON_ACTIONS,
  text: EDITOR_TEXT_ACTIONS,
  markdown: EDITOR_TEXT_ACTIONS,
  'plain-text': EDITOR_TEXT_ACTIONS,
}

export function recommendActionsForBlock(block: LauncherObjectBlock): RecommendedAction[] {
  if (block.source === 'clipboard') {
    return CLIPBOARD_ACTIONS_BY_KIND[block.kind] ?? FALLBACK_ACTIONS
  }
  if (block.source === 'editor-selection' || block.source === 'editor-document') {
    return EDITOR_ACTIONS_BY_KIND[block.kind] ?? EDITOR_TEXT_ACTIONS
  }
  return FALLBACK_ACTIONS
}

export function getSearchOnlyActions(): RecommendedAction[] {
  return [
    {
      id: 'open-editor',
      title: 'Open Editor',
      titleZh: '打开编辑器',
      defaultOutput: 'open-editor',
    },
    {
      id: 'open-clipboard-history',
      title: 'Open Clipboard History',
      titleZh: '打开剪贴板历史',
      pluginId: 'clipboard-history',
      defaultOutput: 'open-plugin-surface',
    },
  ]
}


// ─── Merged recommendation (static + plugin manifest) ─────────────────────────

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
      defaultOutput: d.defaultOutput,
      alternativeOutputs: d.outputTargets.filter((t) => t !== d.defaultOutput),
    }))

  return [...staticActions, ...pluginActions]
}
