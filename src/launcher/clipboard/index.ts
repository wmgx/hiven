/**
 * Clipboard Object Block — Public API barrel.
 */
export {
  type ClipboardDetectedType,
  type ClipboardSnapshot,
  FRESH_CLIPBOARD_TTL_MS,
  RECENT_CLIPBOARD_HINT_TTL_MS,
  UNKNOWN_AGE_AUTO_ATTACH,
  CLIPBOARD_AGE_TRACKER_INTERVAL_MS,
  hashClipboardText,
  detectClipboardType,
  getLastClipboardSnapshot,
  updateClipboardSnapshot,
  createClipboardSnapshotFromUnknownAge,
  observeClipboardText,
  clearClipboardSnapshot,
  shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint,
  isSoftClipboardOperand,
  isClipboardExpired,
  startClipboardAgeTracker,
  stopClipboardAgeTracker,
} from './clipboardSnapshot'

export {
  STRONG_ATTACH_MIN_CONFIDENCE,
  STRONG_QUERY_ATTACH_CONTENT_KINDS,
  findStrongClipboardAttachHits,
  isStrongClipboardAttachEligible,
  type ObjectAcceptance,
  type StrongAttachHit,
} from './attachPolicy'

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
