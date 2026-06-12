import type { CommandContribution } from './pluginTypes'
import { defaultPluginCommandParams, runTextPluginCommand, type TextPluginCommandOutput } from './pluginCommandRunner'

export type QuickTextCommandRunOptions = {
  inputText: string
  params?: Record<string, unknown>
  isDev?: boolean
  ownerPluginId?: string
}

type QuickTextOptions = {
  defaultParams?: Record<string, unknown>
}

function quickTextOptions(command: CommandContribution): QuickTextOptions {
  const quickText = command.surfaces?.quickText
  if (!quickText || quickText === false) return {}
  return {
    defaultParams: quickText.defaultParams,
  }
}

export function effectiveQuickTextParams(command: CommandContribution): Record<string, unknown> | null {
  const quickTextDefaults = quickTextOptions(command).defaultParams ?? {}
  const params: Record<string, unknown> = {}
  for (const param of command.params ?? []) {
    if (param.default === undefined && quickTextDefaults[param.key] === undefined) return null
    const value = quickTextDefaults[param.key] ?? param.default
    params[param.key] = value
  }
  return params
}

export function isQuickTextCommand(command: CommandContribution): boolean {
  if (command.surfaces?.quickText === false) return false
  const slots = command.inputs ?? [{ key: 'input', label: 'Input', kind: 'text' as const, required: true }]
  if (slots.length > 1) return false
  if (slots.some((slot) => slot.kind !== 'text')) return false
  if (effectiveQuickTextParams(command) === null) return false
  const live = command.live?.live
  if (live && live.sideEffects !== 'none' && live.sideEffects !== 'read-only') return false
  if (command.live?.pinnable === false && !live) return false
  return true
}

export function quickTextDefaultParams(command: CommandContribution): Record<string, unknown> {
  return effectiveQuickTextParams(command) ?? defaultPluginCommandParams(command.params)
}

export async function runQuickTextCommand(
  command: CommandContribution,
  options: QuickTextCommandRunOptions,
): Promise<TextPluginCommandOutput> {
  return runTextPluginCommand(command, {
    inputText: options.inputText,
    params: {
      ...quickTextDefaultParams(command),
      ...(options.params ?? {}),
    },
    isDev: options.isDev,
    ownerPluginId: options.ownerPluginId,
  })
}
