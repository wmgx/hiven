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

function load(path, dependencies) {
  const exports = {}
  vm.runInNewContext(compile(readFileSync(path, 'utf8')), {
    exports,
    module: { exports },
    console,
    AbortController,
    requestAnimationFrame: (callback) => callback(),
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

function deferred() {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function harness({ initialText = 'initial sample', legacyHost = false, handoff = async () => true } = {}) {
  const slots = []
  const effects = []
  const listeners = new Set()
  const calls = { dirty: [], returned: [], back: 0, close: 0, cancelled: 0 }
  let cursor = 0
  let needsRender = false
  let mounted = true
  let view
  let props = { initialText, surfaceId: 'main', t: (key) => key, appearance: { theme: 'dark' } }
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
        slots[index] = { deps, setup, cleanup: setup() }
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
    useMemo,
  }
  const resultFor = (pattern, flags, source) => ({
    status: 'ready',
    source,
    matches: pattern && source ? [{ index: 0, line: 1, col: 1, text: source, groups: [], namedGroups: {} }] : [],
    flags,
  })
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@hiven/plugin': { getPluginHostSdk: () => ({}) },
    '@hiven/plugin-ui': { Button: 'Button', IconButton: 'IconButton', Select: 'Select' },
    '@hiven/plugin-ui/icons': { BackIcon: 'BackIcon', CloseIcon: 'CloseIcon' },
    './regexCore': { MAX_REGEX_MATCHES: 1000 },
    './useRegexExecution': { useRegexExecution: (pattern, flags, source) => ({
      result: resultFor(pattern, flags, source),
      cancel: () => { calls.cancelled++ },
    }) },
    './extractMatches': { extractRegexMatches: (result) => ({ status: 'ready', text: result.source }) },
    './aiCandidateSession': { createAiCandidateSession: () => ({
      invalidate() {}, dispose() {}, generate() {}, cancel() {}, adopt: () => null,
    }) },
    './AiCandidateControls': { AiCandidateControls: 'AiCandidateControls' },
  }
  const Component = load('src/plugins/regex-tester/RegexTesterViews.tsx', dependencies).RegexTesterSurface

  const buildHost = () => ({
    ai: {},
    deliveryFeedbackOwner: {
      isCurrent: () => mounted,
      subscribeInvalidation: (listener) => { listeners.add(listener); return () => listeners.delete(listener) },
    },
    setUnsavedChanges: legacyHost ? undefined : reporter,
    returnToLauncherWithObject: (block, options) => {
      calls.returned.push(JSON.parse(JSON.stringify(block)))
      calls.returnSignal = options?.signal
      return handoff()
    },
    requestBack: () => { calls.back++ },
    close: () => { calls.close++ },
  })
  host = buildHost()

  function render() {
    let passes = 0
    do {
      assert.ok(passes++ < 20, 'hook updates must settle')
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
  const field = (label) => find((node) => node.props?.['aria-label'] === label)
  const source = () => find((node) => node.type === 'textarea')
  const action = (label) => find((node) => node.props?.label === label || node.props?.children === label)
  const edit = (target, value) => {
    const control = target === 'source' ? source() : field(target)
    control.onChange({ target: { value }, currentTarget: { value } })
    render()
  }
  render()
  return {
    calls,
    action,
    field,
    render,
    edit,
    get pattern() { return field('panel.regex.pattern').value },
    get flags() { return field('panel.regex.flags').value },
    get sourceText() { return source().value },
    rebuildHost() { host = buildHost(); render() },
    replaceReporter() { reporter = (dirty) => { if (mounted) calls.dirty.push(dirty) }; host = buildHost(); render() },
    replaceInitialText(value) { props = { ...props, initialText: value }; render() },
    unmount() {
      mounted = false
      for (const slot of slots) slot?.cleanup?.()
      listeners.clear()
    },
    async continueProcessing() {
      const promise = action('surface.extractMatches').onClick()
      render()
      await promise
      await tick()
      render()
    },
  }
}

{
  const h = harness()
  assert.deepEqual(h.calls.dirty, [false])
  h.edit('panel.regex.pattern', 'order=(?<id>[0-9]+)')
  assert.deepEqual(h.calls.dirty, [false, true])
}

{
  const h = harness()
  h.edit('panel.regex.pattern', 'changed')
  h.edit('panel.regex.pattern', '[a-z]+')
  h.edit('panel.regex.flags', 'gi')
  h.edit('panel.regex.flags', 'g')
  h.edit('source', 'changed source')
  h.edit('source', 'initial sample')
  assert.deepEqual(h.calls.dirty, [false, true, false, true, false, true, false])

  h.field('surface.extractTarget').onChange({ currentTarget: { value: 'group:1' } })
  h.render()
  const match = nodes(h.render()).find((node) => node.type === 'button'
    && String(node.props?.className).includes('regex-tester-surface__match'))
  match.props.onClick()
  h.render()
  assert.deepEqual(h.calls.dirty, [false, true, false, true, false, true, false], 'derived selection is clean')
}

{
  const h = harness()
  h.edit('source', 'draft survives host rerender')
  h.rebuildHost()
  h.replaceReporter()
  assert.equal(h.sourceText, 'draft survives host rerender')
  assert.deepEqual(h.calls.dirty, [false, true, true], 'replacement reporter receives current dirty state')
  h.replaceInitialText('new prop is not a new mounted context')
  assert.equal(h.sourceText, 'draft survives host rerender')
  h.edit('source', 'initial sample')
  assert.equal(h.calls.dirty.at(-1), false, 'same mount retains its first baseline')

  const target = { pluginId: 'regex-tester', surfaceId: 'main', initialText: 'initial sample' }
  const nextTarget = { ...target, initialText: 'new context' }
  const ready = { status: 'ready', target }
  assert.equal(rendererShowsLoading(target, ready), false)
  assert.equal(rendererShowsLoading(nextTarget, ready), true,
    'a new input context must remove the old surface before admitting its replacement')
  h.unmount()

  const next = harness({ initialText: 'new context' })
  assert.equal(next.sourceText, 'new context')
  assert.deepEqual(next.calls.dirty, [false], 'new mount establishes a clean input-context baseline')
  next.unmount()
}

{
  const legacy = harness({ legacyHost: true })
  legacy.edit('source', 'legacy host draft')
  assert.deepEqual(legacy.calls.dirty, [])
  legacy.unmount()
}

for (const outcome of [false, 'reject']) {
  const receipt = deferred()
  const h = harness({ handoff: () => receipt.promise })
  h.edit('source', 'failure must keep this draft')
  const pending = h.continueProcessing()
  if (outcome === 'reject') receipt.reject(Error('synthetic rejection'))
  else receipt.resolve(false)
  await pending
  assert.equal(h.sourceText, 'failure must keep this draft')
  assert.equal(h.calls.dirty.at(-1), true)
  assert.equal(h.calls.back + h.calls.close, 0)
  h.unmount()
}

{
  const h = harness({ handoff: async () => true })
  h.edit('panel.regex.pattern', 'successful pattern')
  h.edit('source', 'successful source')
  await h.continueProcessing()
  assert.deepEqual(h.calls.returned, [{ kind: 'text', text: 'successful source', source: 'tool-result' }])
  assert.equal(h.calls.back + h.calls.close, 0, 'successful handoff stays on the existing delivery path')
  assert.equal(h.calls.dirty.at(-1), true, 'the host owns successful navigation cleanup')
  h.unmount()
}

{
  const h = harness()
  h.edit('source', 'guarded exits')
  h.action('surface.back').onClick()
  h.action('surface.close').onClick()
  assert.equal(h.calls.back, 1)
  assert.equal(h.calls.close, 1)
  assert.equal(h.calls.dirty.at(-1), true)
  h.unmount()
}

assert.match(rendererSource, /onUnsavedChangesChange\?\.\(false, leaveOwner\)/,
  'renderer replacement/unmount must release the exact draft owner')

console.log('Regex Tester unsaved changes: baseline, reversion, derived state, owner lifecycle, failed/successful handoff and guarded exits passed')
