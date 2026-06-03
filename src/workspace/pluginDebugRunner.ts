import type { PluginDefinition } from './pluginTypes'
import { buildTextPluginInputs, defaultPluginCommandParams, textOutputFromPluginEffects } from './pluginCommandRunner.ts'
import { createPluginHostCoreSdk, type PluginHostCoreSdk } from '../pluginHostCore.ts'

declare global {
  var FluxTextPlugin: PluginHostCoreSdk | undefined
}

export type PluginDebugRunOptions = {
  inputText: string
  params?: Record<string, unknown>
  now?: () => number
}

export type PluginDebugRunResult = {
  output: string
  logs: string[]
}

export function parsePluginDefinitionSource(source: string): PluginDefinition | null {
  const previousSdk = globalThis.FluxTextPlugin
  globalThis.FluxTextPlugin = createPluginHostCoreSdk()
  try {
    const definePlugin = (definition: PluginDefinition) => definition
    const { effects, ui } = globalThis.FluxTextPlugin
    const code = source
      .replace(/^\s*import\s+.*?['"].*?['"]\s*;?\s*$/gm, '')
      .replace(/^\s*const\s+\{[^}]*\}\s*=\s*globalThis\.FluxTextPlugin\s*;?\s*$/gm, '')
      .replace(/export\s+default\s+definePlugin\s*\(/, 'return definePlugin(')
      .replace(/export\s+default\s+/, 'return ')
    const value = new Function('definePlugin', 'effects', 'ui', code)(definePlugin, effects, ui)
    if (!value || typeof value !== 'object' || typeof value.id !== 'string') return null
    return value as PluginDefinition
  } catch {
    return null
  } finally {
    if (previousSdk === undefined) {
      delete globalThis.FluxTextPlugin
    } else {
      globalThis.FluxTextPlugin = previousSdk
    }
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
