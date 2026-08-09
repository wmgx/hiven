/**
 * Host-owned Object Block pin actions.
 *
 * Transform / encode / format / JWT actions are **not** listed here.
 * They enter the launcher exclusively through the single ranking path:
 *   tools/items with accepts (+ optional match filter) + textMatch.
 *
 * This module only returns host pins that ranking cannot express cleanly:
 *   - clipboard-history paste/copy for history items (incl. image/files)
 *   - Open in Quick Editor for text-bearing blocks
 *
 * B2 (2026-08-09): removed the hard-coded product transform catalog and
 * pluginActionManifest merge. See architecture freeze B2.
 */

import type { LauncherObjectBlock } from './objectBlock'

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

// ─── Host pins only ────────────────────────────────────────────────────────────

const OPEN_QUICK_EDITOR: RecommendedAction = {
  id: 'open-in-quick-editor',
  title: 'Open in Quick Editor',
  titleZh: '打开到快捷编辑器',
  provider: 'Quick Editor',
  defaultOutput: 'open-editor',
}

/** Alias id kept for older host rows that filtered defaultOutput === 'open-editor'. */
const OPEN_CLIPBOARD_EDITOR: RecommendedAction = {
  id: 'open-clipboard-editor',
  title: 'Open in Quick Editor',
  titleZh: '打开到快捷编辑器',
  provider: 'Quick Editor',
  defaultOutput: 'open-editor',
}

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

/**
 * Host-owned pins for an Object Block.
 * Product transforms (json format, base64, …) are **not** returned — ranking owns them.
 */
export function recommendActionsForBlock(block: LauncherObjectBlock): RecommendedAction[] {
  if (block.source === 'history-item') {
    if (block.kind === 'image') return IMAGE_HISTORY_ACTIONS
    if (block.kind === 'files') return FILES_HISTORY_ACTIONS
    return TEXT_HISTORY_ACTIONS
  }

  const hasText = block.payloadText != null || block.preview != null
  const isMedia = block.kind === 'image' || block.kind === 'files'
  if (hasText && !isMedia) {
    // Prefer the open-clipboard-editor id for clipboard sources (legacy filter in host).
    if (block.source === 'clipboard') return [OPEN_CLIPBOARD_EDITOR]
    return [OPEN_QUICK_EDITOR]
  }

  return []
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

/** Max host pins returned for one object block. */
export const RECOMMENDED_ACTIONS_MAX = 5

/**
 * @deprecated Transform plugins must use accepts/textMatch ranking.
 * Kept as a thin alias of {@link recommendActionsForBlock} (host pins only).
 * The old pluginActionManifest merge path is removed.
 */
export function recommendActionsWithPlugins(block: LauncherObjectBlock): RecommendedAction[] {
  return recommendActionsForBlock(block).slice(0, RECOMMENDED_ACTIONS_MAX)
}

// Keep content-accepts recommend on the reachable import graph (host pins path).
export {
  recommendActionsFromToolAccepts,
  type AcceptsToolDescriptor,
  type RecommendFromToolAcceptsParams,
} from './acceptsRecommendation'
