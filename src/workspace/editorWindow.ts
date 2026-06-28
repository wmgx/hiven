import { invoke } from '@tauri-apps/api/core'
import { upsertSurfaceInstance } from '../surfaces/registry'

export async function requestOpenEditorWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('show_editor_window')
  upsertSurfaceInstance({
    id: 'editor',
    kind: 'editor',
    windowLabel: 'editor',
    title: 'Hiven Editor',
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: true,
  })
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
