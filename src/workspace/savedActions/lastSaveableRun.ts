import type { LastSaveableRunState } from './types'

const TTL_MS = 30 * 60 * 1000
let fallbackRun: LastSaveableRunState | null = null
const listeners = new Set<(run: LastSaveableRunState) => void>()

/** Observe completed deliveries in this window; reopening reads the native snapshot. */
export function subscribeLastSaveableRun(listener: (run: LastSaveableRunState) => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function isTauri(): boolean {
  return typeof window !== 'undefined' && Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke: tauriInvoke } = await import('@tauri-apps/api/core')
  return tauriInvoke<T>(command, args)
}

export function freshLastSaveableRun(run: LastSaveableRunState | null): LastSaveableRunState | null {
  return run && Date.now() - run.completedAt <= TTL_MS ? run : null
}

export function setLastSaveableRun(run: LastSaveableRunState): void {
  fallbackRun = structuredClone(run)
  for (const listener of listeners) {
    try { listener(structuredClone(run)) } catch (error) {
      console.warn('[hiven] Last run refresh failed:', error)
    }
  }
  if (!isTauri()) return
  void invoke<void>('last_saveable_run_set', { run }).catch((error) => {
    console.warn('[hiven] Failed to update last saveable run:', error)
  })
}

export async function getLastSaveableRun(): Promise<LastSaveableRunState | null> {
  if (!isTauri()) return freshLastSaveableRun(fallbackRun)
  return freshLastSaveableRun(await invoke<LastSaveableRunState | null>('last_saveable_run_get'))
}
