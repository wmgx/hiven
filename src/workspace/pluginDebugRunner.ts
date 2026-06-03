import type { PluginDefinition, PluginCommandResult } from './pluginTypes'
import type { FluxEffect } from './types'

export type PluginDebugRunOptions = {
  inputText: string
  params?: Record<string, unknown>
  now?: () => number
}

export type PluginDebugRunResult = {
  output: string
  logs: string[]
}

const debugEffects = {
  replaceActiveText: (text: string) => ({ type: 'text.replace' as const, target: 'active-input' as const, text }),
  createPane: (text: string, title?: string) => ({ type: 'pane.create' as const, pane: { text, title }, focus: true }),
  status: (message: string, level: 'info' | 'success' | 'warning' | 'error' = 'info') => ({ type: 'status.message' as const, level, message }),
}

export function parsePluginDefinitionSource(source: string): PluginDefinition | null {
  try {
    const definePlugin = (definition: PluginDefinition) => definition
    const code = source
      .replace(/^\s*import\s+.*?['"].*?['"]\s*;?\s*$/gm, '')
      .replace(/const\s+\{\s*definePlugin\s*,\s*effects\s*\}\s*=\s*globalThis\.FluxTextPlugin\s*;?/, '')
      .replace(/export\s+default\s+definePlugin\s*\(/, 'return definePlugin(')
      .replace(/export\s+default\s+/, 'return ')
    const value = new Function('definePlugin', 'effects', code)(definePlugin, debugEffects)
    if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null
    return value as PluginDefinition
  } catch {
    return null
  }
}

export async function runPluginDebugSource(
  source: string,
  options: PluginDebugRunOptions,
): Promise<PluginDebugRunResult> {
  const now = options.now ?? (() => performance.now())
  const plugin = parsePluginDefinitionSource(source)
  const command = plugin?.commands?.[0]
  const commandId = command?.id ?? plugin?.id ?? 'plugin'
  const logs = [`> run ${commandId}`]
  const started = now()

  if (!command) {
    return {
      output: '',
      logs: [...logs, 'Current file is not a runnable plugin command.'],
    }
  }

  const result = await Promise.resolve(command.run({
    inputs: buildDebugInputs(command.inputs, options.inputText),
    params: {
      ...defaultDebugParams(command.params),
      ...(options.params ?? {}),
    },
  }))
  const effects = result?.effects ?? []
  const elapsed = Math.round(now() - started)

  return {
    output: outputFromPluginEffects({ effects }),
    logs: [...logs, `effects: ${effects.length}`, `done in ${elapsed}ms`],
  }
}

function buildDebugInputs(inputs: PluginDefinition['commands'][number]['inputs'], inputText: string) {
  const slots = inputs && inputs.length > 0 ? inputs : [{ key: 'input' }]
  return Object.fromEntries(slots.map((slot) => [slot.key, { kind: 'text' as const, text: inputText }]))
}

function defaultDebugParams(params: PluginDefinition['commands'][number]['params']) {
  const defaults: Record<string, unknown> = {}
  for (const param of params ?? []) {
    if (param.default !== undefined) defaults[param.key] = param.default
  }
  return defaults
}

function outputFromPluginEffects(result: PluginCommandResult): string {
  const effects = result.effects ?? []
  const textReplace = effects.find((effect): effect is Extract<FluxEffect, { type: 'text.replace' }> => effect.type === 'text.replace')
  if (textReplace) return textReplace.text
  const createPane = effects.find((effect): effect is Extract<FluxEffect, { type: 'pane.create' }> => effect.type === 'pane.create')
  if (createPane) return String(createPane.pane.text ?? '')
  const status = effects.find((effect): effect is Extract<FluxEffect, { type: 'status.message' }> => effect.type === 'status.message')
  if (status) return status.message
  return ''
}
