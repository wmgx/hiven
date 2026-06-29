import type { EditorContextSnapshot } from '../launcher/context/contextBroker'
import type { TextRange } from './launcher/types'
import { runtimeRegistry } from './runtimeRegistry'
import { useWorkspaceStore } from './workspaceStore'
import { EDITOR_WINDOW_LABEL } from './windowManager/windowLabels'

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
