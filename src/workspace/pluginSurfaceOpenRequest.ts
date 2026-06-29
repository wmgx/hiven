import { useAppStore, type PluginSurfaceOpenTarget } from '../store'
import { pluginRegistry } from './pluginRegistry'
import { resizeCurrentLauncherWindow, showLauncherWindow } from './windowManager/launcherWindow'
import { LAUNCHER_WINDOW_LABEL } from './windowManager/windowLabels'
import type { PluginDefinition } from './pluginTypes'

const PENDING_OPEN_KEY = 'hiven-plugin-surface-open-request'
const MAX_PENDING_AGE_MS = 30_000
const STANDALONE_LAUNCHER_VERTICAL_PADDING = 24
const STANDALONE_LAUNCHER_HORIZONTAL_PADDING = 24

type PendingOpenRequest = {
  target: PluginSurfaceOpenTarget
  createdAt: number
  nonce: string
}

export function writePendingPluginSurfaceOpenTarget(target: PluginSurfaceOpenTarget): void {
  try {
    localStorage.setItem(PENDING_OPEN_KEY, JSON.stringify({
      target,
      createdAt: Date.now(),
      nonce: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    } satisfies PendingOpenRequest))
  } catch (error) {
    console.warn('[hiven] Failed to persist plugin surface open request:', error)
  }
}

export function consumePendingPluginSurfaceOpenTarget(): PluginSurfaceOpenTarget | null {
  try {
    const raw = localStorage.getItem(PENDING_OPEN_KEY)
    if (!raw) return null
    localStorage.removeItem(PENDING_OPEN_KEY)
    const parsed = JSON.parse(raw) as Partial<PendingOpenRequest>
    if (!parsed.target || typeof parsed.createdAt !== 'number') return null
    if (Date.now() - parsed.createdAt > MAX_PENDING_AGE_MS) return null
    if (!isPluginSurfaceOpenTarget(parsed.target)) return null
    return parsed.target
  } catch (error) {
    console.warn('[hiven] Failed to consume plugin surface open request:', error)
    return null
  }
}

export function openLauncherHostedPluginSurface(target: PluginSurfaceOpenTarget): void {
  useAppStore.getState().openPluginSurfaceTool(target)
  useAppStore.getState().openGlobalLauncherOverlay('pinned-only')
}

export async function requestOpenPluginSurfaceTool(target: PluginSurfaceOpenTarget): Promise<void> {
  writePendingPluginSurfaceOpenTarget(target)
  if (!isTauriRuntime()) {
    openLauncherHostedPluginSurface(target)
    return
  }

  // Pre-size the launcher window to the target surface dimensions before showing,
  // so there's no compact→surface resize jump visible to the user.
  const shell = resolveSurfaceShell(target)
  if (shell) {
    try {
      await resizeCurrentLauncherWindow({
        width: Math.ceil((shell.defaultWidth ?? 660) + STANDALONE_LAUNCHER_HORIZONTAL_PADDING),
        height: Math.ceil((shell.defaultHeight ?? 480) + STANDALONE_LAUNCHER_VERTICAL_PADDING),
      })
    } catch {
      // Non-critical: window will resize later via useLayoutEffect fallback
    }
  }

  await showLauncherWindow()
  try {
    const { emitTo } = await import('@tauri-apps/api/event')
    await emitTo(LAUNCHER_WINDOW_LABEL, 'hiven://open-plugin-surface', target)
  } catch (error) {
    console.warn('[hiven] Failed to emit plugin surface open request:', error)
  }
}

export function isPluginSurfaceOpenTarget(value: unknown): value is PluginSurfaceOpenTarget {
  if (!value || typeof value !== 'object') return false
  const target = value as Partial<PluginSurfaceOpenTarget>
  return (
    (target.source === 'builtin' || target.source === 'installed' || target.source === 'dev') &&
    typeof target.pluginId === 'string' &&
    target.pluginId.length > 0 &&
    typeof target.surfaceId === 'string' &&
    target.surfaceId.length > 0
  )
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

function resolveSurfaceShell(target: PluginSurfaceOpenTarget): { defaultWidth?: number; defaultHeight?: number } | null {
  const def = pluginRegistry.getPluginDefinition(target.pluginId, target.source) as PluginDefinition<unknown> | undefined
  const surface = def?.ui?.surfaces?.find((s) => s.id === target.surfaceId)
  return surface?.shell ?? null
}
