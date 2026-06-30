import {
  requestCloseEditorWindow,
  requestFocusEditorWindow,
  requestListEditorWindows,
  requestOpenEditorWindow,
  requestOpenNewEditorWindow,
} from '../editorWindow'

export async function showEditorWindow(): Promise<void> {
  await requestOpenEditorWindow()
}

export async function openNewEditorWindow(): Promise<string | undefined> {
  return await requestOpenNewEditorWindow()
}

export async function focusEditorWindow(label: string): Promise<void> {
  await requestFocusEditorWindow(label)
}

export async function closeEditorWindow(label?: string): Promise<void> {
  await requestCloseEditorWindow(label)
}

export async function listEditorWindows(): Promise<string[]> {
  return await requestListEditorWindows()
}
