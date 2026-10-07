import type { PluginDefinition } from './pluginTypes'
import type { PluginToolContribution } from './launcher/types'
import { pluginRegistry } from './pluginRegistry'

type PreviewRunner = NonNullable<PluginToolContribution['explicitTextPreview']>['run']

// Provenance belongs to the final localized objects loaded by the bundled
// loader. Plugin ids, store metadata, and source labels cannot recreate it.
const bundledDefinitions = new WeakMap<PluginDefinition, {
  pluginId: string
  runners: Map<PluginToolContribution, PreviewRunner>
}>()

/** Called only by the bundled loader, after localization and before registration. */
export function markBundledPluginDefinition(pluginId: string, definition: PluginDefinition): void {
  const runners = new Map<PluginToolContribution, PreviewRunner>()
  for (const tool of definition.tools ?? []) {
    if (tool.policy?.effect === 'pure' && tool.explicitTextPreview) {
      runners.set(tool, tool.explicitTextPreview.run)
    }
  }
  bundledDefinitions.set(definition, { pluginId, runners })
}

/** Recheck current registration and exact definition, tool, and runner identities. */
export function resolveBundledTextPreviewRunner(
  pluginId: string,
  source: 'builtin' | 'installed' | 'dev',
  definition: PluginDefinition | undefined,
  tool: PluginToolContribution,
): PreviewRunner | undefined {
  if (source !== 'builtin' || !definition) return undefined
  const bundled = bundledDefinitions.get(definition)
  if (!bundled || bundled.pluginId !== pluginId) return undefined
  if (pluginRegistry.getPluginDefinition(pluginId, 'production') !== definition) return undefined
  if (!definition.tools?.includes(tool) || tool.policy?.effect !== 'pure') return undefined
  const runner = bundled.runners.get(tool)
  return runner && runner === tool.explicitTextPreview?.run ? runner : undefined
}
