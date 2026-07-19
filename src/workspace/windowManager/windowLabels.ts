import type { PluginSurfaceOpenTarget } from '../../store'

/** @deprecated Use dynamic editor window labels (editor:{id}) instead */
export const EDITOR_WINDOW_LABEL = 'editor'
export const EDITOR_WINDOW_LABEL_PREFIX = 'editor'
export const LAUNCHER_WINDOW_LABEL = 'launcher'

export function pluginSurfaceWindowLabel(target: PluginSurfaceOpenTarget): string {
  return `plugin-surface:${target.source}:${target.pluginId}:${target.surfaceId}`
}

export function isEditorWindowLabel(label: string): boolean {
  return label === 'editor' || label.startsWith('editor:')
}
