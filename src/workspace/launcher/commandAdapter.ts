/**
 * CommandContribution -> LauncherItem Adapter
 *
 * Compatibility bridge for existing first-party commands while plugins migrate
 * to tools / launcher.items. Text commands write through launcher text output;
 * workspace commands stay effect-only and run through controlled input
 * resolution. The UI still consumes only LauncherItem; command discovery and
 * execution stay centralized in the launcher domain.
 */

import type { CommandContribution } from '../pluginTypes'
import { applyEffects } from '../effectRunner'
import { buildPluginCommandContext, resolvePluginInputs } from '../pluginInputResolver'
import {
  defaultPluginCommandParams,
  effectsFromPluginCommandResult,
  runTextPluginCommand,
} from '../pluginCommandRunner'
import type {
  IconRef,
  LauncherExecuteHandler,
  LauncherExecuteResult,
  LauncherExecuteWithParamsHandler,
  LauncherItem,
  LauncherItemDisplay,
  PluginLauncherApi,
} from './types'
import { emptyResult, errorResult, replaceActiveTextResult } from './output'

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

function hasOnlyWorkspaceInputs(command: CommandContribution): boolean {
  return (command.inputs ?? []).every((slot) => slot.kind === 'pane' || slot.kind === 'clipboard')
}

function hasDefaultParams(command: CommandContribution): boolean {
  return (command.params ?? []).every((param) => param.default !== undefined)
}

function canAdaptTextCommandToLauncher(command: CommandContribution): boolean {
  if (command.surfaces?.quickText === false) return false
  if (command.live?.pinnable === false) return false
  if (!hasOnlyTextInputs(command)) return false
  if (!hasDefaultParams(command)) return false
  return true
}

function canAdaptWorkspaceCommandToLauncher(command: CommandContribution): boolean {
  if (command.surfaces?.quickText === false) return false
  if (!hasDefaultParams(command)) return false
  if (!hasOnlyWorkspaceInputs(command)) return false
  if (command.inputResolution?.strategy === 'always-prompt') return false

  const hasInputs = (command.inputs?.length ?? 0) > 0
  return command.live?.pinnable === false || hasInputs
}

export function canAdaptCommandToLauncher(command: CommandContribution): boolean {
  return canAdaptTextCommandToLauncher(command) || canAdaptWorkspaceCommandToLauncher(command)
}

export function adaptCommandToLauncherItem(
  command: CommandContribution,
  options: CommandAdaptOptions,
): LauncherItem {
  if (!canAdaptTextCommandToLauncher(command)) {
    return adaptWorkspaceCommandToLauncherItem(command, options)
  }

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
    if (ctx.surfaceId === 'command-palette') {
      await ctx.api.replaceActiveText(output.text)
      return emptyResult()
    }
    return replaceActiveTextResult(output.text, ctx.api)
  }
  const defaultParams = defaultPluginCommandParams(command.params)
  const exposesParams = (command.params?.length ?? 0) > 0
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
    params: exposesParams ? command.params : undefined,
    defaultParams: exposesParams ? defaultParams : undefined,
    execute,
    executeWithParams: exposesParams ? executeWithParams : undefined,
  }
}

function adaptWorkspaceCommandToLauncherItem(
  command: CommandContribution,
  options: CommandAdaptOptions,
): LauncherItem {
  const runWithParams = async (
    ctx: Parameters<LauncherExecuteHandler>[0],
    params: Record<string, unknown>,
  ): Promise<LauncherExecuteResult> => {
    const slots = command.inputs ?? []
    const resolution = command.inputResolution ?? { strategy: 'use-active' as const, fallback: 'fail' as const }
    const needsClipboard = slots.some((slot) => slot.kind === 'clipboard')
    const context = needsClipboard ? { clipboardText: await ctx.api.getClipboardText() } : undefined
    const resolved = resolvePluginInputs(slots, resolution, context)

    if (!resolved.ok) {
      if (resolved.reason === 'fail') return errorResult(resolved.message)
      if (resolved.reason === 'needs-clipboard') return errorResult('Clipboard input is unavailable')
      return errorResult('This command needs more input in the workspace')
    }

    const result = await Promise.resolve(command.run(buildPluginCommandContext(resolved.inputs, {
      ...defaultPluginCommandParams(command.params),
      ...params,
    })))
    const effects = effectsFromPluginCommandResult(result, {
      isDev: options.source === 'dev',
      ownerPluginId: options.pluginId,
    })
    if (effects.length > 0) {
      const runResult = applyEffects(effects)
      if (runResult.errors.length > 0) return errorResult(runResult.errors[0])
    }
    return emptyResult()
  }
  const defaultParams = defaultPluginCommandParams(command.params)
  const exposesParams = (command.params?.length ?? 0) > 0
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
    surfaces: ['command-palette'],
    pinnable: command.live?.pinnable ?? true,
    legacyUsageKeys: [command.id],
    params: exposesParams ? command.params : undefined,
    defaultParams: exposesParams ? defaultParams : undefined,
    execute,
    executeWithParams: exposesParams ? executeWithParams : undefined,
  }
}
