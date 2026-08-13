import type { TextRange } from '../../workspace/launcher/types'
import { getActiveEditorContextSnapshot, getEditorContext } from '../../workspace/editorBridge'
import { EDITOR_WINDOW_LABEL } from '../../workspace/windowManager/windowLabels'
import { launcherPerfNow, logLauncherPerfDuration } from '../../workspace/launcher/perf'
import { readNativeClipboardText } from '../../workspace/nativeClipboard'

export type WorkContextInvocationSource = 'global-hotkey' | 'editor-command-bar' | 'plugin-surface'


export type EditorContextSnapshot = {
  windowLabel: 'editor'
  activePaneId: string
  paneIds: string[]
  language?: string
  activeText: string
  selectedText?: string
  selectionRange?: TextRange
  cursor?: { line: number; column: number }
}

export type ClipboardContextSnapshot = {
  kind: 'text' | 'image' | 'files' | 'empty'
  text?: string
  preview?: string
}

export type ExternalSelectionContextSnapshot = {
  kind: 'text'
  text: string
  preview?: string
}

export type WorkContextSnapshot = {
  invocation: {
    source: WorkContextInvocationSource
    timestamp: number
  }
  foreground?: {
    appName?: string
    processId?: number
    windowTitle?: string
  }
  editor?: EditorContextSnapshot
  externalSelection?: ExternalSelectionContextSnapshot
  clipboard?: ClipboardContextSnapshot
}

export type ContextSnapshotProvider = {
  id: string
  getSnapshot(): Promise<Partial<WorkContextSnapshot>> | Partial<WorkContextSnapshot>
}

export async function createWorkContextSnapshot(
  invocation: WorkContextSnapshot['invocation'],
  providers: ContextSnapshotProvider[] = [],
): Promise<WorkContextSnapshot> {
  const snapshot: WorkContextSnapshot = { invocation }
  for (const provider of providers) {
    const startedAt = launcherPerfNow()
    try {
      const partial = await provider.getSnapshot()
      Object.assign(snapshot, partial)
      logLauncherPerfDuration('context:snapshot-provider', startedAt, {
        providerId: provider.id,
        keys: Object.keys(partial),
      })
    } catch (error) {
      logLauncherPerfDuration('context:snapshot-provider', startedAt, {
        providerId: provider.id,
        failed: true,
        message: error instanceof Error ? error.message : String(error),
      })
      console.warn(`[context] snapshot provider "${provider.id}" failed:`, error)
    }
  }
  return snapshot
}

export const editorContextProvider: ContextSnapshotProvider = {
  id: EDITOR_WINDOW_LABEL,
  getSnapshot: async () => {
    const cached = getActiveEditorContextSnapshot()
    if (cached) return { editor: cached }

    const editor = await getEditorContext({ timeoutMs: 300 })
    return editor ? { editor } : {}
  },
}

// [DISABLED] External selection capture — logic preserved, export disabled.
// export const externalSelectionContextProvider: ContextSnapshotProvider = {
//   id: 'external-selection',
//   getSnapshot: async () => {
//     const text = await readLastForegroundSelectionText()
//     return text
//       ? { externalSelection: { kind: 'text', text, preview: text.slice(0, 240) } }
//       : {}
//   },
// }

export const clipboardContextProvider: ContextSnapshotProvider = {
  id: 'clipboard',
  getSnapshot: async () => {
    const text = await readNativeClipboardText()
    return {
      clipboard: text
        ? { kind: 'text', text, preview: text.slice(0, 240) }
        : { kind: 'empty' },
    }
  },
}

export const foregroundContextProvider: ContextSnapshotProvider = {
  id: 'foreground',
  getSnapshot: async () => {
    const foreground = await readForegroundAppContext()
    return foreground ? { foreground } : {}
  },
}

export async function createDefaultWorkContextSnapshot(
  source: WorkContextInvocationSource,
  providers: ContextSnapshotProvider[] = [],
): Promise<WorkContextSnapshot> {
  return createWorkContextSnapshot(
    { source, timestamp: Date.now() },
    // NOTE: externalSelectionContextProvider intentionally removed from defaults.
    // Global Launcher no longer auto-reads external app selection (clipboard-first design).
    [foregroundContextProvider, editorContextProvider, clipboardContextProvider, ...providers],
  )
}







async function readForegroundAppContext(): Promise<WorkContextSnapshot['foreground'] | undefined> {
  if (!isTauriRuntime()) return undefined
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    const foreground = await invoke<WorkContextSnapshot['foreground']>('current_foreground_app_context')
    if (!foreground?.appName && !foreground?.processId && !foreground?.windowTitle) return undefined
    return foreground
  } catch {
    return undefined
  }
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
