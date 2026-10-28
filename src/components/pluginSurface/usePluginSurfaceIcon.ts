import type { PluginSurfaceOpenTarget } from '../../store'
import { pluginRegistry, usePluginRegistryVersion } from '../../workspace/pluginRegistry'

export function usePluginSurfaceIcon(target: PluginSurfaceOpenTarget | null): string {
  usePluginRegistryVersion()
  return target ? pluginRegistry.getPluginDefinition(target.pluginId, target.source)?.ui?.surfaces?.find(surface => surface.id === target.surfaceId)?.icon ?? 'Puzzle' : 'Puzzle'
}
