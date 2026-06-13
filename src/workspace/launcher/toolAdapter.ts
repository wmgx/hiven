/**
 * Tool → LauncherItem Adapter
 *
 * Host adapter that turns a `PluginToolContribution` into a system `LauncherItem`.
 * Tools are the preferred authoring API; the launcher and panel keep separate
 * host models internally, and this adapter generates the launcher side.
 *
 * Input resolution: the tool declares an `inputPolicy` (auto/all/selection). The
 * adapter resolves `ResolvedTextInput` from the controlled `PluginLauncherApi`
 * (selection vs active text). There is no fallback chain — empty input is passed
 * through with `source: 'empty'`.
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
import { emptyResult, textResult, replaceActiveTextResult, errorResult, choicesResult, REPLACE_ACTIVE_TEXT_OUTPUT_CHOICE_ID } from './output'
import type { Locale } from '../../i18n'

export type ToolAdaptOptions = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  systemKey: string
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

function manualTextInput(text: string, mode: TextInputMode): ResolvedTextInput {
  return { kind: 'text', text, mode, source: text ? 'manual' : 'empty' }
}

function makeOutput(api: PluginLauncherApi, locale: Locale, copyReplaceOutput = false): PluginToolOutput {
  return {
    text: (value: string) => textResult(value, api, locale),
    replaceActiveText: (value: string) => copyReplaceOutput
      ? textResult(value, api, locale)
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
  const launcherOpt = tool.surfaces?.launcher
  const launcherOptions = typeof launcherOpt === 'object' ? launcherOpt : undefined
  const pinnable = launcherOptions?.pinnable ?? tool.surfaces?.pinnable ?? true
  const mode: TextInputMode = tool.inputPolicy?.mode ?? 'auto'
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
    const hasManualInput = ctx.input?.text !== undefined
    const input = hasManualInput
      ? manualTextInput(ctx.input?.text ?? '', mode)
      : resolveTextInput(ctx.api, mode)
    const result = await Promise.resolve(
      tool.run({
        input,
        params,
        settings: ctx.settings,
        locale: ctx.locale,
        api: ctx.api,
        t: ctx.t,
        output: makeOutput(ctx.api, ctx.locale, hasManualInput && ctx.surfaceId === 'global-launcher'),
      }),
    )
    if (
      ctx.surfaceId === 'command-palette' &&
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
    pluginId: options.pluginId,
    source: options.source,
    display: toolDisplay(tool),
    behavior: { type: 'perform' },
    surfaces: launcherOptions?.surfaces,
    pinnable,
    inputPolicy: tool.inputPolicy,
    params: tool.params,
    defaultParams,
    requireParamSelection: tool.requireParamSelection,
    // Legacy usage keys: the tool id may match a command id used in old usage data
    legacyUsageKeys: [tool.id],
    execute,
    executeWithParams: tool.params && tool.params.length > 0 ? executeWithParams : undefined,
  }
}
