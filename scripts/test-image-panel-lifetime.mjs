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
const dirty = []; const invalidateRef = { current: null }
const props = { active: true, saveFocused: false, initialText: '', surfaceId: 'image-base64', t: (key) => key,
  invalidateRef, onDirtyChange: (value) => dirty.push(value), onShowWorkbench() {}, host: {
    deliveryFeedbackOwner: { isCurrent: () => current, subscribeInvalidation(fn) { invalidation = fn; return () => {} } },
    clipboard: { readImage: (...args) => read(...args) },
  } }
const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/plugins/encode-decode/ImageBase64Panel.tsx', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, { exports, AbortController, Uint8Array, require(name) {
  if (name === 'react') return react
  if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' }
  if (name === '@hiven/plugin-ui') return { Button: 'Button' }
  if (name === './saveClipboardPng') return { saveClipboardPng() { throw Error('Unexpected save') } }
  if (name === './imageBase64') return { MAX_IMAGE_BYTES: 100, inspectRaster: () => ({ mime: 'image/png', width: 1, height: 1 }),
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
console.log('PASS image draft/preview retention, cancelled late read, retry, owner revocation')
