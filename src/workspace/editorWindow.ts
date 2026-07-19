import { markSurfaceInstanceState, upsertSurfaceInstance } from '../surfaces/registry'
import {
  closeQuickEditorWindow,
  isQuickEditorWindowOpen,
  QUICK_EDITOR_WINDOW_LABEL,
  showQuickEditorWindow,
} from './windowManager/quickEditorWindow'

export async function requestOpenEditorWindow(): Promise<string | undefined> {
  await showQuickEditorWindow()
  const label = QUICK_EDITOR_WINDOW_LABEL
  upsertSurfaceInstance({
    id: label,
    kind: 'editor',
    windowLabel: label,
    title: 'Quick Editor',
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: false,
  })
  return label
}

export async function requestOpenNewEditorWindow(): Promise<string | undefined> {
  return await requestOpenEditorWindow()
}

export async function requestFocusEditorWindow(label: string): Promise<void> {
  await showQuickEditorWindow()
  upsertSurfaceInstance({
    id: QUICK_EDITOR_WINDOW_LABEL,
    kind: 'editor',
    windowLabel: QUICK_EDITOR_WINDOW_LABEL,
    title: 'Quick Editor',
    state: 'visible',
    canReceiveText: true,
    canProvideText: true,
    canAttachToEditor: false,
  })
}

export async function requestCloseEditorWindow(label?: string): Promise<void> {
  await closeQuickEditorWindow()
  markSurfaceInstanceState(label ?? QUICK_EDITOR_WINDOW_LABEL, 'destroyed')
}

export async function requestListEditorWindows(): Promise<string[]> {
  return await isQuickEditorWindowOpen() ? [QUICK_EDITOR_WINDOW_LABEL] : []
}
