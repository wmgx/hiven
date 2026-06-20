export { definePlugin } from './workspace/definePlugin'
export { detectExternalEditorLanguage } from './workspace/languageDetector'
export { getPluginHostSdk, createPluginHostSdk } from './pluginHostSdk'
export { useT } from './i18n'
export {
  scoreSearchableFields,
  searchableFieldsMatch,
} from './workspace/searchRanking'
export type {
  SearchableFields,
} from './workspace/searchRanking'
export {
  textOutput,
  textError,
  defineTextCommand,
} from './pluginHostCore'
export type {
  PluginHostSdk,
  PluginHostUi,
  PluginHostKits,
  PluginHostHooks,
  PluginHostI18n,
  TextCommandDefinition,
} from './pluginHostSdk'
export type { Locale } from './i18n'
export type { TranslateFunction } from './i18n'
export type { PluginT } from './i18n/pluginI18nRegistry'
export type { JsonArrayCompareMode } from './kits/diff/jsonSemanticDiff'
export type {
  CommandContribution,
  CommandParam,
  InputSlot,
  PaneInput,
  PanelContributionV2,
  PanelHostApi,
  PanelPropsV2,
  PluginCommandContext,
  PluginCommandErrorOutput,
  PluginCommandOutput,
  PluginCommandResult,
  PluginCommandTextOutput,
  PluginDefinition,
  PluginHooksContribution,
  PluginStartupHookContext,
  PluginSettingsBodyProps,
  PluginSettingsContribution,
  PluginSettingsField,
  PluginSettingsHostApi,
  PluginSettingsModalBodyProps,
  PluginSettingsModalContribution,
  PluginSettingsModalField,
  PluginSettingsSchema,
  PluginSettingsSection,
  RendererContribution,
  RendererHostApi,
  RendererProps,
  ResolvedInputs,
  TextCommandSurfaces,
  TextInput,
  // Plugin UI Surface types
  PluginUiSurfaceKind,
  PluginUiSurfaceContribution,
  PluginUiContribution,
  PluginSurfaceProps,
  PluginSurfaceHostApi,
  // Plugin Background types
  PluginBackgroundContribution,
  PluginBackgroundContext,
  PluginBackgroundStop,
  // Plugin Permission types
  PluginPermission,
  PluginPermissionGrant,
  PluginPermissionSnapshot,
  // Plugin Storage types
  PluginPrivateStorageApi,
  PluginBlobRef,
  PluginStoragePrunePolicy,
  // Plugin Clipboard types
  PluginClipboardApi,
  ClipboardChange,
  ClipboardWatchOptions,
  // Plugin Paste types
  PluginPasteApi,
  PluginPasteResult,
} from './workspace/pluginTypes'
export type {
  LauncherSurfaceId,
  LauncherItemDisplay,
  LauncherBehavior,
  LauncherInputSpec,
  LauncherItemContribution,
  LauncherDynamicContext,
  LauncherDynamicItemProvider,
  LauncherExecutionContext,
  LauncherExecuteHandler,
  LauncherExecuteResult,
  LauncherOutput,
  LauncherResultChoice,
  LauncherResultAction,
  LauncherResultActionHandler,
  DiscoveredApp,
  PluginAppsApi,
  PluginLauncherApi,
  PluginToolContribution,
  PluginToolContext,
  PluginToolResult,
  PluginToolSurfaces,
  PluginToolOutput,
  PanelActionContribution,
  PanelActionContext,
  PanelActionResult,
  PanelActionApi,
  TextInputMode,
  TextInputPolicy,
  ResolvedTextInput,
  TextRange,
  IconRef,
} from './workspace/launcher/types'
export type {
  FluxEffect,
  AppEffect,
  PaneEffect,
  PaneId,
  PanelScope,
  StatusEffect,
  TextReplaceEffect,
} from './workspace/types'
