#!/usr/bin/env node
// Execute the production shortcut policy, focus lifecycle and keyboard handler.
// All actions are spies; this test never reads or deletes real clipboard history.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2022, target: ts.ScriptTarget.ES2023 },
}).outputText
const policy = await import(`data:text/javascript;base64,${Buffer.from(compile(readFileSync('src/plugins/clipboard-history/surfaces/clipboardHistoryShortcuts.ts', 'utf8'))).toString('base64')}`)
const { getClipboardHistoryShortcuts, readClipboardHistoryShortcutFocus, observeClipboardHistoryShortcutFocus } = policy

class Element extends EventTarget {
  constructor(tagName, parentElement = null, classes = []) {
    super()
    Object.assign(this, { tagName, parentElement, classes })
  }
  contains(target) {
    return target === this || Boolean(target?.parentElement && this.contains(target.parentElement))
  }
  closest(selectors) {
    if (selectors.split(',').some((selector) => {
      const value = selector.trim()
      return value.startsWith('.') ? this.classes.includes(value.slice(1)) : this.tagName === value.toUpperCase()
    })) return this
    return this.parentElement?.closest(selectors) ?? null
  }
}

const mutationObservers = new Set()
const ownerWindow = Object.assign(new EventTarget(), {
  MutationObserver: class {
    constructor(callback) { this.callback = callback }
    observe() { mutationObservers.add(this) }
    disconnect() { mutationObservers.delete(this) }
  },
})
const commitDom = () => { for (const observer of mutationObservers) observer.callback() }
const document = Object.assign(new EventTarget(), {
  defaultView: ownerWindow, activeElement: null, visibilityState: 'visible', focused: true,
  hasFocus() { return this.focused },
})
const surface = Object.assign(new Element('DIV'), { ownerDocument: document })
const search = new Element('INPUT', surface)
const select = new Element('SELECT', surface)
const list = new Element('DIV', surface)
const row = new Element('BUTTON', list, ['clipboard-history-item'])
const rowLabel = new Element('SPAN', row)
const settings = new Element('BUTTON', surface)
const settingsIcon = new Element('SVG', settings)
const rowDelete = new Element('BUTTON', list, ['clipboard-history-item-delete'])
const outside = new Element('INPUT')
const none = { paste: false, returnToLauncher: false, delete: false }
const enterOnly = { paste: true, returnToLauncher: true, delete: false }
const all = { paste: true, returnToLauncher: true, delete: true }
const eligibility = (target, options = {}) => getClipboardHistoryShortcuts({
  hasSelection: true, loading: false, enabled: true, blocked: false,
  focus: readClipboardHistoryShortcutFocus(surface, target), ...options,
})

for (const target of [surface, list, row, rowLabel]) assert.deepEqual(eligibility(target), all)
for (const target of [search, select]) assert.deepEqual(eligibility(target), enterOnly)
for (const target of [settings, settingsIcon, rowDelete, outside, null]) assert.deepEqual(eligibility(target), none)
for (const options of [{ hasSelection: false }, { loading: true }, { enabled: false }, { blocked: true }]) {
  assert.deepEqual(eligibility(row, options), none)
}
assert.deepEqual(eligibility(row, {
  focus: readClipboardHistoryShortcutFocus(surface, row, search),
}), enterOnly, 'Delete ownership follows activeElement even when the event target differs')

// Focus changes, external controls in the same webview, window reuse and cleanup.
document.activeElement = search
const changes = []
const stop = observeClipboardHistoryShortcutFocus(surface, (focus) => changes.push(focus))
const currentHints = () => eligibility(null, { focus: changes.at(-1) })
assert.deepEqual(currentHints(), enterOnly, 'initial focus is read without waiting for another focus event')
for (const [target, expected] of [[row, all], [settings, none], [list, all], [select, enterOnly], [outside, none], [rowLabel, all]]) {
  document.dispatchEvent(new Event('focusout'))
  document.activeElement = target
  document.dispatchEvent(new Event('focusin'))
  await Promise.resolve()
  assert.deepEqual(currentHints(), expected)
}
document.dispatchEvent(new Event('focusout'))
document.activeElement = null
await Promise.resolve()
assert.deepEqual(currentHints(), none, 'focusout reads the final activeElement after the event')
document.activeElement = row
ownerWindow.dispatchEvent(new Event('focus'))
assert.deepEqual(currentHints(), all)
ownerWindow.dispatchEvent(new Event('blur'))
assert.deepEqual(currentHints(), none, 'retained activeElement cannot advertise shortcuts in a blurred window')
document.activeElement = search
ownerWindow.dispatchEvent(new Event('focus'))
assert.deepEqual(currentHints(), enterOnly, 'window focus restores the current target, not a stale row')
document.visibilityState = 'hidden'
document.dispatchEvent(new Event('visibilitychange'))
assert.deepEqual(currentHints(), none)
document.activeElement = row
document.visibilityState = 'visible'
document.dispatchEvent(new Event('visibilitychange'))
assert.deepEqual(currentHints(), all)
ownerWindow.dispatchEvent(new Event('pagehide'))
document.dispatchEvent(new Event('focusin'))
assert.deepEqual(currentHints(), none, 'a hidden page stays inactive even if focusin fires')
ownerWindow.dispatchEvent(new Event('pageshow'))
assert.deepEqual(currentHints(), all)
document.activeElement = outside
commitDom()
assert.deepEqual(currentHints(), none, 'removing a focused row is reconciled even without focusout')
document.activeElement = row
commitDom()
assert.deepEqual(currentHints(), all)
const beforeUnchangedFocus = changes.length
document.dispatchEvent(new Event('focusin'))
assert.equal(changes.length, beforeUnchangedFocus, 'equivalent focus does not trigger redundant updates')
document.dispatchEvent(new Event('focusout'))
stop()
document.activeElement = outside
await Promise.resolve()
ownerWindow.dispatchEvent(new Event('blur'))
ownerWindow.dispatchEvent(new Event('focus'))
document.dispatchEvent(new Event('focusin'))
commitDom()
assert.equal(changes.length, beforeUnchangedFocus, 'unmount removes listeners and ignores queued focusout work')
assert.equal(mutationObservers.size, 0, 'unmount disconnects local DOM observation')
let remountedFocus
const stopRemount = observeClipboardHistoryShortcutFocus(surface, (focus) => { remountedFocus = focus })
assert.deepEqual(eligibility(null, { focus: remountedFocus }), none, 'remount reads current external focus')
stopRemount()

// Extract the real callback through the TypeScript AST, not a reimplemented handler.
const surfaceSource = ts.createSourceFile('ClipboardHistorySurface.tsx', readFileSync('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback
const visit = (node) => {
  if (ts.isVariableDeclaration(node) && node.name.getText(surfaceSource) === 'handleKeyDown') callback = node.initializer.arguments[0]
  ts.forEachChild(node, visit)
}
visit(surfaceSource)
assert.ok(callback, 'production handler must exist')
const handlerCode = compile(`const handler = ${callback.getText(surfaceSource)}`)
function dispatch(key, target, options = {}) {
  const calls = []
  document.activeElement = options.activeElement ?? target
  const selectedItem = { id: 'selected' }
  const context = {
    ...policy, Element, HTMLElement: Element, document,
    titleDialog: null, combining: false, loading: false, settings: { enabled: true },
    selectedItem, selectedId: 'selected', filteredItems: [selectedItem], flatRows: [],
    imeKeyDown: { shouldIgnoreKeyDown: () => false },
    handlePaste: () => calls.push('paste'), handleReturnToLauncher: () => calls.push('return'),
    handleDelete: () => calls.push('delete'), handleCopy: () => calls.push('copy'),
    cancelMerge: () => calls.push('cancel-merge'), toggleMergeItem: () => calls.push('toggle-merge'),
    readDomSelectedText: () => '', setSelectedId: () => calls.push('selection'),
    virtualizer: { scrollToIndex() {} }, host: {}, t: (value) => value,
    ...options.context,
  }
  const handler = new Function(...Object.keys(context), `${handlerCode}\nreturn handler`)(...Object.values(context))
  const event = {
    key, target, currentTarget: surface, defaultPrevented: false,
    metaKey: false, ctrlKey: false, altKey: false,
    preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true },
    ...options.event,
  }
  handler(event)
  return { calls, prevented: event.defaultPrevented, stopped: event.stopped ?? false }
}
const untouched = { calls: [], prevented: false, stopped: false }
for (const target of [search, select, row, rowLabel, list, surface]) {
  assert.deepEqual(dispatch('Enter', target), { calls: ['paste'], prevented: true, stopped: false })
  for (const modifier of ['metaKey', 'ctrlKey']) {
    assert.deepEqual(dispatch('Enter', target, { event: { [modifier]: true } }), { calls: ['return'], prevented: true, stopped: false })
  }
}
for (const target of [settings, settingsIcon, rowDelete]) {
  for (const key of ['Enter', 'Delete', 'Backspace', 'ArrowDown', 'c']) assert.deepEqual(dispatch(key, target), untouched)
}
for (const target of [search, select]) {
  for (const key of ['Delete', 'Backspace']) assert.deepEqual(dispatch(key, target), untouched, 'editing keys stay native')
}
for (const target of [row, list, surface]) {
  for (const key of ['Delete', 'Backspace']) assert.deepEqual(dispatch(key, target), { calls: ['delete'], prevented: true, stopped: false })
}
assert.deepEqual(dispatch('Delete', row, { activeElement: search }), untouched)
for (const context of [{ selectedItem: null }, { loading: true }, { settings: { enabled: false } }, { titleDialog: {} }]) {
  for (const key of ['Enter', 'Delete', 'Backspace']) assert.deepEqual(dispatch(key, row, { context }), untouched)
  assert.deepEqual(dispatch('Enter', row, { context, event: { ctrlKey: true } }), untouched)
}
for (const event of [{}, { ctrlKey: true }]) {
  assert.deepEqual(dispatch('Enter', search, { event, context: { imeKeyDown: { shouldIgnoreKeyDown: () => true } } }), untouched, 'IME commit keeps its existing guard')
}
assert.deepEqual(dispatch('Enter', search, { event: { defaultPrevented: true } }).calls, [])
assert.deepEqual(dispatch('a', search), untouched, 'ordinary input characters are unaffected')
assert.deepEqual(dispatch('c', row, { event: { ctrlKey: true } }).calls, ['copy'], 'copy behavior is unchanged')
assert.deepEqual(dispatch('Enter', search, { context: { combining: true } }), { calls: ['toggle-merge'], prevented: true, stopped: true })
assert.deepEqual(dispatch('Delete', row, { context: { combining: true } }), untouched)
assert.deepEqual(dispatch('Escape', search, { context: { combining: true } }), { calls: ['cancel-merge'], prevented: true, stopped: true })

console.log('✓ Clipboard history shortcut eligibility, focus lifecycle and production handler passed')
