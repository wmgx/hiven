import assert from 'node:assert/strict'
import { syncExternalEditorValue } from '../src/kits/editor/syncExternalEditorValue.ts'

type Edit = { text: string }

class FakeModel {
  value: string
  setValues: string[] = []

  constructor(value: string) {
    this.value = value
  }

  getValue() { return this.value }
  getFullModelRange() { return { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: this.value.length + 1 } }
  setValue(value: string) { this.setValues.push(value); this.value = value }
}

class FakeEditor {
  model: FakeModel | null
  calls: string[] = []
  history: string[]
  historyIndex = 0

  constructor(value: string) {
    this.model = new FakeModel(value)
    this.history = [value]
  }

  getModel() { return this.model }

  pushUndoStop() {
    this.calls.push('pushUndoStop')
    if (!this.model) return false
    const value = this.model.value
    if (this.history[this.historyIndex] === value) return false
    this.history.splice(this.historyIndex + 1, Infinity, value)
    this.historyIndex = this.history.length - 1
    return true
  }

  executeEdits(source: string, edits: Edit[]) {
    this.calls.push(`executeEdits:${source}`)
    if (!this.model) return false
    this.model.value = edits[0]?.text ?? this.model.value
    return true
  }

  type(value: string) {
    if (this.model) this.model.value = value
  }

  undo() {
    if (!this.model || this.historyIndex === 0) return false
    this.historyIndex -= 1
    this.model.value = this.history[this.historyIndex]
    return true
  }

  redo() {
    if (!this.model || this.historyIndex >= this.history.length - 1) return false
    this.historyIndex += 1
    this.model.value = this.history[this.historyIndex]
    return true
  }
}

const asEditor = (editor: FakeEditor) => editor as never

{
  const malformed = '{"items":[1,2\n3]}'
  const corrected = '{"items":[1,2,\n3]}'
  const formatted = '{\n  "items": [1, 2, 3]\n}'
  const editor = new FakeEditor(malformed)

  editor.type(corrected)
  assert.equal(syncExternalEditorValue(asEditor(editor), corrected, false), false, 'a local value echo must not add an undo boundary')
  assert.deepEqual(editor.calls, [])

  assert.equal(syncExternalEditorValue(asEditor(editor), formatted, false), true)
  assert.deepEqual(editor.calls, ['pushUndoStop', 'executeEdits:external', 'pushUndoStop'])
  assert.equal(editor.model?.value, formatted)

  assert.equal(editor.undo(), true)
  assert.equal(editor.model?.value, corrected, 'undo one restores the last user-corrected source')
  assert.equal(editor.undo(), true)
  assert.equal(editor.model?.value, malformed, 'undo two restores the syntax error')
  assert.equal(editor.redo(), true)
  assert.equal(editor.model?.value, corrected)
  assert.equal(editor.redo(), true)
  assert.equal(editor.model?.value, formatted)
}

{
  const editor = new FakeEditor('')
  editor.type('a')
  syncExternalEditorValue(asEditor(editor), 'a', false)
  editor.type('ab')
  syncExternalEditorValue(asEditor(editor), 'ab', false)
  editor.type('abc')
  syncExternalEditorValue(asEditor(editor), 'abc', false)
  assert.deepEqual(editor.calls, [], 'controlled echoes must not split continuous user typing')

  syncExternalEditorValue(asEditor(editor), 'external', false)
  editor.undo()
  assert.equal(editor.model?.value, 'abc', 'external replacement remains separate from continuous typing')
}

{
  const editor = new FakeEditor('old output')
  assert.equal(syncExternalEditorValue(asEditor(editor), 'new output', true), true)
  assert.equal(editor.model?.value, 'new output')
  assert.deepEqual(editor.model?.setValues, ['new output'])
  assert.deepEqual(editor.calls, [], 'read-only refresh keeps the existing setValue path')
}

{
  const editor = new FakeEditor('detached')
  editor.model = null
  assert.equal(syncExternalEditorValue(asEditor(editor), 'ignored', false), false)
  assert.deepEqual(editor.calls, [])
}

console.log('editor external value sync passed')
