import type { TextRange } from '../../workspace/launcher/types'
import { runtimeRegistry } from '../../workspace/runtimeRegistry'
import { useWorkspaceStore } from '../../workspace/workspaceStore'
import { getActiveEditorContextSnapshot, getEditorContext } from '../../workspace/editorBridge'
import { EDITOR_WINDOW_LABEL } from '../../workspace/windowManager/windowLabels'

export type WorkContextInvocationSource = 'global-hotkey' | 'editor-command-bar' | 'plugin-surface'

const FOREGROUND_SELECTION_READ_ATTEMPTS = 3
const FOREGROUND_SELECTION_READ_RETRY_MS = 60

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
    try {
      const partial = await provider.getSnapshot()
      Object.assign(snapshot, partial)
    } catch (error) {
      console.warn(`[context] snapshot provider "${provider.id}" failed:`, error)
    }
  }
  return snapshot
}

export const editorContextProvider: ContextSnapshotProvider = {
  id: EDITOR_WINDOW_LABEL,
  getSnapshot: async () => {
    if (isEditorWindowRuntime()) {
      const editor = readLocalEditorContextSnapshot()
      return editor ? { editor } : {}
    }

    const cached = getActiveEditorContextSnapshot()
    if (cached) return { editor: cached }

    const editor = await getEditorContext({ timeoutMs: 300 })
    return editor ? { editor } : {}
  },
}

export function readLocalEditorContextSnapshot(): EditorContextSnapshot | undefined {
  const state = useWorkspaceStore.getState()
  const pane = state.panes[state.activePaneId]
  if (!pane) return undefined
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
    windowLabel: EDITOR_WINDOW_LABEL,
    activePaneId: state.activePaneId,
    paneIds: state.paneOrder,
    language: pane.language ?? pane.detectedLanguage,
    activeText: pane.text,
    selectedText,
    selectionRange,
    cursor: position
      ? { line: position.lineNumber, column: position.column }
      : undefined,
  }
}


export const externalSelectionContextProvider: ContextSnapshotProvider = {
  id: 'external-selection',
  getSnapshot: async () => {
    const text = await readLastForegroundSelectionText()
    return text
      ? { externalSelection: { kind: 'text', text, preview: text.slice(0, 240) } }
      : {}
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
    [foregroundContextProvider, editorContextProvider, externalSelectionContextProvider, clipboardContextProvider, ...providers],
  )
}


async function readLastForegroundSelectionText(): Promise<string> {
  if (!isTauriRuntime()) return ''
  try {
    const { invoke } = await import('@tauri-apps/api/core')
    for (let attempt = 0; attempt < FOREGROUND_SELECTION_READ_ATTEMPTS; attempt += 1) {
      const text = await invoke<string | null>('last_foreground_selection_text') ?? ''
      if (text) return text
      if (attempt < FOREGROUND_SELECTION_READ_ATTEMPTS - 1) {
        await delay(FOREGROUND_SELECTION_READ_RETRY_MS)
      }
    }
    return ''
  } catch {
    return ''
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms))
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

function isEditorWindowRuntime(): boolean {
  return new URLSearchParams(window.location.search).get('window') === 'editor'
}
