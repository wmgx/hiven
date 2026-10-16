import type { editor as MonacoEditor, IRange } from 'monaco-editor'
import type { LauncherItem, PluginLauncherApi } from '../launcher/types'
import { filterEditorCommandBarItems } from '../launcher/types'
import { useQuickEditorStore } from './quickEditorStore'

export type QuickEditorCommandTargetMode = 'full-text' | 'selection' | 'multiple-selections' | 'unavailable'

export type QuickEditorCommandOwner = {
  active: boolean
  invalidated: boolean
}

export type QuickEditorCommandTarget = {
  owner: QuickEditorCommandOwner
  paneId: string
  paneIndex: number
  revision: number
  body: string
  mode: QuickEditorCommandTargetMode
  selectionText: string
  selectionRange?: IRange
  cursorRange?: IRange
  editor?: MonacoEditor.IStandaloneCodeEditor
  model?: MonacoEditor.ITextModel
  dispose: () => void
}

export function createQuickEditorCommandOwner(): QuickEditorCommandOwner {
  return { active: true, invalidated: false }
}

function observeTarget(target: Omit<QuickEditorCommandTarget, 'dispose'>): QuickEditorCommandTarget {
  const unsubscribe = useQuickEditorStore.subscribe((state) => {
    const pane = state.panes[target.paneId]
    if (
      state.activePaneId !== target.paneId ||
      !pane ||
      (pane.revision ?? 0) !== target.revision ||
      pane.text !== target.body
    ) {
      target.owner.invalidated = true
    }
  })
  return {
    ...target,
    dispose: () => {
      target.owner.active = false
      unsubscribe()
    },
  }
}

export function captureQuickEditorCommandTarget(
  owner: QuickEditorCommandOwner,
  editor?: MonacoEditor.IStandaloneCodeEditor,
  expectedPaneId?: string,
): QuickEditorCommandTarget {
  const state = useQuickEditorStore.getState()
  const paneId = state.activePaneId
  const pane = state.panes[paneId]
  const paneIndex = state.paneOrder.indexOf(paneId)
  const body = pane?.text ?? state.text
  const revision = pane?.revision ?? 0
  const model = expectedPaneId === paneId ? editor?.getModel() ?? undefined : undefined
  const selections = model ? editor?.getSelections() ?? [] : []
  const primary = selections[0]
  const cursorRange = primary ? {
    startLineNumber: primary.positionLineNumber,
    startColumn: primary.positionColumn,
    endLineNumber: primary.positionLineNumber,
    endColumn: primary.positionColumn,
  } : undefined

  if (expectedPaneId !== undefined && (!editor || expectedPaneId !== paneId || !model)) {
    return observeTarget({
      owner, paneId, paneIndex, revision, body,
      mode: 'unavailable', selectionText: '', cursorRange, editor, model,
    })
  }

  if (selections.length > 1) {
    return observeTarget({
      owner, paneId, paneIndex, revision, body,
      mode: 'multiple-selections', selectionText: '', cursorRange, editor, model,
    })
  }

  if (model && primary && !primary.isEmpty()) {
    const selectionRange: IRange = {
      startLineNumber: primary.startLineNumber,
      startColumn: primary.startColumn,
      endLineNumber: primary.endLineNumber,
      endColumn: primary.endColumn,
    }
    return observeTarget({
      owner, paneId, paneIndex, revision, body,
      mode: 'selection',
      selectionText: model.getValueInRange(selectionRange),
      selectionRange,
      cursorRange,
      editor,
      model,
    })
  }

  return observeTarget({
    owner, paneId, paneIndex, revision, body,
    mode: 'full-text', selectionText: '', cursorRange, editor, model,
  })
}

export function isLocalPureTextAction(item: LauncherItem): boolean {
  return item.kind === 'plugin' &&
    item.source === 'builtin' &&
    item.inputPolicy !== undefined &&
    item.actionPolicy?.effect === 'pure'
}

export function filterQuickEditorCommandItems(
  items: LauncherItem[],
  target: QuickEditorCommandTarget,
): LauncherItem[] {
  const editorItems = filterEditorCommandBarItems(items)
  if (target.mode === 'unavailable') return []
  return target.mode === 'full-text'
    ? editorItems
    : editorItems.filter(isLocalPureTextAction)
}

export function disableForMultipleSelections(
  item: LauncherItem,
  target: QuickEditorCommandTarget,
  message: string,
): LauncherItem {
  if (target.mode !== 'multiple-selections') return item
  return {
    ...item,
    disabledReason: {
      code: 'quick-editor-multiple-selections',
      message,
    },
  }
}

function assertTargetCurrent(target: QuickEditorCommandTarget, changedMessage: string): void {
  const state = useQuickEditorStore.getState()
  const pane = state.panes[target.paneId]
  if (
    !target.owner.active ||
    target.owner.invalidated ||
    state.activePaneId !== target.paneId ||
    !pane ||
    (pane.revision ?? 0) !== target.revision ||
    pane.text !== target.body ||
    (target.model && (target.model.isDisposed() || target.editor?.getModel() !== target.model || target.model.getValue() !== target.body))
  ) {
    throw new Error(changedMessage)
  }
}

export function replaceQuickEditorCommandTarget(
  target: QuickEditorCommandTarget,
  replacement: string,
  changedMessage: string,
  multipleMessage: string,
): void {
  if (target.mode === 'multiple-selections') throw new Error(multipleMessage)
  if (target.mode === 'unavailable') throw new Error(changedMessage)
  assertTargetCurrent(target, changedMessage)

  if (target.editor && target.model) {
    const range = target.mode === 'selection'
      ? target.selectionRange
      : target.model.getFullModelRange()
    if (!range) throw new Error(changedMessage)
    target.editor.pushUndoStop()
    const applied = target.editor.executeEdits('quick-editor-command', [{ range, text: replacement }])
    target.editor.pushUndoStop()
    if (!applied) throw new Error(changedMessage)
    return
  }

  // Loading fallback: the frozen store body is still guarded, but Monaco is not
  // available to own an undo unit yet.
  if (!useQuickEditorStore.getState().setPaneText(target.paneId, replacement)) {
    throw new Error(changedMessage)
  }
}

export function insertIntoQuickEditorCommandTarget(
  target: QuickEditorCommandTarget,
  text: string,
  changedMessage: string,
  multipleMessage: string,
): void {
  if (target.mode === 'selection') {
    replaceQuickEditorCommandTarget(target, text, changedMessage, multipleMessage)
    return
  }
  if (target.mode === 'multiple-selections') throw new Error(multipleMessage)
  if (target.mode === 'unavailable') throw new Error(changedMessage)
  assertTargetCurrent(target, changedMessage)
  if (target.editor && target.model && target.cursorRange) {
    target.editor.pushUndoStop()
    const applied = target.editor.executeEdits('quick-editor-command-insert', [{ range: target.cursorRange, text }])
    target.editor.pushUndoStop()
    if (!applied) throw new Error(changedMessage)
    return
  }
  throw new Error(changedMessage)
}

export function quickEditorCommandApiText(target: QuickEditorCommandTarget): Pick<PluginLauncherApi, 'getActiveText' | 'getSelectionText'> {
  if (target.mode === 'multiple-selections' || target.mode === 'unavailable') {
    return { getActiveText: () => '', getSelectionText: () => '' }
  }
  return {
    getActiveText: () => target.body,
    getSelectionText: () => target.selectionText,
  }
}
