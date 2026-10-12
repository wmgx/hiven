// Synthetic events and clocks only; this is not physical/native IME validation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const tree = (path) => ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
function find(node, predicate) { if (predicate(node)) return node; let hit; ts.forEachChild(node, (child) => { if (!hit) hit = find(child, predicate) }); return hit }
function evaluate(source, context) { return vm.runInNewContext(ts.transpileModule(`(${source})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context) }
let now = 1000
const helpers = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/utils/imeKeyboard.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports: helpers, performance: { now: () => now } })
const ui = tree('src/plugin-ui.tsx')
const hookSource = find(ui, (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'useImeKeyboard').getText(ui).replace(/^export\s+/, '')
function hook() {
  const scheduled = []
  const ime = evaluate(hookSource, { ...helpers, useRef: (current) => ({ current }), window: { setTimeout: (callback) => scheduled.push(callback) } })()
  return { ime, flush: () => { for (const callback of scheduled.splice(0)) callback() } }
}
const aliasTree = tree('src/components/PluginSettingsSchemaRenderer.tsx')
const alias = find(aliasTree, (n) => ts.isFunctionDeclaration(n) && n.name?.text === 'commitAliasInput').getText(aliasTree)
const csvTree = tree('src/plugins/csv/CsvSurface.tsx')
const csv = find(csvTree, (n) => ts.isArrowFunction(n) && n.body.getText(csvTree).includes('if (!sqlSuggestOpen || sqlCompletions.items.length === 0) return')).getText(csvTree)
const historyTree = tree('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx')
const history = find(historyTree, (n) => ts.isVariableDeclaration(n) && n.name.getText(historyTree) === 'handleKeyDown').initializer.arguments[0].getText(historyTree)
const overlay = tree('src/components/quickEditor/QuickEditorCommandOverlay.tsx')
const wrapper = find(overlay, (n) => ts.isVariableDeclaration(n) && n.name.getText(overlay) === 'synthetic').initializer.getText(overlay)
const event = (extra = {}) => ({ key: 'Enter', keyCode: 13, nativeEvent: {}, currentTarget: { value: '合成别名' }, target: null, prevented: false, preventDefault() { this.prevented = true }, stopPropagation() {}, ...extra })
for (const mode of ['native', 'react', '229', 'tracked', 'commit', 'plain']) {
  helpers.resetImeCompositionGuardForTests(); now += 1000
  const { ime, flush } = hook()
  if (mode === 'tracked') ime.onCompositionStart()
  if (mode === 'commit') { ime.onCompositionStart(); ime.onCompositionEnd(); flush() }
  const flags = mode === 'native' ? { nativeEvent: { isComposing: true } } : mode === 'react' ? { isComposing: true } : mode === '229' ? { nativeEvent: { keyCode: 229 } } : {}
  let changes = 0, completions = 0, pastes = 0
  const aliasHandler = evaluate(alias, { aliasIme: ime, value: [], onChange: () => changes++ })
  const csvHandler = evaluate(csv, { sqlIme: ime, sqlSuggestOpen: true, sqlCompletions: { items: [{ insertText: 'SELECT ' }] }, sqlSuggestIndex: 0, applySqlCompletion: () => completions++, setSqlSuggestIndex() {}, setSqlSuggestOpen() {} })
  const historyHandler = evaluate(history, { titleDialog: null, legacyDialog: null, textEdit: null, combining: false, Element: class {}, document: { activeElement: null }, filter: 'all', selectedItem: { kind: 'text' }, loading: false, imeKeyDown: ime, readClipboardHistoryShortcutFocus: () => ({ nativeButton: false }), getClipboardHistoryShortcuts: () => ({ paste: true }), handlePaste: () => pastes++ })
  for (const handler of [aliasHandler, csvHandler, historyHandler]) {
    const e = event(flags); handler(e)
    assert.equal(e.prevented, mode === 'plain', `${mode}: preventDefault only after IME guard`)
    if (handler === aliasHandler) assert.equal(e.currentTarget.value, mode === 'plain' ? '' : '合成别名')
  }
  assert.deepEqual([changes, completions, pastes], mode === 'plain' ? [1, 1, 1] : [0, 0, 0])
  if (mode === 'commit') {
    now += 121
    for (const handler of [aliasHandler, csvHandler, historyHandler]) handler(event())
    assert.deepEqual([changes, completions, pastes], [1, 1, 1], 'ordinary second Enter after guard window works')
  }
}
for (const flags of [{ isComposing: true, keyCode: 13 }, { isComposing: false, keyCode: 229 }]) {
  const native = event(flags), wrapped = evaluate(wrapper, { event: native })
  assert.equal(wrapped.nativeEvent, native)
  assert.equal(helpers.shouldIgnoreImeKeyDown(wrapped, { current: false }), true, 'QuickEditor wrapper preserves native IME flags')
}
{
  helpers.resetImeCompositionGuardForTests(); now += 1000
  const { ime, flush } = hook()
  ime.onCompositionStart(); ime.onCompositionEnd(); ime.onCompositionStart(); flush()
  assert.equal(ime.isImeComposingRef.current, true, 'late cleanup cannot clear a new composition')
  ime.onBlur(); now += 121
  assert.equal(ime.shouldIgnoreKeyDown(event()), false, 'blur clears cancelled/stuck composition')
  ime.onCompositionStart(); ime.onCompositionEnd(); ime.onBlur(); ime.onCompositionStart(); flush()
  assert.equal(ime.shouldIgnoreKeyDown(event()), true, 'blur and new composition supersede old cleanup')
  ime.onCompositionEnd(); flush(); now += 121
  assert.equal(ime.shouldIgnoreKeyDown(event()), false, 'new composition can finish normally')
  ime.onCompositionStart()
  assert.equal(ime.shouldIgnoreKeyDown(event({ key: 'Escape' })), false, 'composition never traps dismissal')
  ime.onBlur(); now += 121
  assert.equal(ime.shouldIgnoreKeyDown(event()), false)
}
{
  helpers.resetImeCompositionGuardForTests(); now += 1000
  const { ime } = hook(); let edits = 0, completions = 0, moved = 0, closed = 0
  const aliasHandler = evaluate(alias, { aliasIme: ime, value: ['kept'], onChange: () => edits++ })
  const csvHandler = evaluate(csv, { sqlIme: ime, sqlSuggestOpen: true, sqlCompletions: { items: [{}] }, sqlSuggestIndex: 0, applySqlCompletion: () => completions++, setSqlSuggestIndex: () => moved++, setSqlSuggestOpen: () => closed++ })
  ime.onCompositionStart()
  const back = event({ key: 'Backspace', currentTarget: { value: '' } }); aliasHandler(back)
  for (const key of ['Tab', 'ArrowDown', 'ArrowUp']) csvHandler(event({ key }))
  assert.deepEqual([edits, completions, moved], [0, 0, 0])
  assert.equal(back.prevented, false)
  csvHandler(event({ key: 'Escape' })); assert.equal(closed, 1)
  ime.onBlur(); now += 121
  aliasHandler(event({ key: 'Backspace', currentTarget: { value: '' } }))
  csvHandler(event({ key: 'Tab' })); csvHandler(event({ key: 'ArrowDown' }))
  assert.deepEqual([edits, completions, moved], [1, 1, 1], 'ordinary controls work after cancellation/blur')
}
console.log('Synthetic IME production-handler and hook lifecycle checks passed (not native IME validation)')
