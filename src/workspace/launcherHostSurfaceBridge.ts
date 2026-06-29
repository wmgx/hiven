import { useAppStore, type LauncherHostSurfaceTarget } from '../store'
import { usePluginSettingsStore, type PluginSettingsSource } from './pluginSettingsStore'
import { showLauncherWindow } from './windowManager/launcherWindow'
import { LAUNCHER_WINDOW_LABEL } from './windowManager/windowLabels'

export const LAUNCHER_HOST_SURFACE_OPEN_EVENT = 'hiven://launcher-host-surface-open'

const PENDING_LAUNCHER_HOST_SURFACE_KEY = 'hiven:launcher-host-surface-pending-open'
const MAX_PENDING_AGE_MS = 30_000

export type LauncherHostSurfaceOpenRequest =
  | { kind: 'host-surface'; target: LauncherHostSurfaceTarget }
  | { kind: 'plugin-settings'; source: PluginSettingsSource; pluginId: string }

type PendingLauncherHostSurfaceOpen = {
  request: LauncherHostSurfaceOpenRequest
  createdAt: number
}

export async function requestOpenLauncherHostSurface(target: LauncherHostSurfaceTarget): Promise<void> {
  await requestOpenLauncherHostSurfaceRequest({ kind: 'host-surface', target })
}

export async function requestOpenLauncherPluginSettingsSurface(source: PluginSettingsSource, pluginId: string): Promise<void> {
  await requestOpenLauncherHostSurfaceRequest({ kind: 'plugin-settings', source, pluginId })
}

export async function requestOpenLauncherHostSurfaceRequest(request: LauncherHostSurfaceOpenRequest): Promise<void> {
  writePendingLauncherHostSurfaceOpen(request)

  if (!isTauriRuntime()) {
    openLauncherHostSurfaceRequestLocally(request)
    return
  }

  await showLauncherWindow()
  try {
    const { emitTo } = await import('@tauri-apps/api/event')
    await emitTo(LAUNCHER_WINDOW_LABEL, LAUNCHER_HOST_SURFACE_OPEN_EVENT, request)
  } catch (error) {
    console.warn('[hiven] Failed to emit launcher host surface open request:', error)
  }
}

export function openLauncherHostSurfaceLocally(target: LauncherHostSurfaceTarget): void {
  openLauncherHostSurfaceRequestLocally({ kind: 'host-surface', target })
}

export function openLauncherHostSurfaceRequestLocally(request: LauncherHostSurfaceOpenRequest): void {
  clearPendingLauncherHostSurfaceOpen()

  if (request.kind === 'host-surface') {
    useAppStore.getState().openLauncherHostSurface(request.target)
    return
  }

  usePluginSettingsStore.getState().openSettingsDialog({
    source: request.source,
    pluginId: request.pluginId,
    presentation: 'global-launcher',
    context: { surfaceId: 'global-launcher' },
  })
}

export function consumePendingLauncherHostSurfaceOpen(): LauncherHostSurfaceOpenRequest | null {
  try {
    const raw = localStorage.getItem(PENDING_LAUNCHER_HOST_SURFACE_KEY)
    if (!raw) return null
    localStorage.removeItem(PENDING_LAUNCHER_HOST_SURFACE_KEY)
    const parsed = JSON.parse(raw) as Partial<PendingLauncherHostSurfaceOpen>
    if (!isLauncherHostSurfaceOpenRequest(parsed.request)) return null
    if (typeof parsed.createdAt !== 'number' || Date.now() - parsed.createdAt > MAX_PENDING_AGE_MS) return null
    return parsed.request
  } catch {
    return null
  }
}

export function isLauncherHostSurfaceOpenRequest(value: unknown): value is LauncherHostSurfaceOpenRequest {
  const request = value as Partial<LauncherHostSurfaceOpenRequest> | undefined
  if (!request || typeof request !== 'object') return false
  if (request.kind === 'host-surface') return isLauncherHostSurfaceTarget(request.target)
  if (request.kind === 'plugin-settings') {
    return isPluginSettingsSource(request.source) && typeof request.pluginId === 'string' && request.pluginId.length > 0
  }
  return false
}

export function isLauncherHostSurfaceTarget(value: unknown): value is LauncherHostSurfaceTarget {
  return value === 'settings' || value === 'plugins'
}

function clearPendingLauncherHostSurfaceOpen(): void {
  try {
    localStorage.removeItem(PENDING_LAUNCHER_HOST_SURFACE_KEY)
  } catch {
    // Ignore storage failures; pending delivery is best effort.
  }
}

function writePendingLauncherHostSurfaceOpen(request: LauncherHostSurfaceOpenRequest): void {
  try {
    localStorage.setItem(PENDING_LAUNCHER_HOST_SURFACE_KEY, JSON.stringify({
      request,
      createdAt: Date.now(),
    } satisfies PendingLauncherHostSurfaceOpen))
  } catch {
    // Best effort; the direct Tauri event still carries the request.
  }
}

function isPluginSettingsSource(value: unknown): value is PluginSettingsSource {
  return value === 'builtin' || value === 'installed' || value === 'dev'
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
