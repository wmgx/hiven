/**
 * Clipboard Object Block — Public API barrel.
 */
export {
  type ClipboardDetectedType,
  type ClipboardSnapshot,
  FRESH_CLIPBOARD_TTL_MS,
  RECENT_CLIPBOARD_HINT_TTL_MS,
  UNKNOWN_AGE_AUTO_ATTACH,
  hashClipboardText,
  detectClipboardType,
  getLastClipboardSnapshot,
  updateClipboardSnapshot,
  createClipboardSnapshotFromUnknownAge,
  clearClipboardSnapshot,
  shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint,
  isClipboardExpired,
} from './clipboardSnapshot'

export {
  type ObjectBlockSource,
  type ObjectBlockKind,
  type LauncherObjectBlock,
  type RecentClipboardHint,
  formatAgeLabel,
  getKindLabel,
  getSourceLabel,
  createClipboardObjectBlock,
  createEditorSelectionObjectBlock,
  createEditorDocumentObjectBlock,
  buildRecentClipboardHint,
} from './objectBlock'

export {
  type RecommendedOutputTarget,
  type RecommendedAction,
  recommendActionsForBlock,
  getSearchOnlyActions,
} from './actionRecommendation'

export {
  type ClipboardObjectBlockMode,
  type ClipboardObjectBlockState,
  useClipboardObjectBlock,
} from './useClipboardObjectBlock'

export {
  type ActionExecutionContext,
  type ActionExecutionResult,
  type ActionExecutionHandlers,
  executeRecommendedAction,
  getOutputTargetLabel,
  getActionOutputTargets,
  OUTPUT_TARGET_LABELS,
} from './actionExecutor'

export {
  type EditorObjectBlockState,
  useEditorObjectBlock,
} from './useEditorObjectBlock'
