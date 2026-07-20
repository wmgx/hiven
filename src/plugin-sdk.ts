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
  MonacoDisposable,
  TextCommandDefinition,
  DesktopTargetsHostApi,
  DesktopTargetProvider,
} from './pluginHostSdk'
export type { Locale } from './i18n'
export type { TranslateFunction } from './i18n'
export type { PluginT } from './i18n/pluginI18nRegistry'
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
  PluginSettingsObjectListItemField,
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
  PluginSurfaceOpenContext,
  PluginSurfaceProps,
  PluginSurfaceHostApi,
  PluginObjectBlockInput,
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
  // Plugin Network types
  PluginNetworkApi,
  PluginNetworkRequest,
  PluginNetworkResponse,
  // Plugin Settings change hook
  PluginSettingsChangeContext,
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
  LauncherSuggestContext,
  LauncherSuggestHandler,
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
export type { DiffSource, FullscreenView } from './workspace/workspaceStore'
export type { DiffSourceBinding } from './pluginHostSdk'
