import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { LogicalSize } from '@tauri-apps/api/window'
import { pluginRegistry } from './pluginRegistry'
import type { PluginSurfaceOpenTarget } from '../store'
import type { PluginDefinition, PluginUiSurfaceContribution } from './pluginTypes'

type ShortcutPresentation = 'launcher' | 'window'

type WindowSurfaceEntry = NonNullable<PluginUiSurfaceContribution['entry']> & {
  shortcutPresentation?: ShortcutPresentation
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

export function getPluginSurfaceShortcutPresentation(target: PluginSurfaceOpenTarget): ShortcutPresentation {
  const surface = resolvePluginSurface(target)
  return surface?.entry?.shortcutPresentation === 'window' ? 'window' : 'launcher'
}

export async function requestOpenPluginSurfaceWindow(target: PluginSurfaceOpenTarget): Promise<void> {
  if (!isTauriRuntime()) return

  const surface = resolvePluginSurface(target)
  const shell = surface?.shell
  const width = shell?.defaultWidth ?? DEFAULT_WIDTH
  const height = shell?.defaultHeight ?? DEFAULT_HEIGHT
  const label = pluginSurfaceWindowLabel(target)
  const url = pluginSurfaceWindowUrl(target)

  const existing = await WebviewWindow.getByLabel(label).catch(() => null)
  if (existing) {
    await existing.setSize(new LogicalSize(width, height)).catch(() => undefined)
    await existing.show().catch(() => undefined)
    await existing.setFocus().catch(() => undefined)
    return
  }

  const win = new WebviewWindow(label, {
    url,
    title: surface?.title ?? target.surfaceId,
    width,
    height,
    minWidth: shell?.minWidth ?? 320,
    minHeight: shell?.minHeight ?? 240,
    decorations: false,
    transparent: true,
    shadow: false,
    resizable: shell?.resizable !== false,
    focus: true,
    skipTaskbar: false,
  })

  const cleanup = await win.once('tauri://created', () => {
    cleanup()
    void win.center().catch(() => undefined)
    void win.setFocus().catch(() => undefined)
  })
}

export function pluginSurfaceWindowLabel(target: PluginSurfaceOpenTarget): string {
  return ['plugin-surface', target.source, safeLabelPart(target.pluginId), safeLabelPart(target.surfaceId)].join('-')
}

export function pluginSurfaceWindowDestroyTimeout(target: PluginSurfaceOpenTarget): number {
  return resolvePluginSurface(target)?.shell?.destroyTimeout ?? DEFAULT_DESTROY_TIMEOUT_MS
}

export function pluginSurfaceWindowCloseOnBlur(target: PluginSurfaceOpenTarget): boolean {
  return resolvePluginSurface(target)?.shell?.closeOnBlur !== false
}

function pluginSurfaceWindowUrl(target: PluginSurfaceOpenTarget): string {
  const params = new URLSearchParams({
    window: 'plugin-surface',
    source: target.source,
    pluginId: target.pluginId,
    surfaceId: target.surfaceId,
  })
  return `index.html?${params.toString()}`
}

function resolvePluginSurface(target: PluginSurfaceOpenTarget): WindowCapableSurface | null {
  const def = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
  return (def?.ui?.surfaces?.find((surface) => surface.id === target.surfaceId) as WindowCapableSurface | undefined) ?? null
}

function safeLabelPart(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '-')
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
