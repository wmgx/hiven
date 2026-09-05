import { invoke } from '@tauri-apps/api/core'
import { pluginRegistry } from './pluginRegistry'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../surfaces/registry'
import { suppressStandaloneLauncherBlur } from './launcherBlurGuard'
import type { PluginSurfaceOpenTarget } from '../store'
import type { PluginDefinition, PluginSurfaceShortcutPresentation, PluginUiSurfaceContribution } from './pluginTypes'
import { isNativeDesktopRuntime } from './webNativeBridge'

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
  if (!isNativeDesktopRuntime()) return

  const surface = resolvePluginSurface(target)
  const shell = surface?.shell
  const width = shell?.defaultWidth ?? DEFAULT_WIDTH
  const height = shell?.defaultHeight ?? DEFAULT_HEIGHT
  const closeOnBlur = shell?.closeOnBlur !== false
  const destroyTimeoutMs = shell?.destroyTimeout ?? DEFAULT_DESTROY_TIMEOUT_MS
  const label = pluginSurfaceWindowLabel(target)

  // Opening a focused companion window blurs the launcher; keep it for coexistence.
  suppressStandaloneLauncherBlur(2_000)

  if (target.initialText) {
    await invoke('plugin_surface_payload_set', {
      label,
      payload: { initialText: target.initialText },
    })
  }

  await invoke('show_plugin_surface_window', {
    pluginId: target.pluginId,
    surfaceId: target.surfaceId,
    source: target.source,
    title: surface?.title,
    width,
    height,
    minWidth: shell?.minWidth,
    minHeight: shell?.minHeight,
    resizable: shell?.resizable,
    closeOnBlur,
    destroyTimeoutMs,
  })
  upsertSurfaceInstance({
    id: pluginSurfaceInstanceId(target),
    kind: 'plugin-surface',
    windowLabel: pluginSurfaceWindowLabel(target),
    title: surface?.title ?? target.surfaceId,
    pluginId: target.pluginId,
    surfaceId: target.surfaceId,
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: true,
  })
}

export async function requestHidePluginSurfaceWindow(target: PluginSurfaceOpenTarget): Promise<void> {
  if (!isNativeDesktopRuntime()) return

  const surface = resolvePluginSurface(target)
  const destroyTimeoutMs = surface?.shell?.destroyTimeout ?? DEFAULT_DESTROY_TIMEOUT_MS

  await invoke('hide_plugin_surface_window', {
    pluginId: target.pluginId,
    surfaceId: target.surfaceId,
    source: target.source,
    destroyTimeoutMs,
  })
  markSurfaceInstanceState(pluginSurfaceInstanceId(target), 'hidden')
}

export function pluginSurfaceInstanceId(target: PluginSurfaceOpenTarget): string {
  return `plugin-surface:${target.source}:${target.pluginId}:${target.surfaceId}`
}

export function pluginSurfaceWindowLabel(target: PluginSurfaceOpenTarget): string {
  return `plugin-surface:${target.source}:${target.pluginId}:${target.surfaceId}`
}

function resolvePluginSurface(target: PluginSurfaceOpenTarget): WindowCapableSurface | null {
  const def = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
  return (def?.ui?.surfaces?.find((surface) => surface.id === target.surfaceId) as WindowCapableSurface | undefined) ?? null
}
