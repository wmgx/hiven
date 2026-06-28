import {
  requestCloseEditorWindow,
  requestOpenEditorWindow,
} from '../editorWindow'

export async function showEditorWindow(): Promise<void> {
  await requestOpenEditorWindow()
}

export async function closeEditorWindow(): Promise<void> {
  await requestCloseEditorWindow()
}
