/**
 * CommandContribution -> LauncherItem Adapter
 *
 * Compatibility bridge for existing first-party text commands while plugins
 * migrate to tools / launcher.items. The UI still consumes only LauncherItem;
 * command discovery and execution stay centralized in the launcher domain.
 */

import type { CommandContribution } from '../pluginTypes'
import { defaultPluginCommandParams, runTextPluginCommand } from '../pluginCommandRunner'
import type {
  IconRef,
  LauncherExecuteHandler,
  LauncherExecuteResult,
  LauncherExecuteWithParamsHandler,
  LauncherItem,
  LauncherItemDisplay,
  PluginLauncherApi,
} from './types'
import { errorResult, replaceActiveTextResult } from './output'

export type CommandAdaptOptions = {
  pluginId: string
  source: 'builtin' | 'installed' | 'dev'
  systemKey: string
}

function commandDisplay(command: CommandContribution): LauncherItemDisplay {
  return {
    title: command.title,
    titleI18n: command.titleI18n,
    subtitle: command.description,
    subtitleI18n: command.descriptionI18n,
    icon: command.icon as IconRef | undefined,
    aliases: command.aliases,
  }
}

function resolveAutoTextInput(api: PluginLauncherApi): string {
  const selection = api.getSelectionText()
  return selection || api.getActiveText()
}

function hasOnlyTextInputs(command: CommandContribution): boolean {
  return (command.inputs ?? []).every((slot) => slot.kind === 'text')
}

function hasDefaultParams(command: CommandContribution): boolean {
  return (command.params ?? []).every((param) => param.default !== undefined)
}

export function canAdaptCommandToLauncher(command: CommandContribution): boolean {
  if (command.surfaces?.quickText === false) return false
  if (command.live?.pinnable === false) return false
  if (!hasOnlyTextInputs(command)) return false
  if (!hasDefaultParams(command)) return false
  return true
}

export function adaptCommandToLauncherItem(
  command: CommandContribution,
  options: CommandAdaptOptions,
): LauncherItem {
  const runWithParams = async (
    ctx: Parameters<LauncherExecuteHandler>[0],
    params: Record<string, unknown>,
  ): Promise<LauncherExecuteResult> => {
    const output = await runTextPluginCommand(command, {
      inputText: resolveAutoTextInput(ctx.api),
      params,
      isDev: options.source === 'dev',
      ownerPluginId: options.pluginId,
    })

    if (output.kind === 'error') return errorResult(output.text)
    return replaceActiveTextResult(output.text, ctx.api)
  }
  const defaultParams = defaultPluginCommandParams(command.params)
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
    display: commandDisplay(command),
    behavior: { type: 'perform' },
    pinnable: command.live?.pinnable ?? true,
    legacyUsageKeys: [command.id],
    params: command.optionalParams ? command.params : undefined,
    defaultParams: command.optionalParams ? defaultParams : undefined,
    execute,
    executeWithParams: command.optionalParams ? executeWithParams : undefined,
  }
}
