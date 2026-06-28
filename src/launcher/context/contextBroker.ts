import type { TextRange } from '../../workspace/launcher/types'
import { runtimeRegistry } from '../../workspace/runtimeRegistry'
import { useWorkspaceStore } from '../../workspace/workspaceStore'

export type WorkContextInvocationSource = 'global-hotkey' | 'editor-command-bar' | 'plugin-surface'

export type EditorContextSnapshot = {
  windowLabel: 'editor'
  activePaneId: string
  paneIds: string[]
  language?: string
  selectedText?: string
  selectionRange?: TextRange
  cursor?: { line: number; column: number }
}

export type ClipboardContextSnapshot = {
  kind: 'text' | 'image' | 'files' | 'empty'
  text?: string
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
    const partial = await provider.getSnapshot()
    Object.assign(snapshot, partial)
  }
  return snapshot
}

export const editorContextProvider: ContextSnapshotProvider = {
  id: 'editor',
  getSnapshot: () => {
    const state = useWorkspaceStore.getState()
    const pane = state.panes[state.activePaneId]
    if (!pane) return {}
    const editor = runtimeRegistry.getCodeEditor(state.activePaneId)
    const selection = editor?.getSelection?.()
    const model = editor?.getModel?.()
    const selectedText = selection && !selection.isEmpty?.()
      ? model?.getValueInRange(selection)
      : undefined
    const position = editor?.getPosition?.()
    const selectionRange: TextRange | undefined = selection && !selection.isEmpty?.()
      ? {
          startLineNumber: selection.startLineNumber,
          startColumn: selection.startColumn,
          endLineNumber: selection.endLineNumber,
          endColumn: selection.endColumn,
        }
      : undefined

    return {
      editor: {
        windowLabel: 'editor',
        activePaneId: state.activePaneId,
        paneIds: state.paneOrder,
        language: pane.language ?? pane.detectedLanguage,
        selectedText,
        selectionRange,
        cursor: position
          ? { line: position.lineNumber, column: position.column }
          : undefined,
      },
    }
  },
}

export const clipboardContextProvider: ContextSnapshotProvider = {
  id: 'clipboard',
  getSnapshot: async () => {
    const text = await readClipboardText()
    return {
      clipboard: text
        ? { kind: 'text', text, preview: text.slice(0, 240) }
        : { kind: 'empty' },
    }
  },
}

export async function createDefaultWorkContextSnapshot(
  source: WorkContextInvocationSource,
  providers: ContextSnapshotProvider[] = [],
): Promise<WorkContextSnapshot> {
  return createWorkContextSnapshot(
    { source, timestamp: Date.now() },
    [editorContextProvider, clipboardContextProvider, ...providers],
  )
}

async function readClipboardText(): Promise<string> {
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    return (await readText()) ?? ''
  } catch {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
}
