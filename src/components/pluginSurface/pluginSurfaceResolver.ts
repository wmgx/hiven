import { pluginRegistry } from '../../workspace/pluginRegistry'
import type { PluginDefinition, PluginUiSurfaceContribution } from '../../workspace/pluginTypes'
import type { PluginSurfaceOpenTarget } from '../../store'

export type ResolvedPluginSurface = {
  definition: PluginDefinition<unknown>
  surface: PluginUiSurfaceContribution<unknown>
}

export function resolvePluginSurface(target: PluginSurfaceOpenTarget): ResolvedPluginSurface | null {
  const definition = pluginRegistry.getPluginDefinition(
    target.pluginId,
    target.source,
  ) as PluginDefinition<unknown> | undefined
  const surface = definition?.ui?.surfaces?.find((candidate) => candidate.id === target.surfaceId) as PluginUiSurfaceContribution<unknown> | undefined
  return definition && surface ? { definition, surface } : null
}
