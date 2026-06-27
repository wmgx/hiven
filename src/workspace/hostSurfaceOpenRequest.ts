import { useAppStore, type HostLauncherSurface } from '../store'

const PENDING_OPEN_KEY = 'hiven-host-surface-open-request'
const MAX_PENDING_AGE_MS = 30_000

export type HostSurfaceOpenRequest = {
  surface: HostLauncherSurface
  createdAt: number
  nonce: string
}

export function isHostLauncherSurface(value: unknown): value is HostLauncherSurface {
  return value === 'settings' || value === 'plugins' || value === 'plugin-editor' || value === 'pinned-runner'
}

export function writePendingHostSurfaceOpenRequest(surface: HostLauncherSurface): void {
  try {
    localStorage.setItem(PENDING_OPEN_KEY, JSON.stringify({
      surface,
      createdAt: Date.now(),
      nonce: `${Date.now()}:${Math.random().toString(36).slice(2)}`,
    } satisfies HostSurfaceOpenRequest))
  } catch (error) {
    console.warn('[hiven] Failed to persist host surface open request:', error)
  }
}

export function consumePendingHostSurfaceOpenRequest(): HostLauncherSurface | null {
  try {
    const raw = localStorage.getItem(PENDING_OPEN_KEY)
    if (!raw) return null
    localStorage.removeItem(PENDING_OPEN_KEY)
    const parsed = JSON.parse(raw) as Partial<HostSurfaceOpenRequest>
    if (!isHostLauncherSurface(parsed.surface) || typeof parsed.createdAt !== 'number') return null
    if (Date.now() - parsed.createdAt > MAX_PENDING_AGE_MS) return null
    return parsed.surface
  } catch (error) {
    console.warn('[hiven] Failed to consume host surface open request:', error)
    return null
  }
}

export async function requestOpenHostLauncherSurface(surface: HostLauncherSurface): Promise<void> {
  writePendingHostSurfaceOpenRequest(surface)
  if (!isTauriRuntime()) {
    useAppStore.getState().openHostLauncherSurface(surface)
    useAppStore.getState().openGlobalLauncherOverlay('pinned-only')
    return
  }

  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('show_launcher_window')
  try {
    const { emitTo } = await import('@tauri-apps/api/event')
    await emitTo('launcher', 'hiven://open-host-surface', { surface })
  } catch (error) {
    console.warn('[hiven] Failed to emit host surface open request:', error)
  }
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
