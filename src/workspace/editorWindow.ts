import { invoke } from '@tauri-apps/api/core'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../surfaces/registry'

export async function requestOpenEditorWindow(): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined
  const label = await invoke<string>('show_editor_window')
  upsertSurfaceInstance({
    id: label,
    kind: 'editor',
    windowLabel: label,
    title: 'Hiven Editor',
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: true,
  })
  return label
}

export async function requestOpenNewEditorWindow(): Promise<string | undefined> {
  if (!isTauriRuntime()) return undefined
  const label = await invoke<string>('open_new_editor_window')
  upsertSurfaceInstance({
    id: label,
    kind: 'editor',
    windowLabel: label,
    title: 'Hiven Editor',
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: true,
  })
  return label
}

export async function requestFocusEditorWindow(label: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('focus_editor_window', { label })
  upsertSurfaceInstance({
    id: label,
    kind: 'editor',
    windowLabel: label,
    title: 'Hiven Editor',
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: true,
  })
}

export async function requestCloseEditorWindow(label?: string): Promise<void> {
  if (!isTauriRuntime()) return
  await invoke('close_editor_window', { label: label ?? null })
  if (label) {
    markSurfaceInstanceState(label, 'destroyed')
  }
}

export async function requestListEditorWindows(): Promise<string[]> {
  if (!isTauriRuntime()) return []
  return await invoke<string[]>('list_editor_windows')
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
