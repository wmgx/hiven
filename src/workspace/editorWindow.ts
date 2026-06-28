import { invoke } from '@tauri-apps/api/core'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../surfaces/registry'
import { EDITOR_WINDOW_LABEL } from './windowManager/windowLabels'

export async function requestOpenEditorWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('show_editor_window')
  upsertSurfaceInstance({
    id: EDITOR_WINDOW_LABEL,
    kind: 'editor',
    windowLabel: EDITOR_WINDOW_LABEL,
    title: 'Hiven Editor',
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: true,
  })
}

export async function requestCloseEditorWindow(): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('close_editor_window')
  markSurfaceInstanceState(EDITOR_WINDOW_LABEL, 'hidden')
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
