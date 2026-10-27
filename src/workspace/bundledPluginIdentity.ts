import type { PluginDefinition } from './pluginTypes'
import { pluginRegistry } from './pluginRegistry'

// Provenance belongs to the final localized objects loaded by the bundled
// loader. Plugin ids, store metadata, and source labels cannot recreate it.
const bundledDefinitions = new WeakMap<PluginDefinition, { pluginId: string }>()

/** Called only by the bundled loader, after localization and before registration. */
export function markBundledPluginDefinition(pluginId: string, definition: PluginDefinition): void {
  bundledDefinitions.set(definition, { pluginId })
}

/** Exact bundled provenance; an installed package cannot impersonate by ID. */
export function isCurrentBundledDefinition(pluginId: string, source: string, definition: PluginDefinition | undefined): boolean {
  return source === 'builtin' && !!definition
    && bundledDefinitions.get(definition)?.pluginId === pluginId
    && pluginRegistry.getPluginDefinition(pluginId, 'production') === definition
}
