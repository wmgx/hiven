import type { PluginDefinition } from './pluginTypes'
import { createPluginHostCoreSdk, type PluginHostCoreSdk } from '../pluginHostCore.ts'

declare global {
  var HivenPlugin: PluginHostCoreSdk | undefined
  var FluxTextPlugin: PluginHostCoreSdk | undefined
}

export function parsePluginDefinitionSource(source: string): PluginDefinition | null {
  const previousHivenSdk = globalThis.HivenPlugin
  const previousFluxTextSdk = globalThis.FluxTextPlugin
  const sdk = createPluginHostCoreSdk()
  globalThis.HivenPlugin = sdk
  globalThis.FluxTextPlugin = sdk
  try {
    const definePlugin = (definition: PluginDefinition) => definition
    const { effects, ui } = globalThis.HivenPlugin
    const code = source
      .replace(/^\s*import\s+.*?['"].*?['"]\s*;?\s*$/gm, '')
      .replace(/^\s*const\s+\{[^}]*\}\s*=\s*globalThis\.HivenPlugin\s*;?\s*$/gm, '')
      .replace(/^\s*const\s+\{[^}]*\}\s*=\s*globalThis\.FluxTextPlugin\s*;?\s*$/gm, '')
      .replace(/export\s+default\s+definePlugin\s*\(/, 'return definePlugin(')
      .replace(/export\s+default\s+/, 'return ')
    const value = new Function('definePlugin', 'effects', 'ui', code)(definePlugin, effects, ui)
    if (!value || typeof value !== 'object') return null
    const v = value as Record<string, unknown>
    if (!Array.isArray(v.commands) && !Array.isArray(v.renderers) && !Array.isArray(v.panels)) return null
    return value as PluginDefinition
  } catch {
    return null
  } finally {
    if (previousHivenSdk === undefined) {
      delete globalThis.HivenPlugin
    } else {
      globalThis.HivenPlugin = previousHivenSdk
    }
    if (previousFluxTextSdk === undefined) {
      delete globalThis.FluxTextPlugin
    } else {
      globalThis.FluxTextPlugin = previousFluxTextSdk
    }
  }
}
