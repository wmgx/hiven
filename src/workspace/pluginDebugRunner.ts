import type { PluginDefinition } from './pluginTypes'
import { buildTextPluginInputs, defaultPluginCommandParams, textOutputFromPluginEffects } from './pluginCommandRunner.ts'

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
    inputs: buildTextPluginInputs(command.inputs, options.inputText),
    params: {
      ...defaultPluginCommandParams(command.params),
      ...(options.params ?? {}),
    },
  }))
  const effects = result?.effects ?? []
  const elapsed = Math.round(now() - started)

  return {
    output: textOutputFromPluginEffects({ effects }).text,
    logs: [...logs, `effects: ${effects.length}`, `done in ${elapsed}ms`],
  }
}
