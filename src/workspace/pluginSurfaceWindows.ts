import { invoke } from '@tauri-apps/api/core'
import { pluginRegistry } from './pluginRegistry'
import type { PluginSurfaceOpenTarget } from '../store'
import type { PluginDefinition, PluginSurfaceShortcutPresentation, PluginUiSurfaceContribution } from './pluginTypes'

type WindowSurfaceEntry = NonNullable<PluginUiSurfaceContribution['entry']> & {
  shortcutPresentation?: PluginSurfaceShortcutPresentation
}

type WindowSurfaceShell = NonNullable<PluginUiSurfaceContribution['shell']> & {
  destroyTimeout?: number
}

type WindowCapableSurface = PluginUiSurfaceContribution & {
  entry?: WindowSurfaceEntry
  shell?: WindowSurfaceShell
}

const DEFAULT_WIDTH = 900
const DEFAULT_HEIGHT = 640
const DEFAULT_DESTROY_TIMEOUT_MS = 120_000

export function getPluginSurfaceShortcutPresentation(target: PluginSurfaceOpenTarget): PluginSurfaceShortcutPresentation {
  const surface = resolvePluginSurface(target)
  return surface?.entry?.shortcutPresentation === 'window' ? 'window' : 'launcher'
}

export async function requestOpenPluginSurfaceWindow(target: PluginSurfaceOpenTarget): Promise<void> {
  if (!isTauriRuntime()) return

  const surface = resolvePluginSurface(target)
  const shell = surface?.shell
  const width = shell?.defaultWidth ?? DEFAULT_WIDTH
  const height = shell?.defaultHeight ?? DEFAULT_HEIGHT
  const closeOnBlur = shell?.closeOnBlur !== false
  const destroyTimeoutMs = shell?.destroyTimeout ?? DEFAULT_DESTROY_TIMEOUT_MS

  await invoke('show_plugin_surface_window', {
    pluginId: target.pluginId,
    surfaceId: target.surfaceId,
    source: target.source,
    width,
    height,
    closeOnBlur,
    destroyTimeoutMs,
  })
}

function resolvePluginSurface(target: PluginSurfaceOpenTarget): WindowCapableSurface | null {
  const def = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
  return (def?.ui?.surfaces?.find((surface) => surface.id === target.surfaceId) as WindowCapableSurface | undefined) ?? null
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
