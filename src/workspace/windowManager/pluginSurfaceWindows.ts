import type { PluginSurfaceOpenTarget } from '../../store'
import { pluginRegistry } from '../pluginRegistry'
import type { PluginDefinition } from '../pluginTypes'

export type PluginSurfaceWindowOptions = PluginSurfaceOpenTarget & {
  title?: string
  width?: number
  height?: number
  minWidth?: number
  minHeight?: number
  resizable?: boolean
  closeOnBlur?: boolean
  destroyTimeout?: number
}

export function buildPluginSurfaceWindowLabel(target: PluginSurfaceOpenTarget): string {
  const { source, pluginId, surfaceId } = target
  return `plugin-surface:${source}:${pluginId}:${surfaceId}`
}

export const getPluginSurfaceWindowLabel = buildPluginSurfaceWindowLabel

export async function showPluginSurfaceWindow(target: PluginSurfaceOpenTarget): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  const options = resolvePluginSurfaceWindowOptions(target)
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('show_plugin_surface_window', { options })
}

export async function hidePluginSurfaceWindow(target: PluginSurfaceOpenTarget): Promise<void> {
  if (!isTauriRuntime()) {
    return
  }

  const options = resolvePluginSurfaceWindowOptions(target)
  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('hide_plugin_surface_window', {
    options: {
      label: buildPluginSurfaceWindowLabel(target),
      destroyTimeout: options.destroyTimeout,
    },
  })
}

function resolvePluginSurfaceWindowOptions(target: PluginSurfaceOpenTarget): PluginSurfaceWindowOptions {
  const def = pluginRegistry.getPluginDefinition(
    target.pluginId,
    target.source,
  ) as PluginDefinition<unknown> | undefined
  const surface = def?.ui?.surfaces?.find((candidate) => candidate.id === target.surfaceId)
  const shell = surface?.shell

  return {
    ...target,
    title: surface?.title ?? target.pluginId,
    width: shell?.defaultWidth,
    height: shell?.defaultHeight,
    minWidth: shell?.minWidth,
    minHeight: shell?.minHeight,
    resizable: shell?.resizable,
    closeOnBlur: shell?.closeOnBlur,
    destroyTimeout: shell?.destroyTimeout,
  }
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
