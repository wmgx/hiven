#!/usr/bin/env node
// Production panel callbacks with synthetic images/host I/O; no desktop or network.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const jsx = (type, props) => ({ type, props })
const slots = []; let cursor = 0; let effects = []; let tree
const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
const react = {
  useState(initial) { const i = cursor++; slots[i] ??= { value: typeof initial === 'function' ? initial() : initial }; return [slots[i].value, (value) => { slots[i].value = typeof value === 'function' ? value(slots[i].value) : value }] },
  useRef(value) { const i = cursor++; slots[i] ??= { current: value }; return slots[i] },
  useLayoutEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) effects.push(() => { slots[i]?.cleanup?.(); slots[i] = { deps, cleanup: fn() } }) },
}
let current = true; let invalidation; let read = async () => ({ bytes: new Uint8Array([1]), contentType: 'image/png' })
const calls = { uri: [], image: [], save: [], screenshot: [] }; let screenshotResult = { status: 'saved', pathCopied: true };
const dirty = []; const invalidateRef = { current: null }
const props = { active: true, saveFocused: false, initialText: '', surfaceId: 'image-base64', t: (key) => key,
  invalidateRef, onDirtyChange: (value) => dirty.push(value), onShowWorkbench() {}, host: {
    deliveryFeedbackOwner: { isCurrent: () => current, subscribeInvalidation(fn) { invalidation = fn; return () => {} } },
    clipboard: { readImage: (...args) => read(...args), writeText: async (value) => calls.uri.push(value), writeImage: async (id) => calls.image.push(id) },
    storage: { blob: { put: async ({ bytes }) => ({ blobId: `blob:${bytes[0]}` }), delete: async () => {}, savePng: async (id) => { calls.save.push(id); return { status: 'saved' } } } },
  } }
const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/plugins/encode-decode/ImageBase64Panel.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, AbortController, Uint8Array, require(name) {
  if (name === 'react') return react
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === '@hiven/plugin-ui') return { Button: 'Button' }
  if (name === './saveClipboardPng') return { async saveClipboardPng(_storage, bytes, isCurrent) { assert.equal(isCurrent(), true); calls.screenshot.push(bytes[0]); return screenshotResult } }
  if (name === './imageBase64') return { MAX_IMAGE_BYTES: 100, inspectRaster: (bytes) => { if (bytes[0] === 0) throw Error('invalid image'); return { mime: 'image/png', width: 1, height: 1 } }, parseImageBase64: (text) => { if (text !== 'valid') throw Error('invalid base64'); return { bytes: new Uint8Array([9]), info: { mime: 'image/png' } } },
    decodeRaster: async (bytes) => ({ preview: `preview:${bytes[0]}`, png: bytes }), imageDataUri: (bytes) => `data:${bytes[0]}` }
  throw Error(name)
} })
function render() { cursor = 0; effects = []; tree = exports.ImageBase64Panel(props); for (const effect of effects) effect(); return tree }
function nodes(node) { if (!node || typeof node !== 'object') return []; if (Array.isArray(node)) return node.flatMap(nodes); return [node, ...nodes(node.props?.children)] }
const button = (key) => nodes(tree).find((n) => n.type === 'Button' && n.props.children === key)
const input = () => nodes(tree).find((n) => n.type === 'textarea' && !n.props.readOnly)
const output = () => nodes(tree).find((n) => n.type === 'textarea' && n.props.readOnly)
const settle = () => new Promise((resolve) => setImmediate(resolve))
render()
button('image.readClipboard').props.onClick(); await settle(); render()
assert.equal(output().props.value, 'data:1')
invalidateRef.current(); props.active = false; render()
assert.equal(tree.props.hidden, true)
props.active = true; render()
assert.equal(output().props.value, 'data:1', 'completed image survives tab navigation')
input().props.onChange({ currentTarget: { value: 'synthetic base64 draft' } }); render()
assert.equal(dirty.at(-1), true)
invalidateRef.current(); props.active = false; render(); props.active = true; render()
assert.equal(input().props.value, 'synthetic base64 draft', 'draft survives tab navigation')
let release; read = () => new Promise((resolve) => { release = resolve })
button('image.readClipboard').props.onClick(); render()
invalidateRef.current(); props.active = false; render()
release({ bytes: new Uint8Array([2]), contentType: 'image/png' }); await settle()
props.active = true; render()
assert.equal(output(), undefined, 'late hidden-tab read cannot publish a result')
assert.equal(input().props.value, 'synthetic base64 draft')
read = async () => ({ bytes: new Uint8Array([3]), contentType: 'image/png' })
button('image.readClipboard').props.onClick(); await settle(); render()
assert.equal(output().props.value, 'data:3', 'retry succeeds after cancellation settles')
read = () => new Promise((resolve) => { release = resolve })
button('image.readClipboard').props.onClick(); current = false; invalidation()
release({ bytes: new Uint8Array([4]), contentType: 'image/png' }); await settle(); render()
assert.equal(output().props.value, 'data:3', 'revoked owner cannot overwrite retained preview')
current = true
read = async () => ({ bytes: new Uint8Array([5]), contentType: 'image/png' })
button('image.readClipboard').props.onClick(); await settle(); render()
assert.equal(output().props.value, 'data:5', 'restored owner can retry after old work settles')
const deliveryKeys = ['image.copyUri', 'image.copyImage', 'image.save']
const eligibility = (enabled) => { for (const key of deliveryKeys) assert.equal(button(key).props.disabled, !enabled, key) }
const deliveries = () => calls.uri.length + calls.image.length + calls.save.length
const fileInput = () => nodes(tree).find((n) => n.type === 'input' && n.props.type === 'file')
eligibility(true)
const oldDeliveryCallbacks = deliveryKeys.map((key) => button(key).props.onClick)
// Picking no file is cancellation, not a new load attempt.
fileInput().props.onChange({ currentTarget: { files: [], value: 'old' } }); render(); eligibility(true)
let rejectRead
read = () => new Promise((_resolve, reject) => { rejectRead = reject })
button('image.readClipboard').props.onClick(); render(); eligibility(false)
assert.equal(output().props.value, 'data:5')
for (const callback of oldDeliveryCallbacks) callback()
await settle(); assert.equal(deliveries(), 0, 'retained callbacks cannot deliver during replacement load')
rejectRead(Error('synthetic clipboard failure')); await settle(); render(); eligibility(false)
assert.equal(output().props.value, 'data:5', 'failed load preserves clearly ineligible preview')
for (const callback of oldDeliveryCallbacks) callback()
await settle(); assert.equal(deliveries(), 0, 'failed replacement cannot expose old image delivery')
// Tab/owner changes never make a failed preview eligible again.
invalidateRef.current(); props.active = false; render(); props.active = true; render(); eligibility(false)
current = false; invalidation(); current = true; render(); eligibility(false)
// Selected invalid/oversize files also revoke the old result; blank file picker does not restore it.
for (const selected of [
  { size: 1, type: 'image/png', arrayBuffer: async () => new Uint8Array([0]).buffer },
  { size: 101, type: 'image/png', arrayBuffer: async () => { throw Error('oversize must not read') } },
]) {
  fileInput().props.onChange({ currentTarget: { files: [selected], value: 'synthetic' } }); await settle(); render(); eligibility(false)
  assert.equal(output().props.value, 'data:5')
}
fileInput().props.onChange({ currentTarget: { files: [], value: '' } }); render(); eligibility(false)
// A successful new image, not reopening or a late old callback, restores eligibility.
read = async () => ({ bytes: new Uint8Array([6]), contentType: 'image/png' })
button('image.readClipboard').props.onClick(); await settle(); render(); eligibility(true)
for (const callback of oldDeliveryCallbacks) callback()
await settle(); assert.equal(deliveries(), 0, 'old success callbacks cannot deliver after replacement success')
for (const key of deliveryKeys) { button(key).props.onClick(); await settle(); render() }
assert.deepEqual(calls.uri, ['data:6']); assert.deepEqual(calls.image, ['blob:6']); assert.deepEqual(calls.save, ['blob:6'])
// A new pending read revoked by an owner must not restore the prior preview's eligibility.
read = () => new Promise((resolve) => { release = resolve })
button('image.readClipboard').props.onClick(); render(); current = false; invalidation()
release({ bytes: new Uint8Array([7]), contentType: 'image/png' }); await settle(); current = true; render(); eligibility(false)
assert.equal(output().props.value, 'data:6')
// Dedicated screenshot saving operates on its own freshly read image, even with ineligible preview.
props.saveFocused = true; render()
read = async () => ({ bytes: new Uint8Array([8]), contentType: 'image/png' })
button('image.saveClipboard').props.onClick(); await settle(); render()
assert.deepEqual(calls.screenshot, [8])
props.saveFocused = false; render(); eligibility(false)
assert.equal(output().props.value, 'data:6', 'screenshot save does not promote an old preview')
// Correcting Base64 successfully restores all three delivery actions.
input().props.onChange({ currentTarget: { value: 'invalid' } }); render()
button('image.decode').props.onClick(); await settle(); render(); assert.equal(output(), undefined)
input().props.onChange({ currentTarget: { value: 'valid' } }); render()
button('image.decode').props.onClick(); await settle(); render(); eligibility(true)
assert.equal(output().props.value, 'data:9')
console.log('PASS image replacement eligibility, old callbacks, failure/cancellation/retry, owner/tab revocation and independent screenshot save')
