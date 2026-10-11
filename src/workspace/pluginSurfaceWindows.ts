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

export type PluginSurfaceWindowOpenOptions = {
  /** A root Launcher action keeps the external target captured before Launcher opened. */
  pasteTarget?: 'launcher'
  signal?: AbortSignal
  isCurrent?: () => boolean
}

export async function requestOpenPluginSurfaceWindow(target: PluginSurfaceOpenTarget, options?: PluginSurfaceWindowOpenOptions): Promise<void> {
  if (!isNativeDesktopRuntime()) {
    if (target.initialText !== undefined) throw new Error('Native window handoff unavailable')
    return
  }
  const assertCurrent = () => {
    if (options?.signal?.aborted || options?.isCurrent?.() === false) throw new Error('Plugin surface handoff interrupted')
  }
  assertCurrent()

  const surface = resolvePluginSurface(target)
  const shell = surface?.shell
  const width = shell?.defaultWidth ?? DEFAULT_WIDTH
  const height = shell?.defaultHeight ?? DEFAULT_HEIGHT
  const closeOnBlur = shell?.closeOnBlur !== false
  const destroyTimeoutMs = shell?.destroyTimeout ?? DEFAULT_DESTROY_TIMEOUT_MS
  const label = pluginSurfaceWindowLabel(target)

  // Opening a focused companion window blurs the launcher; keep it for coexistence.
  suppressStandaloneLauncherBlur(2_000)

  let handoffId: string | undefined
  if (target.initialText !== undefined) {
    const record = await invoke<{ id: string }>('plugin_surface_handoff_begin', { label, initialText: target.initialText })
    handoffId = record.id
  }
  const cancelOnAbort = () => {
    if (handoffId) void invoke('plugin_surface_handoff_cancel', { label, id: handoffId }).catch(() => undefined)
  }
  options?.signal?.addEventListener('abort', cancelOnAbort, { once: true })
  try {
    assertCurrent()
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
      pasteTarget: options?.pasteTarget,
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
    if (handoffId) {
      const deadline = Date.now() + 120_000
      while (true) {
        if (options?.signal?.aborted || options?.isCurrent?.() === false || Date.now() >= deadline) {
          const status = await invoke<string>('plugin_surface_handoff_cancel', { label, id: handoffId })
          if (status === 'accepted') return
          throw new Error('Plugin surface handoff interrupted')
        }
        const status = await invoke<string>('plugin_surface_handoff_status', { label, id: handoffId })
        if (status === 'accepted') return
        if (status !== 'pending') throw new Error('Plugin surface handoff declined')
        await new Promise((resolve) => setTimeout(resolve, 120))
      }
    }
  } catch (error) {
    if (handoffId) {
      const status = await invoke<string>('plugin_surface_handoff_cancel', { label, id: handoffId }).catch(() => undefined)
      if (status === 'accepted') return
    }
    throw error
  } finally {
    options?.signal?.removeEventListener('abort', cancelOnAbort)
  }

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
