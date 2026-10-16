#!/usr/bin/env node

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const initialPaneId = 'quick-pane-1'
const listeners = new Set()
let state

function publish(patch) {
  state = { ...state, ...patch }
  for (const listener of listeners) listener(state)
}

function resetStore() {
  const pane = { id: initialPaneId, text: '', revision: 0 }
  state = {
    panes: { [initialPaneId]: pane },
    paneOrder: [initialPaneId],
    activePaneId: initialPaneId,
    text: '',
    setText(text) {
      const current = state.panes[state.activePaneId]
      const next = { ...current, text, revision: (current.revision ?? 0) + 1 }
      publish({ panes: { ...state.panes, [next.id]: next }, text })
    },
    setPaneText(paneId, text) {
      const current = state.panes[paneId]
      if (!current) return false
      const next = { ...current, text, revision: (current.revision ?? 0) + 1 }
      publish({
        panes: { ...state.panes, [paneId]: next },
        ...(state.activePaneId === paneId ? { text } : {}),
      })
      return true
    },
    createPane({ text = '' } = {}) {
      const id = `quick-pane-${state.paneOrder.length + 1}`
      const pane = { id, text, revision: 0 }
      publish({
        panes: { ...state.panes, [id]: pane },
        paneOrder: [...state.paneOrder, id],
        activePaneId: id,
        text,
      })
      return id
    },
    setActivePaneId(paneId) {
      const pane = state.panes[paneId]
      if (pane) publish({ activePaneId: paneId, text: pane.text })
    },
  }
}

resetStore()
const useQuickEditorStore = {
  getState: () => state,
  subscribe(listener) {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
}

const source = readFileSync('src/workspace/quickEditor/quickEditorCommandTarget.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, {
  module,
  exports: module.exports,
  require(specifier) {
    if (specifier === './quickEditorStore') return { useQuickEditorStore }
    if (specifier === '../launcher/types') {
      return { filterEditorCommandBarItems: (items) => items.filter((item) => !item.systemKey.startsWith('plugin-settings:')) }
    }
    throw new Error(`Unexpected test import: ${specifier}`)
  },
})
const {
  captureQuickEditorCommandTarget,
  createQuickEditorCommandOwner,
  filterQuickEditorCommandItems,
  quickEditorCommandApiText,
  replaceQuickEditorCommandTarget,
} = module.exports

function offsetAt(text, lineNumber, column) {
  const lineStarts = [0]
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\n') lineStarts.push(index + 1)
  }
  return (lineStarts[lineNumber - 1] ?? text.length) + column - 1
}

function endPosition(text) {
  const lines = text.split('\n')
  return { lineNumber: lines.length, column: (lines.at(-1)?.length ?? 0) + 1 }
}

function fakeSelection(range, reverse = false) {
  return {
    ...range,
    positionLineNumber: reverse ? range.startLineNumber : range.endLineNumber,
    positionColumn: reverse ? range.startColumn : range.endColumn,
    isEmpty: () => range.startLineNumber === range.endLineNumber && range.startColumn === range.endColumn,
  }
}

function fakeEditor(initialText, selections) {
  let value = initialText
  const operations = []
  let operationIndex = 0
  let undoStops = 0
  const model = {
    getValue: () => value,
    isDisposed: () => false,
    getValueInRange: (range) => value.slice(
      offsetAt(value, range.startLineNumber, range.startColumn),
      offsetAt(value, range.endLineNumber, range.endColumn),
    ),
    getFullModelRange: () => {
      const end = endPosition(value)
      return { startLineNumber: 1, startColumn: 1, endLineNumber: end.lineNumber, endColumn: end.column }
    },
  }
  return {
    getModel: () => model,
    getSelections: () => selections,
    pushUndoStop: () => { undoStops += 1; return true },
    executeEdits: (_source, edits) => {
      assert.equal(edits.length, 1)
      const { range, text } = edits[0]
      const before = value
      const start = offsetAt(value, range.startLineNumber, range.startColumn)
      const end = offsetAt(value, range.endLineNumber, range.endColumn)
      value = `${value.slice(0, start)}${text}${value.slice(end)}`
      operations.splice(operationIndex)
      operations.push({ before, after: value })
      operationIndex += 1
      state.setText(value)
      return true
    },
    undo: () => {
      if (operationIndex === 0) return
      operationIndex -= 1
      value = operations[operationIndex].before
      state.setText(value)
    },
    redo: () => {
      if (operationIndex >= operations.length) return
      value = operations[operationIndex].after
      operationIndex += 1
      state.setText(value)
    },
    value: () => value,
    undoStops: () => undoStops,
    operationCount: () => operations.length,
  }
}

function resetWithText(text) {
  resetStore()
  state.setText(text)
  return state.activePaneId
}

// Reverse selection + Unicode prefix + CRLF: only the frozen JSON range changes.
const json = '{"b":2,"a":"雪"}'
const body = `前🙂\r\nprefix ${json} suffix\r\n尾`
const range = {
  startLineNumber: 2,
  startColumn: 'prefix '.length + 1,
  endLineNumber: 2,
  endColumn: 'prefix '.length + json.length + 1,
}
const paneId = resetWithText(body)
const selectionEditor = fakeEditor(body, [fakeSelection(range, true)])
const selectionTarget = captureQuickEditorCommandTarget(createQuickEditorCommandOwner(), selectionEditor, paneId)
assert.equal(selectionTarget.mode, 'selection')
assert.equal(selectionTarget.selectionText, json)
assert.equal(quickEditorCommandApiText(selectionTarget).getActiveText(), body)
assert.equal(quickEditorCommandApiText(selectionTarget).getSelectionText(), json)

const pretty = JSON.stringify(JSON.parse(json), null, 2)
const selectionStart = offsetAt(body, range.startLineNumber, range.startColumn)
const selectionEnd = offsetAt(body, range.endLineNumber, range.endColumn)
const expected = `${body.slice(0, selectionStart)}${pretty}${body.slice(selectionEnd)}`
replaceQuickEditorCommandTarget(selectionTarget, pretty, 'changed', 'multiple')
assert.equal(selectionEditor.value(), expected)
assert.equal(state.text, expected)
assert.equal(selectionEditor.operationCount(), 1, 'selection replacement is one Monaco edit')
assert.equal(selectionEditor.undoStops(), 2, 'selection replacement is isolated by undo stops')
selectionEditor.undo()
assert.equal(selectionEditor.value(), body)
selectionEditor.redo()
assert.equal(selectionEditor.value(), expected)
selectionTarget.dispose()

// No selection keeps whole-text input/output behavior.
const wholeBody = '{"whole":true}'
const wholePane = resetWithText(wholeBody)
const caret = { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 }
const wholeEditor = fakeEditor(wholeBody, [fakeSelection(caret)])
const wholeTarget = captureQuickEditorCommandTarget(createQuickEditorCommandOwner(), wholeEditor, wholePane)
assert.equal(wholeTarget.mode, 'full-text')
assert.equal(quickEditorCommandApiText(wholeTarget).getSelectionText(), '')
assert.equal(quickEditorCommandApiText(wholeTarget).getActiveText(), wholeBody)
replaceQuickEditorCommandTarget(wholeTarget, 'WHOLE', 'changed', 'multiple')
assert.equal(wholeEditor.value(), 'WHOLE')
wholeTarget.dispose()

// Multiple selections never fall through to the whole document and only local pure text rows survive.
const multiPane = resetWithText('one two')
const first = fakeSelection({ startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 4 })
const second = fakeSelection({ startLineNumber: 1, startColumn: 5, endLineNumber: 1, endColumn: 8 })
const multiEditor = fakeEditor('one two', [first, second])
const multiTarget = captureQuickEditorCommandTarget(createQuickEditorCommandOwner(), multiEditor, multiPane)
assert.equal(multiTarget.mode, 'multiple-selections')
assert.equal(quickEditorCommandApiText(multiTarget).getActiveText(), '')
assert.throws(() => replaceQuickEditorCommandTarget(multiTarget, 'x', 'changed', 'multiple'), /multiple/)
assert.equal(multiEditor.operationCount(), 0)
const pure = { systemKey: 'plugin:pure', kind: 'plugin', source: 'builtin', inputPolicy: { mode: 'auto' }, actionPolicy: { effect: 'pure' } }
const remote = { systemKey: 'plugin:remote', kind: 'plugin', source: 'builtin', inputPolicy: { mode: 'auto' }, actionPolicy: { effect: 'read' } }
const installed = { systemKey: 'plugin:installed', kind: 'plugin', source: 'installed', inputPolicy: { mode: 'auto' }, actionPolicy: { effect: 'pure' } }
assert.deepEqual(filterQuickEditorCommandItems([pure, remote, installed], multiTarget).map((item) => item.systemKey), ['plugin:pure'])
multiTarget.dispose()

// A missing pane-specific editor registration is unavailable, never a whole-document fallback.
const unavailablePane = resetWithText('do not overwrite')
const unavailableTarget = captureQuickEditorCommandTarget(createQuickEditorCommandOwner(), undefined, unavailablePane)
assert.equal(unavailableTarget.mode, 'unavailable')
assert.equal(quickEditorCommandApiText(unavailableTarget).getActiveText(), '')
assert.equal(quickEditorCommandApiText(unavailableTarget).getSelectionText(), '')
assert.equal(filterQuickEditorCommandItems([pure], unavailableTarget).length, 0)
assert.throws(() => replaceQuickEditorCommandTarget(unavailableTarget, 'late', 'changed', 'multiple'), /changed/)
assert.equal(state.text, 'do not overwrite')
unavailableTarget.dispose()

// Any edit or even a transient pane switch permanently invalidates the frozen owner.
const stalePane = resetWithText('stale body')
const staleEditor = fakeEditor('stale body', [fakeSelection(caret)])
const staleTarget = captureQuickEditorCommandTarget(createQuickEditorCommandOwner(), staleEditor, stalePane)
state.setText('new body')
assert.throws(() => replaceQuickEditorCommandTarget(staleTarget, 'late', 'changed', 'multiple'), /changed/)
assert.equal(staleEditor.operationCount(), 0)
staleTarget.dispose()

const switchedPane = resetWithText('switch body')
const switchedEditor = fakeEditor('switch body', [fakeSelection(caret)])
const switchedTarget = captureQuickEditorCommandTarget(createQuickEditorCommandOwner(), switchedEditor, switchedPane)
state.createPane({ text: 'other' })
state.setActivePaneId(switchedPane)
assert.throws(() => replaceQuickEditorCommandTarget(switchedTarget, 'late', 'changed', 'multiple'), /changed/)
assert.equal(switchedEditor.operationCount(), 0)
switchedTarget.dispose()

const imperativeSource = readFileSync('src/components/quickEditor/quickEditorImperative.ts', 'utf8')
const overlaySource = readFileSync('src/components/quickEditor/QuickEditorCommandOverlay.tsx', 'utf8')
assert.match(imperativeSource, /commandTargetHandlers = new Map/)
assert.match(overlaySource, /captureCommandTarget\(owner, paneId\)/)
assert.match(overlaySource, /captureQuickEditorCommandTarget\(owner, undefined, paneId\)/)

console.log('PASS quick editor selection actions: frozen reverse/Unicode/CRLF range, exact prefix/suffix, one edit, undo/redo, whole text, multi-select/unavailable block, pane-specific capture, stale guards')
