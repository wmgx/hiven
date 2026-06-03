import type { CommandContribution, PluginCommandResult, ResolvedInputs } from './pluginTypes'
import type { FluxEffect } from './types'

export type TextPluginCommandRunOptions = {
  inputText: string
  params?: Record<string, unknown>
  isDev?: boolean
  ownerPluginId?: string
}

export type TextPluginCommandOutput = {
  text: string
  kind: 'text' | 'error'
}

export function buildTextPluginInputs(slots: CommandContribution['inputs'], inputText: string): ResolvedInputs {
  const inputs: ResolvedInputs = {}
  if (!slots || slots.length === 0) {
    inputs.input = { kind: 'text', text: inputText }
    return inputs
  }
  for (const slot of slots) {
    inputs[slot.key] = { kind: 'text', text: inputText }
  }
  return inputs
}

export function defaultPluginCommandParams(params: CommandContribution['params']): Record<string, unknown> {
  const defaults: Record<string, unknown> = {}
  for (const param of params ?? []) {
    if (param.default !== undefined) defaults[param.key] = param.default
  }
  return defaults
}

export async function runTextPluginCommand(
  command: CommandContribution,
  options: TextPluginCommandRunOptions,
): Promise<TextPluginCommandOutput> {
  const result = await Promise.resolve(command.run({
    inputs: buildTextPluginInputs(command.inputs, options.inputText),
    params: {
      ...defaultPluginCommandParams(command.params),
      ...(options.params ?? {}),
    },
  }))
  return textOutputFromPluginEffects({
    effects: stampPluginCommandEffects(result.effects ?? [], {
      isDev: options.isDev,
      ownerPluginId: options.ownerPluginId,
    }),
  })
}

export function stampPluginCommandEffects(
  effects: FluxEffect[],
  options: { isDev?: boolean; ownerPluginId?: string } = {},
): FluxEffect[] {
  return effects.map((effect) => {
    if (effect.type === 'pane.setRenderer' || effect.type === 'panel.openV2') {
      return {
        ...effect,
        ownerPluginId: effect.ownerPluginId ?? options.ownerPluginId,
        _isDev: effect._isDev ?? (options.isDev ? true : undefined),
      }
    }
    return effect
  })
}

export function textOutputFromPluginEffects(result: PluginCommandResult): TextPluginCommandOutput {
  const effects = result.effects ?? []
  const textReplace = effects.find((effect): effect is Extract<FluxEffect, { type: 'text.replace' }> => effect.type === 'text.replace')
  if (textReplace) return { text: textReplace.text, kind: 'text' }
  const createPane = effects.find((effect): effect is Extract<FluxEffect, { type: 'pane.create' }> => effect.type === 'pane.create')
  if (createPane) return { text: String(createPane.pane.text ?? ''), kind: 'text' }
  const status = effects.find((effect): effect is Extract<FluxEffect, { type: 'status.message' }> => effect.type === 'status.message')
  if (status) return { text: status.message, kind: status.level === 'error' ? 'error' : 'text' }
  return { text: '', kind: 'text' }
}
