import type { PluginSurfaceOpenTarget } from '../../store'

export const EDITOR_WINDOW_LABEL = 'editor'
export const LAUNCHER_WINDOW_LABEL = 'launcher'

export function pluginSurfaceWindowLabel(target: PluginSurfaceOpenTarget): string {
  return `plugin-surface:${target.source}:${target.pluginId}:${target.surfaceId}`
}
