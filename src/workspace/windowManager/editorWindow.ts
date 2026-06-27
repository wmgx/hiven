import { useAppStore } from '../../store'
import { useWorkspaceStore } from '../workspaceStore'

export type EditorWindowOptions = {
  initialText?: string
  language?: string
  title?: string
}

export async function showEditorWindow(options: EditorWindowOptions = {}): Promise<void> {
  if (!isTauriRuntime()) {
    openEditorInCurrentWindow(options)
    return
  }

  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('show_editor_window', { options })
}

export async function openEditorWindow(options: EditorWindowOptions = {}): Promise<void> {
  await showEditorWindow(options)
}

export async function closeEditorWindow(): Promise<void> {
  if (!isTauriRuntime()) return

  const { invoke } = await import('@tauri-apps/api/core')
  await invoke('close_editor_window')
}

function openEditorInCurrentWindow(options: EditorWindowOptions): void {
  const app = useAppStore.getState()
  app.setActiveView('editor')
  app.setCommandPaletteOpen(false)
  app.setGlobalLauncherOpen(false)

  const hasInitialPane =
    options.initialText !== undefined ||
    options.language !== undefined ||
    options.title !== undefined
  if (!hasInitialPane) return

  useWorkspaceStore.getState().createPane({
    text: options.initialText ?? '',
    title: options.title,
    language: options.language,
    focus: true,
    direction: 'right',
  })
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
