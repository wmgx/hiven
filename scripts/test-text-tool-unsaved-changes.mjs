#!/usr/bin/env node
// Execute the complete production surfaces and their input/action callbacks.
// Only React hooks, UI primitives and host IO are supplied; no layout/style assertions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import * as sqlFormatter from 'sql-formatter'

function compile(source) {
  return ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
}
function load(path, dependencies = {}) {
  const exports = {}
  vm.runInNewContext(compile(readFileSync(path, 'utf8')), {
    exports, module: { exports }, console, atob, btoa, TextDecoder, Uint8Array,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `${path}: unexpected dependency ${name}`)
      return dependencies[name]
    },
  }, { filename: path })
  return exports
}
const jsx = (type, props) => ({ type, props })
const primitives = Object.fromEntries(['Button', 'Checkbox', 'IconButton', 'SegmentedControl', 'TextInput', 'TextEditor'].map(name => [name, name]))
const specs = [
  { plugin: 'line-tools', component: 'TextToolsSurface', route: 'line-sort', input: 'b\r\na\r\n中文🙂',
    core: load('src/plugins/line-tools/core.ts'), extras: { './routes': load('src/plugins/line-tools/routes.ts') } },
  { plugin: 'encode-decode', component: 'EncodeDecodeSurface', route: 'base64-encode', input: 'a & b\r\n中文🙂',
    core: load('src/plugins/encode-decode/core.ts') },
  { plugin: 'formatter', component: 'FormatterSurface', route: 'css-format', input: 'a{color:red;}\r\n',
    core: load('src/plugins/formatter/core.ts', { 'sql-formatter': sqlFormatter, './xml.ts': load('src/plugins/formatter/xml.ts') }) },
]
const tick = () => new Promise(resolve => setImmediate(resolve))
const plain = value => JSON.parse(JSON.stringify(value))
function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return []
  if (Array.isArray(tree)) return tree.flatMap(nodes)
  return [tree, ...nodes(tree.props?.children)]
}
function harness(spec, { input = spec.input, legacyHost = false, copy = async () => {}, paste = async () => ({ ok: true }), handoff = async () => true } = {}) {
  const slots = [], queuedEffects = []
  let cursor = 0, view, mounted = true, host
  const calls = { dirty: [], copied: [], pasted: [], returned: [], messages: [], complete: 0, back: 0, close: 0 }
  const props = { initialText: input, surfaceId: spec.route, t: key => key, appearance: { theme: 'dark' } }
  const useState = initial => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  }
  const useEffect = (setup, deps) => {
    const index = cursor++, previous = slots[index]
    if (!previous || !deps || deps.some((value, offset) => !Object.is(value, previous.deps?.[offset]))) {
      queuedEffects.push(() => {
        previous?.cleanup?.()
        slots[index] = { deps, setup, cleanup: setup() }
      })
    }
  }
  const react = { Suspense: 'Suspense', useState, useRef: value => useState(() => ({ current: value }))[0],
    useMemo: factory => factory(), useEffect, useLayoutEffect: useEffect }
  const component = load(`src/plugins/${spec.plugin}/${spec.component}.tsx`, {
    react, 'react/jsx-runtime': { jsx, jsxs: jsx },
    '@hiven/plugin': { getPluginHostSdk: () => ({ kits: { content: { detectContent: () => [] } } }) },
    '@hiven/plugin-ui': { ...primitives, getEditorTheme: value => value },
    '@hiven/plugin-ui/icons': { BackIcon: 'BackIcon', CloseIcon: 'CloseIcon' },
    'lucide-react': { ClipboardPaste: 'ClipboardPaste', CornerDownLeft: 'CornerDownLeft' },
    './core': spec.core, ...spec.extras,
  })[spec.component]
  const reporter = dirty => { if (mounted) calls.dirty.push(dirty) }
  host = {
    setUnsavedChanges: legacyHost ? undefined : reporter,
    clipboard: { writeText: async text => { calls.copied.push(text); await copy() } },
    paste: { pasteText: async text => { calls.pasted.push(text); return paste() } },
    returnToLauncherWithObject: block => { calls.returned.push(plain(block)); return handoff() },
    showMessage: (...args) => calls.messages.push(args),
    complete: () => calls.complete++, requestBack: () => calls.back++, close: () => calls.close++,
  }
  function render() {
    assert.ok(mounted)
    cursor = 0
    view = component({ ...props, host })
    queuedEffects.splice(0).forEach(run => run())
    return view
  }
  const find = predicate => {
    const found = nodes(view).find(predicate)
    assert.ok(found, 'production action/input must exist')
    return found.props
  }
  const inputProps = () => find(node => typeof node.props?.onChange === 'function'
    && (node.type === 'textarea' || node.type === 'TextEditor'))
  const action = key => find(node => typeof node.props?.onClick === 'function'
    && [node.props.label, node.props['aria-label'], node.props.children].flat().includes(key))
  function fire(key) {
    const button = action(key)
    assert.ok(!button.disabled, `${key} must be enabled`)
    const result = button.onClick()
    render()
    return result
  }
  render()
  return { calls, render, action, find, fire,
    get input() { return inputProps().value },
    get output() { return find(node => (node.type === 'textarea' && node.props.readOnly)
      || (node.type === 'TextEditor' && node.props.optionOverrides?.readOnly)).value },
    edit(value) { const field = inputProps(); field.onChange(spec.plugin === 'formatter' ? value : { currentTarget: { value } }); render() },
    change(key, value) { find(node => node.props?.['aria-label'] === key).onChange({ currentTarget: { value } }); render() },
    async click(key) { await fire(key); await tick(); render() },
    async settle() { await tick(); render() },
    rebuildHost({ replaceReporter = false } = {}) {
      host = { ...host, ...(replaceReporter ? { setUnsavedChanges: dirty => reporter(dirty) } : {}) }
      render()
    },
    replaceInitialText(value) { props.initialText = value; render() },
    replayEffects() { for (const slot of slots) if (slot?.setup) { slot.cleanup?.(); slot.cleanup = slot.setup() } },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.() },
  }
}

// Evaluate the renderer's real early-return guard. A changed target first removes
// SurfaceComponent, even when the next target has the same plugin/surface/text.
const rendererPath = 'src/components/pluginSurface/PluginSurfaceRenderer.tsx'
const rendererSource = readFileSync(rendererPath, 'utf8')
const rendererFile = ts.createSourceFile(rendererPath, rendererSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const rendererFunction = rendererFile.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'PluginSurfaceRenderer')
const loadingGuard = rendererFunction.body.statements.find(node => ts.isIfStatement(node)
  && node.expression.getText(rendererFile).includes("'loading-runtime'"))
assert.ok(loadingGuard)
const rendererAdmission = new vm.Script(`(${loadingGuard.expression.getText(rendererFile)})`, { filename: rendererPath })
const rendererShowsLoading = (target, surfaceState) => rendererAdmission.runInNewContext({ target, surfaceState })

let passed = 0
async function check(name, run) {
  try { await run(); passed++ }
  catch (error) { error.message = `${name}: ${error.message}`; throw error }
}
for (const spec of specs) {
  const checkSurface = (name, run) => check(`${spec.plugin}: ${name}`, run)
  await checkSurface('first load, automatic output, edits, exact revert and Clear', () => {
    const h = harness(spec)
    assert.equal(h.input, spec.input)
    assert.notEqual(h.output, spec.input)
    assert.deepEqual(h.calls.dirty, [false])
    h.edit(`${spec.input} `)
    assert.deepEqual(h.calls.dirty, [false, true], 'whitespace is part of the draft')
    h.render(); h.render()
    assert.deepEqual(h.calls.dirty, [false, true], 'unchanged renders do not report again')
    h.edit(spec.input)
    assert.equal(h.calls.dirty.at(-1), false)
    h.fire('action.clear')
    assert.equal(h.input, '')
    assert.equal(h.calls.dirty.at(-1), true)
    h.edit(spec.input)
    assert.equal(h.calls.dirty.at(-1), false)
    const empty = harness(spec, { input: '' })
    assert.deepEqual(empty.calls.dirty, [false])
    empty.edit(spec.input); empty.fire('action.clear')
    assert.deepEqual(empty.calls.dirty, [false, true, false])
  })
  await checkSurface('use output as input is a real edit and can be reverted', () => {
    const h = harness(spec), output = h.output
    h.fire('action.useAsInput')
    assert.equal(h.input, output)
    assert.deepEqual(h.calls.dirty, [false, true])
    h.edit(spec.input)
    assert.equal(h.calls.dirty.at(-1), false)
    const unchanged = harness(spec, { input: output })
    unchanged.fire('action.useAsInput')
    assert.equal(unchanged.calls.dirty.at(-1), unchanged.input !== output, 'replacement compares exact text, not the action')
  })
  await checkSurface('host recreation and prop refresh retain the first-load baseline', () => {
    const h = harness(spec)
    h.edit(`${spec.input} `)
    h.rebuildHost(); h.rebuildHost()
    assert.equal(h.input, `${spec.input} `)
    assert.deepEqual(h.calls.dirty, [false, true])
    h.rebuildHost({ replaceReporter: true })
    assert.deepEqual(h.calls.dirty, [false, true, true], 'replacement reporter receives the current dirty state')
    h.replaceInitialText('new prop is not a new mounted session')
    h.edit(spec.input)
    assert.equal(h.calls.dirty.at(-1), false)
    h.edit('new prop is not a new mounted session')
    assert.equal(h.calls.dirty.at(-1), true)
  })
  for (const nextInput of [spec.input, 'next material']) await checkSurface(`renderer new target remounts ${JSON.stringify(nextInput)}`, () => {
    const target = { pluginId: spec.plugin, surfaceId: spec.route, initialText: spec.input }
    const nextTarget = { ...target, initialText: nextInput }, ready = { status: 'ready', target }
    const previous = harness(spec)
    previous.edit(`${spec.input} edited`)
    assert.equal(rendererShowsLoading(target, ready), false)
    assert.equal(rendererShowsLoading(nextTarget, ready), true, 'old ready state cannot preserve the old component under a new target')
    previous.unmount()
    assert.deepEqual(previous.calls.dirty, [false, true], 'the plugin never emits a stale cleanup clear')
    assert.equal(rendererShowsLoading(nextTarget, { status: 'loading-runtime' }), true)
    assert.equal(rendererShowsLoading(nextTarget, { status: 'ready', target: nextTarget }), false)
    const next = harness(spec, { input: nextInput })
    assert.equal(next.input, nextInput)
    assert.deepEqual(next.calls.dirty, [false], 'new mount owns a clean baseline')
    next.edit(`${nextInput} edit`); next.edit(nextInput)
    assert.deepEqual(next.calls.dirty, [false, true, false])
  })
  await checkSurface('effect replay and optional legacy API preserve drafts', () => {
    const h = harness(spec)
    h.edit(`${spec.input} `); h.replayEffects()
    assert.equal(h.calls.dirty.at(-1), true)
    assert.equal(h.input, `${spec.input} `)
    const legacy = harness(spec, { legacyHost: true })
    legacy.edit(`${spec.input} `); legacy.fire('action.clear')
    assert.deepEqual(legacy.calls.dirty, [])
  })
  for (const failed of [false, true]) await checkSurface(`copy ${failed ? 'failure' : 'success'} preserves dirty and completion ownership`, async () => {
    const receipt = deferred(), h = harness(spec, { copy: () => receipt.promise })
    h.edit(`${spec.input} `)
    const output = h.output
    h.fire('action.copy')
    assert.deepEqual(h.calls.copied, [output])
    assert.equal(h.calls.complete, 0)
    assert.equal(h.calls.dirty.at(-1), true)
    if (failed) receipt.reject(Error('copy failed'))
    else receipt.resolve()
    await h.settle()
    assert.equal(h.calls.complete, failed ? 0 : 1)
    assert.equal(h.calls.messages.at(-1)[0], failed ? 'toast.copyFailed' : 'toast.copied')
    assert.deepEqual(h.calls.dirty, [false, true], 'only the host owns successful exit cleanup')
  })
  for (const outcome of [{ ok: true }, { ok: false, fallback: 'copied', message: 'copied only' }, { ok: false, message: 'failed' }, { ok: false }, 'throw']) {
    await checkSurface(`paste ${JSON.stringify(outcome)} leaves the current draft intact`, async () => {
      const receipt = deferred(), h = harness(spec, { paste: () => receipt.promise })
      h.edit(`${spec.input} `)
      const draft = h.input, output = h.output
      h.fire('action.pasteBack')
      assert.equal(h.action('action.pasteBack').disabled, true)
      assert.equal(h.calls.complete, 0)
      assert.equal(h.calls.dirty.at(-1), true)
      if (outcome === 'throw') receipt.reject(Error('paste failed'))
      else receipt.resolve(outcome)
      await h.settle()
      assert.deepEqual(h.calls.pasted, [output])
      assert.equal(h.calls.complete, outcome.ok ? 1 : 0)
      assert.equal(h.action('action.pasteBack').disabled, false)
      assert.equal(h.input, draft)
      assert.deepEqual(h.calls.dirty, [false, true])
    })
  }
  for (const accepted of [true, false, undefined]) await checkSurface(`return receipt ${String(accepted)} preserves the existing host path`, async () => {
    const receipt = deferred(), h = harness(spec, { handoff: () => receipt.promise })
    h.edit(`${spec.input} `)
    const draft = h.input, output = h.output
    const pending = h.fire('action.continueProcessing')
    assert.deepEqual(h.calls.returned, [{ kind: 'text', text: output, source: 'tool-result' }])
    assert.equal(h.calls.dirty.at(-1), true)
    receipt.resolve(accepted)
    assert.equal(await pending, accepted)
    h.render()
    assert.equal(h.input, draft)
    assert.deepEqual(h.calls.dirty, [false, true])
    assert.equal(h.calls.complete + h.calls.back + h.calls.close, 0, 'acknowledged navigation remains owned by the host')
  })
  await checkSurface('Back and Close still request the guarded host exits', () => {
    const h = harness(spec)
    h.edit(`${spec.input} `)
    h.fire('action.back'); h.fire('action.close')
    assert.equal(h.calls.back, 1); assert.equal(h.calls.close, 1)
    assert.equal(h.calls.complete, 0)
    assert.deepEqual(h.calls.dirty, [false, true])
  })
}

await check('line-tools: every parameter and group only changes derived output', () => {
  const h = harness(specs[0])
  h.find(node => node.type === 'SegmentedControl').onChange('desc'); h.render()
  h.find(node => node.type === 'Checkbox').onChange({ target: { checked: true } }); h.render()
  for (const [operation, parameter] of [['join.title', 'separator'], ['prepend.title', 'prefix'], ['append.title', 'suffix'], ['wrap.title', 'left'], ['wrap.title', 'right']]) {
    h.fire(operation); h.change(`param.${parameter}`, '|')
  }
  h.fire('group.case'); h.fire('group.stats'); h.fire('group.lines')
  assert.equal(h.input, specs[0].input)
  assert.deepEqual(h.calls.dirty, [false])
  h.edit(`${specs[0].input} edit`)
  h.fire('group.case'); h.fire('group.stats')
  assert.equal(h.calls.dirty.at(-1), true, 'changing groups cannot hide an edited draft')
  h.edit(specs[0].input)
  assert.equal(h.calls.dirty.at(-1), false)
  h.fire('action.clear')
  assert.equal(h.calls.dirty.at(-1), true, 'stats Clear is also a body edit')
  h.fire('group.case'); h.edit(specs[0].input); h.fire('action.clear')
  assert.equal(h.calls.dirty.at(-1), true, 'case Clear is also a body edit')
})
await check('line-tools: selecting a case result is clean; failure keeps edits', async () => {
  const h = harness(specs[0], { copy: async () => { throw Error('copy failed') } })
  h.fire('group.case'); await h.click('case.copyLabel')
  assert.deepEqual(h.calls.dirty, [false])
  h.edit('edited case'); await h.click('case.copyLabel')
  assert.deepEqual(h.calls.dirty, [false, true])
  assert.equal(h.calls.complete, 0)
})
await check('encode-decode: format and direction do not dirty even for invalid output', () => {
  const h = harness(specs[1])
  for (const key of ['direction.decode', 'format.jwt', 'format.url', 'direction.encode', 'format.html']) h.fire(key)
  assert.deepEqual(h.calls.dirty, [false])
  h.edit(`${specs[1].input} `); h.fire('direction.decode')
  assert.equal(h.calls.dirty.at(-1), true)
})
await check('formatter: language and operation do not dirty even for invalid output', () => {
  const h = harness(specs[2])
  for (const key of ['operation.compact', 'language.xml', 'operation.format', 'language.sql', 'language.css']) h.fire(key)
  assert.deepEqual(h.calls.dirty, [false])
  h.edit(`${specs[2].input} `); h.fire('operation.compact')
  assert.equal(h.calls.dirty.at(-1), true)
})
console.log(`Text tool unsaved changes: ${passed} production-module logic scenarios passed`)
