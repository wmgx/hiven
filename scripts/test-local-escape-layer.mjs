// Production ownership logic with synthetic events, not native IME or layout validation.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/utils/localEscapeLayer.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, { exports })
const { registerLocalEscapeLayer, consumeLocalEscapeLayer } = exports
function fixture() {
  const doc = { activeElement: null, defaultView: { getComputedStyle: (n) => ({ display: n.display ?? 'block', visibility: n.visibility ?? 'visible' }) } }
  function node(parent = null) { return { parentElement: parent, ownerDocument: doc, isConnected: true, rects: true,
    getClientRects() { return this.rects ? [{}] : [] }, getAttribute(key) { return this[key] },
    contains(other) { for (let n = other; n; n = n.parentElement) if (n === this) return true; return false },
  } }
  const scope = node(), trigger = node(scope), popup = node(scope), button = node(popup)
  doc.activeElement = trigger
  let current = true, composing = false, dismissed = 0
  const layer = { trigger, popup, isCurrent: () => current, isComposing: () => composing, dismiss: () => dismissed++ }
  const stop = registerLocalEscapeLayer(layer)
  const event = (flags = {}) => ({ key: 'Escape', target: doc.activeElement, defaultPrevented: false, stopped: false,
    preventDefault() { this.defaultPrevented = true }, stopPropagation() { this.stopped = true }, ...flags })
  return { doc, scope, trigger, popup, button, node, layer, stop, event, get dismissed() { return dismissed }, stale: () => { current = false }, compose: () => { composing = true } }
}
{
  const f = fixture(), e = f.event(); assert.equal(consumeLocalEscapeLayer(e, f.scope), true)
  assert.equal(e.defaultPrevented, true); assert.equal(e.stopped, true); assert.equal(f.dismissed, 1)
  assert.equal(consumeLocalEscapeLayer(f.event(), f.scope), false, 'next Escape belongs to host')
}
for (const kind of ['stale', 'hidden', 'inert', 'aria-hidden', 'detached', 'no-rect', 'visibility', 'outside', 'wrong-target', 'unmount']) {
  const f = fixture(); const e = f.event()
  if (kind === 'stale') f.stale()
  if (kind === 'hidden') f.scope.hidden = true
  if (kind === 'inert') f.popup.inert = true
  if (kind === 'aria-hidden') f.popup['aria-hidden'] = 'true'
  if (kind === 'detached') f.popup.isConnected = false
  if (kind === 'no-rect') f.popup.rects = false
  if (kind === 'visibility') f.scope.visibility = 'hidden'
  if (kind === 'outside') f.popup.parentElement = null
  if (kind === 'wrong-target') e.target = f.button
  if (kind === 'unmount') f.stop()
  assert.equal(consumeLocalEscapeLayer(e, f.scope), false, kind); assert.equal(f.dismissed, 0); assert.equal(e.defaultPrevented, false)
  f.stop()
}
{
  const f = fixture(); f.doc.activeElement = f.button
  assert.equal(consumeLocalEscapeLayer(f.event(), f.scope), true, 'focused child of popup may dismiss')
}
{
  const f = fixture(); let replacement = 0
  const stopNew = registerLocalEscapeLayer({ ...f.layer, dismiss: () => replacement++ })
  f.stop(); assert.equal(consumeLocalEscapeLayer(f.event(), f.scope), true)
  assert.equal(replacement, 1, 'late old cleanup cannot unregister replacement'); stopNew()
}
for (const mode of ['tracked', 'native', '229']) {
  const f = fixture(); if (mode === 'tracked') f.compose()
  const e = f.event(mode === 'native' ? { isComposing: true } : mode === '229' ? { keyCode: 229 } : {})
  assert.equal(consumeLocalEscapeLayer(e, f.scope), true, mode)
  assert.equal(f.dismissed, 0); assert.equal(e.defaultPrevented, false, 'IME gets Escape unchanged'); assert.equal(e.stopped, false)
  f.stop()
}
console.log('Local Escape ownership lifecycle passed (synthetic events only)')
