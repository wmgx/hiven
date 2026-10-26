/**
 * Clipboard Object Block — Public API barrel.
 */
export {
  type ClipboardDetectedType,
  type ClipboardSnapshot,
  CLIPBOARD_AGE_TRACKER_INTERVAL_MS,
  hashClipboardText,
  detectClipboardType,
  getLastClipboardSnapshot,
  updateClipboardSnapshot,
  observeClipboardText,
  clearClipboardSnapshot,
  isSoftClipboardOperand,
  startClipboardAgeTracker,
  stopClipboardAgeTracker,
} from './clipboardSnapshot'



export {
  type ObjectBlockSource,
  type ObjectBlockKind,
  type LauncherObjectBlock,
  type RecentClipboardHint,
  getKindLabel,
  getSourceLabel,
  createClipboardObjectBlock,
  createEditorSelectionObjectBlock,
  createEditorDocumentObjectBlock,
  createHistoryItemObjectBlock,
  buildRecentClipboardHint,
  type CreateHistoryItemObjectBlockParams,
  type ObjectBlockImagePayload,
  type ObjectBlockFilesPayload,
} from './objectBlock'

export {
  setPendingObjectBlock,
  consumePendingObjectBlock,
  clearPendingObjectBlock,
  peekPendingObjectBlock,
} from './pendingObjectBlock'

export {
  type RecommendedOutputTarget,
  type RecommendedAction,
  recommendActionsForBlock,
} from './actionRecommendation'

export {
  recommendActionsFromToolAccepts,
  type AcceptsToolDescriptor,
  type RecommendFromToolAcceptsParams,
} from './acceptsRecommendation'

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
  getActionOutputTargets,
} from './actionExecutor'

// pluginActionManifest removed in B2 — transform actions use accepts/textMatch ranking.
// See actionRecommendation.ts (host pins only) and workspace/launcher/normalizeContribution.ts.
