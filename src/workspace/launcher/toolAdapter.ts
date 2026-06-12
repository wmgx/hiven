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
  LauncherItem,
  LauncherItemDisplay,
  PluginLauncherApi,
  PluginToolContribution,
  PluginToolOutput,
  ResolvedTextInput,
  TextInputMode,
} from './types'
import { textResult, replaceActiveTextResult, errorResult, choicesResult } from './output'

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

function makeOutput(api: PluginLauncherApi): PluginToolOutput {
  return {
    text: (value: string) => textResult(value, api),
    replaceActiveText: (value: string) => replaceActiveTextResult(value, api),
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

  const execute: LauncherExecuteHandler = async (ctx): Promise<LauncherExecuteResult> => {
    const input = resolveTextInput(ctx.api, mode)
    const result = await Promise.resolve(
      tool.run({
        input,
        settings: ctx.settings,
        locale: ctx.locale,
        api: ctx.api,
        t: ctx.t,
        output: makeOutput(ctx.api),
      }),
    )
    return result
  }

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
    execute,
  }
}
