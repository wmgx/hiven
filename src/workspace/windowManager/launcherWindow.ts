import { invoke } from '@tauri-apps/api/core'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../../surfaces/registry'

export async function showLauncherWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('show_launcher_window')
  upsertSurfaceInstance({
    id: 'launcher',
    kind: 'launcher',
    windowLabel: 'launcher',
    title: 'Hiven Launcher',
    state: 'visible',
    canReceiveText: true,
  })
}

export async function hideLauncherWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('hide_launcher_window')
  markSurfaceInstanceState('launcher', 'hidden')
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
