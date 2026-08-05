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
  getSearchOnlyActions,
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
  getOutputTargetLabel,
  getActionOutputTargets,
  OUTPUT_TARGET_LABELS,
} from './actionExecutor'

export {
  type EditorObjectBlockState,
  useEditorObjectBlock,
} from './useEditorObjectBlock'

export {
  type PluginActionAccepts,
  type PluginActionPresentation,
  type PluginActionManifestEntry,
  type PluginActionManifest,
  type DiscoveredPluginAction,
  registerPluginActionManifest,
  unregisterPluginActionManifest,
  getPluginActionManifest,
  getAllPluginActionManifests,
  clearPluginActionManifests,
  discoverActionsForBlock,
} from './pluginActionManifest'

export { recommendActionsWithPlugins } from './actionRecommendation'
