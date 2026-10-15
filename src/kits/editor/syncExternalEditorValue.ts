import type { editor as MonacoEditor } from 'monaco-editor'

/**
 * Synchronize a controlled value into Monaco without merging that replacement
 * into the user's preceding or following undo unit.
 */
export function syncExternalEditorValue(
  editor: MonacoEditor.IStandaloneCodeEditor,
  value: string,
  readOnly: boolean,
): boolean {
  const model = editor.getModel()
  if (!model || model.getValue() === value) return false

  if (readOnly) {
    model.setValue(value)
    return true
  }

  const fullRange = model.getFullModelRange()
  editor.pushUndoStop()
  try {
    return editor.executeEdits('external', [{
      range: fullRange,
      text: value,
      forceMoveMarkers: false,
    }])
  } finally {
    editor.pushUndoStop()
  }
}
