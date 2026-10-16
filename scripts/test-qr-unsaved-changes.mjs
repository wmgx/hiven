#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function compile(source) {
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
    jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
}

function load(path, dependencies, globals = {}) {
  const exports = {}
  vm.runInNewContext(compile(readFileSync(path, 'utf8')), {
    exports,
    module: { exports },
    console,
    Blob,
    Uint8Array,
    AbortController,
    ...globals,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `${path}: unexpected dependency ${name}`)
      return dependencies[name]
    },
  }, { filename: path })
  return exports
}

const jsx = (type, props) => ({ type, props })
const nodes = (tree) => {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
const tick = () => new Promise((resolve) => setImmediate(resolve))

const rendererPath = 'src/components/pluginSurface/PluginSurfaceRenderer.tsx'
const rendererSource = readFileSync(rendererPath, 'utf8')
const rendererFile = ts.createSourceFile(rendererPath, rendererSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const rendererFunction = rendererFile.statements.find((node) => ts.isFunctionDeclaration(node)
  && node.name?.text === 'PluginSurfaceRenderer')
const loadingGuard = rendererFunction.body.statements.find((node) => ts.isIfStatement(node)
  && node.expression.getText(rendererFile).includes("'loading-runtime'"))
assert.ok(loadingGuard, 'renderer target admission guard must exist')
const rendererAdmission = new vm.Script(`(${loadingGuard.expression.getText(rendererFile)})`, { filename: rendererPath })
const rendererShowsLoading = (target, surfaceState) => rendererAdmission.runInNewContext({ target, surfaceState })

function harness({ initialText = '', surfaceId = 'main', legacyHost = false } = {}) {
  const slots = []
  const effects = []
  const calls = { dirty: [], back: 0, close: 0, generated: [] }
  const windowListeners = new Map()
  const documentListeners = new Map()
  let cursor = 0
  let needsRender = false
  let mounted = true
  let view
  let props = { initialText, surfaceId, t: (key) => key, appearance: { theme: 'dark' } }
  let reporter = (dirty) => { if (mounted) calls.dirty.push(dirty) }
  let host

  const useState = (initial) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (value) => {
      const next = typeof value === 'function' ? value(slots[index]) : value
      if (!Object.is(next, slots[index])) needsRender = true
      slots[index] = next
    }]
  }
  const useEffect = (setup, deps) => {
    const index = cursor++
    const previous = slots[index]
    if (!previous || !deps || deps.some((value, offset) => !Object.is(value, previous.deps?.[offset]))) {
      effects.push(() => {
        previous?.cleanup?.()
        slots[index] = { deps, cleanup: setup() }
      })
    }
  }
  const useMemo = (factory, deps) => {
    const index = cursor++
    const previous = slots[index]
    if (!previous || deps.some((value, offset) => !Object.is(value, previous.deps?.[offset]))) {
      slots[index] = { deps, value: factory() }
    }
    return slots[index].value
  }
  const react = {
    useState,
    useRef: (value) => useState(() => ({ current: value }))[0],
    useEffect,
    useLayoutEffect: useEffect,
    useCallback: (callback, deps) => useMemo(() => callback, deps),
  }
  const handoff = {
    activate() {}, deactivate() {}, interrupt() {}, setResult() {},
  }
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@hiven/plugin-ui': {
      Button: 'Button', ContextMenu: 'ContextMenu', IconButton: 'IconButton',
      SegmentedControl: 'SegmentedControl', Select: 'Select', TextArea: 'TextArea',
    },
    '@hiven/plugin-ui/icons': { BackIcon: 'BackIcon', CloseIcon: 'CloseIcon' },
    './qrResultHandoff': {
      createQrResultHandoff: () => handoff,
      EMPTY_QR_HANDOFF: { busy: false, failed: false },
    },
    './saveQrImage': { saveQrImage: async () => ({ status: 'saved' }) },
    './qrPaste': { createQrPasteHandlers: () => ({
      keydown() {}, keyup() {}, paste() {}, compositionstart() {}, compositionend() {}, blur() {},
    }) },
    './qrScanSession': {
      EMPTY_QR_SCAN: { busy: false, previewUrl: '', result: null, clipboardError: false },
      createQrScanSession: () => ({
        blob() {}, dataUrl() {}, clipboard() {}, reset() {}, dispose() {},
      }),
    },
    './qrCore': {
      DEFAULT_QR_ERROR_LEVEL: 'M',
      DEFAULT_QR_SIZE: 256,
      QR_ERROR_LEVELS: ['L', 'M', 'Q', 'H'],
      QR_SIZES: [128, 256, 320],
      copyPngBlobToClipboard: async () => {},
      dataUrlToBytes: () => new Uint8Array(),
      dataUrlToPngBlob: () => new Blob(),
      generateQrDataUrl: async (text) => {
        calls.generated.push(text)
        return `data:image/png;base64,${text}`
      },
      isImageDataUrl: (value) => value.startsWith('data:image/'),
      normalizeQrErrorCorrection: (value) => value,
      normalizeQrSize: (value) => Number(value),
    },
  }
  const fakeWindow = {
    addEventListener(type, listener) { windowListeners.set(type, listener) },
    removeEventListener(type, listener) { if (windowListeners.get(type) === listener) windowListeners.delete(type) },
  }
  const fakeDocument = {
    visibilityState: 'visible',
    addEventListener(type, listener) { documentListeners.set(type, listener) },
    removeEventListener(type, listener) { if (documentListeners.get(type) === listener) documentListeners.delete(type) },
  }
  const Component = load('src/plugins/qr-code/QrSurface.tsx', dependencies, {
    window: fakeWindow,
    document: fakeDocument,
    navigator: { platform: 'Linux' },
  }).QrSurface

  const buildHost = () => ({
    setUnsavedChanges: legacyHost ? undefined : reporter,
    subscribeLeaveIntent: () => () => {},
    requestBack: () => { calls.back++ },
    close: () => { calls.close++ },
    clipboard: {},
    storage: { blob: {} },
    showMessage() {},
    complete() {},
  })
  host = buildHost()

  function render() {
    let passes = 0
    do {
      assert.ok(passes++ < 30, 'hook updates must settle')
      needsRender = false
      cursor = 0
      view = Component({ ...props, host })
      effects.splice(0).forEach((run) => run())
    } while (needsRender)
    return view
  }
  const find = (predicate) => {
    const found = nodes(view).find(predicate)
    assert.ok(found, 'production control must exist')
    return found.props
  }
  const control = (type, ariaLabel) => find((node) => node.type === type
    && (ariaLabel === undefined || node.props?.['aria-label'] === ariaLabel))
  const action = (label) => find((node) => node.props?.label === label)
  const editText = (value) => {
    control('TextArea').onChange({ target: { value }, currentTarget: { value } })
    render()
  }
  render()
  return {
    calls,
    action,
    render,
    editText,
    async settle() { await tick(); render() },
    setMode(value) { control('SegmentedControl').onChange(value); render() },
    setParameter(label, value) {
      control('Select', label).onChange({ target: { value }, currentTarget: { value } })
      render()
    },
    get text() { return control('TextArea').value },
    rebuildHost() { host = buildHost(); render() },
    replaceReporter() { reporter = (dirty) => { if (mounted) calls.dirty.push(dirty) }; host = buildHost(); render() },
    replaceInitialText(value) { props = { ...props, initialText: value }; render() },
    unmount() {
      mounted = false
      for (const slot of slots) slot?.cleanup?.()
      windowListeners.clear()
      documentListeners.clear()
    },
  }
}

{
  const h = harness()
  assert.deepEqual(h.calls.dirty, [false])
  h.editText('new QR body')
  h.editText('')
  assert.deepEqual(h.calls.dirty, [false, true, false], 'empty entry becomes clean after exact reversion')
  h.unmount()
}

{
  const h = harness({ initialText: 'initial QR body' })
  assert.deepEqual(h.calls.dirty, [false])
  h.editText('edited QR body')
  h.editText('initial QR body')
  assert.deepEqual(h.calls.dirty, [false, true, false], 'exact body restoration is clean')
  h.unmount()
}

{
  const h = harness({ initialText: 'stable body' })
  h.setParameter('param.ecc', 'H')
  h.setParameter('param.size', '320')
  h.setMode('scan')
  h.setMode('generate')
  await h.settle()
  assert.equal(h.text, 'stable body')
  assert.deepEqual(h.calls.dirty, [false], 'parameters, mode and generated preview are not body edits')
  assert.ok(h.calls.generated.includes('stable body'), 'the production preview effect ran')

  h.editText('dirty body survives Scan')
  h.setMode('scan')
  assert.equal(h.calls.dirty.at(-1), true)
  h.setMode('generate')
  assert.equal(h.text, 'dirty body survives Scan')
  assert.deepEqual(h.calls.dirty, [false, true], 'mode switches neither clear nor duplicate dirty state')
  h.unmount()
}

{
  const h = harness({ initialText: 'first context' })
  h.editText('draft survives host rerender')
  h.rebuildHost()
  h.replaceReporter()
  assert.equal(h.text, 'draft survives host rerender')
  assert.deepEqual(h.calls.dirty, [false, true, true], 'replacement reporter receives current dirty state')
  h.replaceInitialText('same mount is not a new context')
  assert.equal(h.text, 'draft survives host rerender')
  h.editText('first context')
  assert.equal(h.calls.dirty.at(-1), false, 'same mount retains its original body baseline')

  const target = { pluginId: 'qr-code', surfaceId: 'main', initialText: 'first context' }
  const nextTarget = { ...target, initialText: 'new context' }
  const ready = { status: 'ready', target }
  assert.equal(rendererShowsLoading(target, ready), false)
  assert.equal(rendererShowsLoading(nextTarget, ready), true,
    'a new body context removes the old surface before admitting its replacement')
  h.unmount()

  const next = harness({ initialText: 'new context' })
  assert.equal(next.text, 'new context')
  assert.deepEqual(next.calls.dirty, [false], 'new mount establishes a clean body baseline')
  next.unmount()
}

{
  const scan = harness({ surfaceId: 'scan', initialText: 'data:image/png;base64,synthetic' })
  assert.deepEqual(scan.calls.dirty, [false], 'scan entry has no editable body draft')
  scan.setMode('generate')
  assert.equal(scan.text, '')
  assert.deepEqual(scan.calls.dirty, [false])
  scan.unmount()
}

{
  const legacy = harness({ legacyHost: true })
  legacy.editText('legacy host body')
  assert.deepEqual(legacy.calls.dirty, [])
  legacy.unmount()
}

{
  const h = harness()
  h.editText('guarded QR body')
  h.action('action.back').onClick()
  h.action('action.close').onClick()
  assert.equal(h.calls.back, 1)
  assert.equal(h.calls.close, 1)
  assert.equal(h.calls.dirty.at(-1), true)
  h.unmount()
}

assert.match(rendererSource, /onUnsavedChangesChange\?\.\(false, leaveOwner\)/,
  'renderer replacement/unmount must release the exact draft owner')

console.log('QR unsaved changes: body baseline, exact reversion, derived state, mode switching, owner lifecycle and guarded exits passed')
