import { runtimeRegistry } from '../../workspace/runtimeRegistry'
import type { SerializedRange } from '../../workspace/types'
import { useWorkspaceStore } from '../../workspace/workspaceStore'

export type EditorCursor = {
  lineNumber: number
  column: number
}

export type EditorContextSnapshot = {
  activePaneId: string
  paneIds: string[]
  language?: string
  selectedText: string
  selectionRange?: SerializedRange
  cursor?: EditorCursor
}

export function getEditorContextSnapshot(): EditorContextSnapshot {
  const state = useWorkspaceStore.getState()
  const activePaneId = state.activePaneId
  const activePane = state.panes[activePaneId]
  const editor = runtimeRegistry.getCodeEditor(activePaneId)
  const selection = editor?.getSelection?.()
  const selectionRange = selection && !selection.isEmpty?.()
    ? {
        startLineNumber: selection.startLineNumber,
        startColumn: selection.startColumn,
        endLineNumber: selection.endLineNumber,
        endColumn: selection.endColumn,
      }
    : state.selections[activePaneId] ?? undefined
  const selectedText = selectionRange && editor?.getModel?.()
    ? editor.getModel().getValueInRange(selectionRange)
    : ''
  const position = editor?.getPosition?.()

  return {
    activePaneId,
    paneIds: state.paneOrder,
    language: activePane?.language,
    selectedText,
    selectionRange,
    cursor: position ? { lineNumber: position.lineNumber, column: position.column } : undefined,
  }
}
