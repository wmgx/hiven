/**
 * Host-owned Object Block pin actions.
 *
 * Transform / encode / format / JWT actions are **not** listed here.
 * They enter the launcher exclusively through the single ranking path:
 *   tools/items with accepts (+ optional match filter) + textMatch.
 *
 * This module only returns host pins that ranking cannot express cleanly:
 *   - explicit current-text paste/copy, plus history image/file delivery
 *   - Open in Quick Editor for text-bearing blocks
 *
 * B2 (2026-08-09): removed the hard-coded product transform catalog and
 * pluginActionManifest merge. See architecture freeze B2.
 */

import type { LauncherObjectBlock } from './objectBlock'
import { getCurrentTextPayload } from './currentTextDelivery'
import { t } from '../../i18n'

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RecommendedOutputTarget =
  | 'copy'
  | 'open-editor'
  | 'open-plugin-surface'
  | 'open-plugin-tool'

export type RecommendedAction = {
  id: string
  title: string
  titleZh: string
  subtitle?: string
  icon?: string
  pluginId?: string
  /** Product-level provider label shown to users; plugin ids stay internal. */
  provider?: string
  providerZh?: string
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

/** Both locales are resolved up front; the host picks one with pickLocale. */
function labels(titleKey: string, providerKey?: string): Pick<RecommendedAction, 'title' | 'titleZh' | 'provider' | 'providerZh'> {
  return {
    title: t('en', titleKey),
    titleZh: t('zh', titleKey),
    ...(providerKey ? { provider: t('en', providerKey), providerZh: t('zh', providerKey) } : {}),
  }
}

const QUICK_EDITOR_PROVIDER = 'palette.actionProviderQuickEditor'
const CLIPBOARD_HISTORY_PROVIDER = 'palette.actionProviderClipboardHistory'

export const OPEN_QUICK_EDITOR: RecommendedAction = {
  id: 'open-in-quick-editor',
  icon: 'SquarePen',
  ...labels('palette.actionOpenInQuickEditor', QUICK_EDITOR_PROVIDER),
  defaultOutput: 'open-editor',
}

/** Alias id kept for older host rows that filtered defaultOutput === 'open-editor'. */
const OPEN_CLIPBOARD_EDITOR: RecommendedAction = {
  id: 'open-clipboard-editor',
  icon: 'SquarePen',
  ...labels('palette.actionOpenInQuickEditor', QUICK_EDITOR_PROVIDER),
  defaultOutput: 'open-editor',
}

const TEXT_HISTORY_ACTIONS: RecommendedAction[] = [
  {
    id: 'paste-history-text',
    icon: 'ClipboardPaste',
    ...labels('palette.actionPasteHistoryText', CLIPBOARD_HISTORY_PROVIDER),
    defaultOutput: 'copy',
  },
  {
    id: 'copy-history-text',
    icon: 'Copy',
    ...labels('palette.actionCopyHistoryText', CLIPBOARD_HISTORY_PROVIDER),
    defaultOutput: 'copy',
  },
  {
    id: 'open-history-in-quick-editor',
    icon: 'SquarePen',
    ...labels('palette.actionOpenInQuickEditor', QUICK_EDITOR_PROVIDER),
    defaultOutput: 'open-editor',
  },
]

const CURRENT_TEXT_ACTIONS: RecommendedAction[] = [
  {
    id: 'paste-current-text',
    icon: 'ClipboardPaste',
    ...labels('palette.pasteCurrentText'),
    defaultOutput: 'copy',
  },
  {
    id: 'copy-current-text',
    icon: 'Copy',
    ...labels('palette.copyCurrentText'),
    defaultOutput: 'copy',
  },
]

const IMAGE_HISTORY_ACTIONS: RecommendedAction[] = [
  {
    id: 'paste-history-image',
    icon: 'ClipboardPaste',
    ...labels('palette.actionPasteHistoryImage', CLIPBOARD_HISTORY_PROVIDER),
    defaultOutput: 'copy',
  },
  {
    id: 'copy-history-image',
    icon: 'Copy',
    ...labels('palette.actionCopyHistoryImage', CLIPBOARD_HISTORY_PROVIDER),
    defaultOutput: 'copy',
  },
]

const FILES_HISTORY_ACTIONS: RecommendedAction[] = [
  {
    id: 'paste-history-files',
    icon: 'ClipboardPaste',
    ...labels('palette.actionPasteHistoryFiles', CLIPBOARD_HISTORY_PROVIDER),
    defaultOutput: 'copy',
  },
  {
    id: 'copy-history-file-paths',
    icon: 'Copy',
    ...labels('palette.actionCopyHistoryFilePaths', CLIPBOARD_HISTORY_PROVIDER),
    defaultOutput: 'copy',
  },
  {
    id: 'convert-history-file-paths',
    icon: 'FileSymlink',
    ...labels('palette.actionConvertHistoryFilePaths'),
    pluginId: 'text-tools',
    defaultOutput: 'open-plugin-tool',
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
    return getCurrentTextPayload(block) !== null ? TEXT_HISTORY_ACTIONS : TEXT_HISTORY_ACTIONS.slice(2)
  }

  const hasText = block.payloadText != null || block.preview != null
  const isMedia = block.kind === 'image' || block.kind === 'files'
  if (hasText && !isMedia) {
    // Prefer the open-clipboard-editor id for clipboard sources (legacy filter in host).
    const openEditor = block.source === 'clipboard' ? OPEN_CLIPBOARD_EDITOR : OPEN_QUICK_EDITOR
    return block.source !== 'query' && getCurrentTextPayload(block) !== null ? [...CURRENT_TEXT_ACTIONS, openEditor] : [openEditor]
  }

  return []
}

// Keep content-accepts recommend on the reachable import graph (host pins path).
export {
  recommendActionsFromToolAccepts,
  type AcceptsToolDescriptor,
  type RecommendFromToolAcceptsParams,
} from './acceptsRecommendation'
