/**
 * Tool → LauncherItem Adapter
 *
 * Host adapter that turns a `PluginToolContribution` into a system `LauncherItem`.
 * Tools are the preferred authoring API; the launcher and panel keep separate
 * host models internally, and this adapter generates the launcher side.
 *
 * Input resolution: the tool declares an `inputPolicy` (auto/all/selection). The
 * adapter resolves `ResolvedTextInput` from the controlled `PluginLauncherApi`
 * (selection vs active text). On the global-launcher surface, when that comes
 * back empty and the tool declares an inputPolicy, there is one on-demand
 * fallback: capture whatever is selected in the app that was foreground before
 * the launcher opened, before falling back to the manual collect-input prompt
 * (see LauncherController.selectItem/submitParams in controller.ts, the
 * primary trigger point; resolveTextInputWithForegroundFallback below is only
 * a backstop for callers that reach execute() outside that flow). A "nothing
 * selected" outcome is silent (no toast) since this fires on every eligible
 * invocation with no local selection, including plain manual-typing use.
 */

import type {
  IconRef,
  LauncherExecuteHandler,
  LauncherExecuteResult,
  LauncherExecuteWithParamsHandler,
  LauncherItem,
  LauncherItemDisplay,
  PluginLauncherApi,
  PluginToolContribution,
  PluginToolOutput,
  ResolvedTextInput,
  TextInputMode,
} from './types'
import { DEFAULT_TOOL_ACTION_POLICY } from './types'
import { normalizeLauncherSurfaceId } from './types'
import { emptyResult, textResult, explicitTextPreviewResult, foregroundPasteResult, replaceActiveTextResult, errorResult, choicesResult, REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID } from './output'
import { toDirectAnswer } from './normalizeContribution'
import { computeContractFingerprint } from './contractFingerprint'
import { assertLearnableToolSaveableContract } from './toolContract'
import { captureForegroundSelectionText } from './foregroundSelectionCapture'
import { translate, type Locale } from '../../i18n'
import { getPluginPermissionSnapshot } from '../pluginPermissions'
import { createPluginShell } from '../pluginShell'
import { pluginRegistry } from '../pluginRegistry'
import type { PluginDefinition } from '../pluginTypes'
import { resolveBundledTextPreviewRunner } from '../bundledPluginIdentity'

export type ToolAdaptOptions = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  systemKey: string
  /** Exact final definition being collected, never inferred from its source label. */
  definition?: PluginDefinition
}

function resolveTextInput(api: PluginLauncherApi, mode: TextInputMode): ResolvedTextInput {
  const selection = api.getSelectionText()
  if (mode === 'selection') {
    return selection
      ? { kind: 'text', text: selection, mode, source: 'selection' }
      : { kind: 'text', text: '', mode, source: 'empty' }
  }
  if (mode === 'all') {
    const all = api.getActiveText()
    return { kind: 'text', text: all, mode, source: all ? 'all' : 'empty' }
  }
  // auto: selection if present, else whole active text
  if (selection) return { kind: 'text', text: selection, mode, source: 'selection' }
  const all = api.getActiveText()
  return { kind: 'text', text: all, mode, source: all ? 'all' : 'empty' }
}

function manualTextInput(
  text: string,
  mode: TextInputMode,
  source?: 'foreground-app',
): ResolvedTextInput {
  return { kind: 'text', text, mode, source: !text ? 'empty' : (source ?? 'manual') }
}

/**
 * Last-resort input source for a Global Launcher tool run: Global Launcher has
 * no bound pane, so when there's no local selection/active text, fall back to
 * an on-demand capture of whatever is selected in the app that was foreground
 * before the launcher took focus. Only fires for tools that actually declare
 * an inputPolicy (i.e. genuinely consume text — generators like random don't),
 * and only for auto/selection modes ('all' means "whole document", which a
 * foreign app's selection can't stand in for). Never fires on launcher open —
 * only when a matching tool actually executes with nothing else available,
 * per the clipboard-first "explicit intent" direction (no ambient capture).
 *
 * Command entry collects input without capture. This fallback only applies to
 * direct executions that bypass that input step and have no explicit text.
 */
async function resolveTextInputWithForegroundFallback(
  api: PluginLauncherApi,
  locale: Locale,
  mode: TextInputMode,
  allowForegroundFallback: boolean,
): Promise<ResolvedTextInput> {
  const local = resolveTextInput(api, mode)
  if (local.source !== 'empty' || !allowForegroundFallback) return local
  const captured = await captureForegroundSelectionText(api, locale)
  return captured ? { kind: 'text', text: captured, mode, source: 'foreground-app' } : local
}

function makeOutput(
  api: PluginLauncherApi,
  locale: Locale,
  surfaceId: string | undefined,
  preferForegroundPaste: boolean,
): PluginToolOutput {
  const normalizedSurfaceId = normalizeLauncherSurfaceId((surfaceId ?? "global-launcher") as import("./types").LauncherSurfaceId)
  const isGlobal = normalizedSurfaceId === 'global-launcher'
  const globalResult = (value: string) => preferForegroundPaste
    ? foregroundPasteResult(value, api, locale)
    : textResult(value, api, locale)
  return {
    text: (value: string) => isGlobal
      ? globalResult(value)
      : replaceActiveTextResult(value, api, locale),
    replaceActiveText: (value: string) => isGlobal
      ? globalResult(value)
      : replaceActiveTextResult(value, api, locale),
    error: (message: string) => errorResult(message),
    choices: (choices) => choicesResult(choices),
  }
}

function toolDisplay(tool: PluginToolContribution): LauncherItemDisplay {
  return {
    title: tool.title,
    titleI18n: tool.titleI18n,
    subtitle: tool.subtitle,
    subtitleI18n: tool.subtitleI18n,
    icon: tool.icon as IconRef | undefined,
    aliases: tool.aliases,
  }
}

export function adaptToolToLauncherItem(
  tool: PluginToolContribution,
  options: ToolAdaptOptions,
): LauncherItem {
  assertLearnableToolSaveableContract(tool)
  const launcherOpt = tool.surfaces?.launcher
  const launcherOptions = typeof launcherOpt === 'object' ? launcherOpt : undefined
  const mode: TextInputMode = tool.inputPolicy?.mode ?? 'auto'
  const hasPreviewDeclaration = tool.explicitTextPreview !== undefined
  const previewRunner = resolveBundledTextPreviewRunner(options.pluginId, options.source, options.definition, tool)
  const executionMode = previewRunner ? 'explicit-text-preview' as const : undefined
  const contractFingerprint = computeContractFingerprint({
    systemKey: options.systemKey,
    inputPolicy: tool.inputPolicy,
    executionMode,
    params: tool.params,
  })
  // Runtime edit/cancel must also reject saveability and validation changes,
  // which intentionally do not alter the persisted behavior fingerprint.
  const currentPreviewContract = () => JSON.stringify({
    policy: tool.policy,
    defaults: tool.defaultParams,
    params: tool.params?.map(({ key, type, required, default: value, options, minSelect, maxSelect, saveable, saveableMaxLength }) => ({
      key, type, required, default: value,
      options: options?.map((option) => typeof option === 'string' ? option : option.value),
      minSelect, maxSelect, saveable, saveableMaxLength,
    })),
  })
  const previewContract = currentPreviewContract()
  const isExplicitTextPreviewAvailable = () => Boolean(previewRunner &&
    resolveBundledTextPreviewRunner(options.pluginId, options.source, options.definition, tool) === previewRunner &&
    computeContractFingerprint({ systemKey: options.systemKey, inputPolicy: tool.inputPolicy, executionMode, params: tool.params }) === contractFingerprint &&
    currentPreviewContract() === previewContract)
  const defaultParams = { ...(tool.defaultParams ?? {}) }
  for (const param of tool.params ?? []) {
    if (defaultParams[param.key] === undefined && param.default !== undefined) {
      defaultParams[param.key] = param.default
    }
  }

  const runWithParams = async (
    ctx: Parameters<LauncherExecuteHandler>[0],
    params: Record<string, unknown>,
  ): Promise<LauncherExecuteResult> => {
    const normalizedSurfaceId = normalizeLauncherSurfaceId(ctx.surfaceId)
    const isEditorLike = normalizedSurfaceId === 'editor-command-bar' || normalizedSurfaceId === 'quick-editor-command'
    const isGlobalLauncher = normalizedSurfaceId === 'global-launcher'
    if (isGlobalLauncher && hasPreviewDeclaration) {
      // No fallback to the full tool context: a replaced/unregistered bundle
      // invalidates already collected items as well as future discovery.
      if (!previewRunner || !isExplicitTextPreviewAvailable()) {
        return errorResult(translate(ctx.locale, 'palette', 'savedActionMissing'))
      }
      const text = ctx.input?.text
      if (typeof text !== 'string' || text.length === 0) {
        return errorResult(translate(ctx.locale, 'palette', 'inputRequired'))
      }
      const result = await previewRunner({ input: { text }, params, locale: ctx.locale, t: ctx.t })
      // A registration change while an async pure runner was pending also
      // invalidates its output before any delivery actions can be produced.
      if (!isExplicitTextPreviewAvailable()) {
        return errorResult(translate(ctx.locale, 'palette', 'savedActionMissing'))
      }
      return result.ok
        ? explicitTextPreviewResult(result.text, ctx.api, ctx.locale)
        : errorResult(result.message)
    }
    const hasManualInput = ctx.input?.text !== undefined
    const allowForegroundFallback = isGlobalLauncher && tool.inputPolicy !== undefined && mode !== 'all'
    const input = hasManualInput
      ? manualTextInput(ctx.input?.text ?? '', mode, ctx.input?.source)
      : await resolveTextInputWithForegroundFallback(ctx.api, ctx.locale, mode, allowForegroundFallback)
    const requestedPermissions = pluginRegistry.getPluginPermissions(options.pluginId, options.source)
    const permissions = getPluginPermissionSnapshot(options.source, options.pluginId, requestedPermissions)
    const shell = createPluginShell(permissions)
    const result = await Promise.resolve(
      tool.run({
        input,
        params,
        settings: ctx.settings,
        locale: ctx.locale,
        api: ctx.api,
        storage: ctx.storage,
        ai: ctx.ai,
        shell,
        t: ctx.t,
        output: makeOutput(ctx.api, ctx.locale, ctx.surfaceId ?? '', input.source === 'foreground-app'),
      }),
    )
    if (
      isEditorLike &&
      result.ok &&
      result.output?.choices.length === 1 &&
      result.output.choices[0]?.id === REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID
    ) {
      await result.output.choices[0].primaryAction()
      return emptyResult()
    }
    return result
  }
  const execute: LauncherExecuteHandler = (ctx) => runWithParams(ctx, defaultParams)
  const executeWithParams: LauncherExecuteWithParamsHandler = (ctx, params) => runWithParams(ctx, {
    ...defaultParams,
    ...params,
  })

  return {
    systemKey: options.systemKey,
    kind: 'plugin',
    pluginLifetime: pluginRegistry.getPluginLifetime(options.pluginId, options.source),
    pluginId: options.pluginId,
    source: options.source,
    display: toolDisplay(tool),
    behavior: { type: 'perform' },
    surfaces: previewRunner && launcherOptions?.surfaces?.length
      ? [...new Set([...launcherOptions.surfaces, 'global-launcher' as const])]
      : launcherOptions?.surfaces,
    inputPolicy: tool.inputPolicy,
    executionMode,
    isExplicitTextPreviewAvailable: previewRunner ? isExplicitTextPreviewAvailable : undefined,
    actionPolicy: tool.policy ?? DEFAULT_TOOL_ACTION_POLICY,
    contractFingerprint,
    params: tool.params,
    defaultParams,
    requireParamSelection: tool.requireParamSelection,
    textMatch: tool.textMatch,
    // Intent: declarative accepts + optional runtime match (same as textMatch — runtime-only)
    accepts: tool.accepts,
    match: tool.match,
    directAnswer: toDirectAnswer(tool.directAnswer),
    execute,
    executeWithParams: tool.params && tool.params.length > 0 ? executeWithParams : undefined,
  }
}
