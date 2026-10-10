#!/usr/bin/env node
// Exercise the production result/return callbacks without rendering or asserting UI layout.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { jsonCore as core } from './helpers/text-transform-cores.mjs'

const surfacePath = 'src/plugins/json-tools/JsonSurface.tsx'
const surfaceSource = readFileSync(surfacePath, 'utf8')
const file = ts.createSourceFile(surfacePath, surfaceSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const surface = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'JsonSurface')
const returned = surface.body.statements.find(ts.isReturnStatement)
const exits = {}
const inspect = (node) => {
  if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
    const expression = node.initializer.expression?.getText(file) ?? ''
    if (/set(InputText|Operation|Indent|ShouldSort|Expression)\(/.test(expression)) {
      assert.match(expression, /updateResult\(/, 'every result-affecting UI edit revokes the pending snapshot synchronously')
    }
    for (const name of ['requestBack', 'close']) {
      if (expression.includes(`host.${name}()`)) exits[name] = expression
    }
  }
  ts.forEachChild(node, inspect)
}
inspect(returned)
const fields = 'inputText, operation, indent, shouldSort, expression, expressionRun, outputText, hasOutput, canReturnOutput, returning, returnOutput, copyOutput, useOutputAsInput, runExpression, updateResult, setInputText, setOperation, setIndent, setShouldSort, setExpression'
// Preserve the complete production function body; replace only the final JSX with a logic probe.
const source = surfaceSource.slice(0, returned.expression.getStart(file))
  + `({ ${fields}, back: ${exits.requestBack}, close: ${exits.close} })`
  + surfaceSource.slice(returned.expression.end)
function load(path, dependencies, source = readFileSync(path, 'utf8')) {
  const exports = {}
  const code = ts.transpileModule(source, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
  } }).outputText
  vm.runInNewContext(code, {
    exports, module: { exports }, AbortController, URLSearchParams, console,
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `${path}: unexpected dependency ${name}`)
      return dependencies[name]
    },
  }, { filename: path })
  return exports
}
const routes = load('src/plugins/json-tools/routes.ts', {})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const plain = (value) => JSON.parse(JSON.stringify(value))
function harness({ input = '{"b":2,"a":1}', operation = 'format', outcome = () => Promise.resolve(true), copyOutcome = () => Promise.resolve(), legacyHost = false } = {}) {
  const slots = [], effects = []
  let cursor = 0, view, mounted = true
  const calls = { handoff: [], messages: [], copied: [], dirty: [], complete: 0, back: 0, close: 0, clipboardReads: 0 }
  const useState = (initial) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (value) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }]
  }
  const react = {
    useState,
    useRef: (initial) => useState(() => ({ current: initial }))[0],
    useMemo: (factory) => factory(),
    useEffect: (setup, deps) => {
      const index = cursor++
      const previous = slots[index]
      if (!previous || !deps || deps.some((value, offset) => !Object.is(value, previous.deps?.[offset]))) {
        previous?.cleanup?.()
        const effect = { deps, setup, cleanup: setup() }
        if (previous) effects.splice(effects.indexOf(previous), 1, effect)
        else effects.push(effect)
        slots[index] = effect
      }
    },
  }
  react.useLayoutEffect = react.useEffect
  const { JsonSurface } = load(surfacePath, {
    react, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    '@hiven/plugin-ui': { getEditorTheme: (value) => value, useImeKeyboard: () => ({}) },
    '@hiven/plugin-ui/icons': {}, './routes': routes, './jsonCore': core,
  }, source)
  const host = {
    returnToLauncherWithObject: (block, options) => {
      if (!mounted) return Promise.resolve(false) // Host's documented lifetime boundary.
      calls.handoff.push({ block: plain(block), signal: options.signal })
      return outcome(block, options)
    },
    showMessage: (...args) => calls.messages.push(args),
    requestBack: () => { calls.back++; mounted = false },
    close: () => { calls.close++; mounted = false },
    complete: () => calls.complete++,
    setUnsavedChanges: legacyHost ? undefined : (dirty) => calls.dirty.push(dirty),
    clipboard: { writeText: async (text) => { calls.copied.push(text); await copyOutcome() }, readText: () => { calls.clipboardReads++; throw Error('Unexpected clipboard read') } },
  }
  const render = () => {
    cursor = 0
    view = JsonSurface({ host, initialText: input, surfaceId: operation, t: (key) => key, appearance: { theme: 'dark' } })
    return view
  }
  render()
  return { calls, render, get view() { return view },
    replaceInitialText(value) { input = value; render() },
    edit(name, value, rerender = true) {
      view.updateResult(() => view[`set${name}`](value))
      if (rerender) render()
    },
    run() { view.runExpression(); render() },
    draft: () => plain(Object.fromEntries(['inputText', 'operation', 'indent', 'shouldSort', 'expression', 'expressionRun', 'outputText'].map((key) => [key, view[key]]))),
    unmount() { mounted = false; for (const effect of effects) effect.cleanup?.() },
    replayEffects() { for (const effect of effects) { effect.cleanup?.(); effect.cleanup = effect.setup() } },
  }
}
let passed = 0
async function check(name, run) {
  try { await run(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

for (const [operation, input, expected] of [
  ['format', '0', '0'], ['compact', 'false', 'false'], ['format', 'null', 'null'],
  ['format', '{"b":2,"a":1}', '{\n  "b": 2,\n  "a": 1\n}'],
  ['unescape', '""', ''], ['json-to-query', '{}', ''],
  ['unescape', '"  中文\\r\\n🙂  "', '  中文\r\n🙂  '],
  ['json-to-yaml', '{"a":1}', 'a: 1\n'], ['query-to-json', 'a=1', '{\n  "a": "1"\n}'],
  ['escape', '  ', '"  "'],
]) await check(`${operation} preserves ${JSON.stringify(input)} as plain text`, async () => {
  const h = harness({ operation, input })
  assert.equal(h.view.canReturnOutput, true)
  await h.view.returnOutput()
  assert.deepEqual(h.calls.handoff[0].block, { kind: 'text', text: expected, source: 'tool-result' })
  assert.equal(h.calls.copied.length + h.calls.clipboardReads + h.calls.complete + h.calls.back + h.calls.close, 0)
})
for (const input of ['', ' \r\n\t', '{invalid']) await check(`invalid/absent input ${JSON.stringify(input)} cannot return`, async () => {
  const h = harness({ input })
  assert.equal(h.view.canReturnOutput, false)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 0)
})
for (const value of [0, false, '']) await check(`expression ${JSON.stringify(value)} needs a current manual run`, async () => {
  const h = harness({ operation: 'expression', input: JSON.stringify({ value }) })
  h.edit('Expression', '.value')
  assert.equal(h.view.expressionRun, null)
  assert.equal(h.view.canReturnOutput, false)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 0)
  h.run()
  assert.equal(h.view.canReturnOutput, true)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff[0].block.text, String(value))
  h.edit('Expression', '.value + "changed"')
  assert.equal(h.view.canReturnOutput, false)
  h.run()
  h.edit('InputText', '{"value":"new source"}')
  assert.equal(h.view.canReturnOutput, false)
  h.run()
  assert.equal(h.view.outputText, 'new sourcechanged')
})
await check('expression errors never expose output; edits and to-input do not execute expressions', async () => {
  const h = harness({ operation: 'expression', input: '{"value":"text"}' })
  h.edit('Expression', '.missing()'); h.run()
  assert.equal(h.view.canReturnOutput, false)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 0)
  h.edit('Expression', '.value'); h.run()
  const previousRun = h.view.expressionRun
  h.view.useOutputAsInput(); h.render()
  assert.equal(h.view.inputText, 'text')
  assert.equal(h.view.operation, 'expression')
  assert.equal(h.view.expressionRun, previousRun)
  assert.equal(h.view.canReturnOutput, false)
})
for (const outcome of [false, true, undefined, 'reject', 'throw']) await check(`ack ${String(outcome)} retains draft and gates duplicate delivery`, async () => {
  const receipt = deferred()
  const h = harness({ outcome: () => { if (outcome === 'throw') throw Error('sync failure'); return receipt.promise } })
  const draft = h.draft(), oldReturn = h.view.returnOutput
  const pending = oldReturn()
  if (outcome !== 'throw') {
    await oldReturn()
    assert.equal(h.calls.handoff.length, 1)
    h.render(); assert.equal(h.view.returning, true)
  }
  if (outcome === 'reject') receipt.reject(Error('async failure'))
  else receipt.resolve(outcome)
  await pending; h.render()
  assert.deepEqual(h.draft(), draft)
  assert.equal(h.calls.complete + h.calls.back + h.calls.close, 0, 'host alone owns success navigation')
  if (outcome === true || outcome === undefined) {
    await oldReturn(); await h.view.returnOutput()
    assert.equal(h.calls.handoff.length, 1, 'success and legacy void remain consumed until an edit')
  } else {
    assert.equal(h.view.returning, false)
    await h.view.returnOutput()
    assert.equal(h.calls.handoff.length, 2, 'failure permits retry with the exact draft')
  }
  assert.equal(h.calls.messages.length, outcome === 'reject' || outcome === 'throw' ? 2 : 0, 'only thrown failures need a plugin toast')
})
for (const [name, value] of [['InputText', '{"new":2}'], ['Expression', '.new'], ['Operation', 'json-to-yaml'], ['Indent', 4], ['ShouldSort', true]]) {
  for (const outcome of [true, false, 'reject']) await check(`${name} aborts before render and ignores late ${outcome}`, async () => {
    const receipts = [deferred(), deferred()]
    const h = harness({ outcome: () => receipts[h.calls.handoff.length - 1].promise })
    const oldReturn = h.view.returnOutput, pending = oldReturn()
    h.edit(name, value, false)
    assert.equal(h.calls.handoff[0].signal.aborted, true)
    await oldReturn()
    assert.equal(h.calls.handoff.length, 1, 'retained callback cannot start between edit and render')
    h.render()
    const current = h.view.returnOutput()
    await oldReturn()
    assert.equal(h.calls.handoff.length, 2, 'retained callback cannot start after render either')
    if (outcome === 'reject') receipts[0].reject(Error('late error'))
    else receipts[0].resolve(outcome)
    await pending; h.render()
    assert.equal(h.view.returning, true, 'old settlement cannot unlock the newer submission')
    assert.equal(h.calls.messages.length, 0)
    assert.equal(h.calls.handoff[1].signal.aborted, false)
    receipts[1].resolve(false); await current; h.render()
    assert.equal(h.view.returning, false)
  })
}
for (const action of ['back', 'close', 'unmount', 'copyOutput', 'useOutputAsInput']) await check(`${action} revokes the pending snapshot`, async () => {
  const receipt = deferred(), h = harness({ outcome: () => receipt.promise })
  const pending = h.view.returnOutput(), text = h.view.outputText
  if (action === 'unmount') h.unmount()
  else await h.view[action]()
  assert.equal(h.calls.handoff[0].signal.aborted, true)
  receipt.resolve(true); await pending
  assert.equal(h.calls.complete, action === 'copyOutput' ? 1 : 0)
  assert.deepEqual(h.calls.copied, action === 'copyOutput' ? [text] : [])
  assert.equal(h.calls.back, action === 'back' ? 1 : 0)
  assert.equal(h.calls.close, action === 'close' ? 1 : 0)
})
await check('effect replay does not revoke an untouched result', async () => {
  const h = harness()
  h.replayEffects()
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 1)
})
await check('return waits for every already-started Copy without changing Copy completion', async () => {
  const copies = [deferred(), deferred()]
  const h = harness({ copyOutcome: () => copies[h.calls.copied.length - 1].promise })
  const first = h.view.copyOutput(), second = h.view.copyOutput()
  h.render()
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 0)
  copies[0].resolve(); await first; h.render()
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 0, 'a second pending Copy still owns completion')
  copies[1].reject(Error('copy failed')); await second; h.render()
  assert.equal(h.calls.complete, 1)
  assert.equal(h.calls.messages.at(-1)[0], 'toast.copyFailed')
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 1, 'the independent surface may return after Copy settles')
})
await check('dirty tracks exact input and expression against the first-load baseline', async () => {
  const original = '  {"b":2,"a":1}\r\n'
  const h = harness({ input: original })
  assert.deepEqual(h.calls.dirty, [false], 'opening and automatic output are clean')
  h.edit('Indent', 4); h.edit('ShouldSort', true); h.edit('Operation', 'compact')
  assert.deepEqual(h.calls.dirty, [false], 'parameters never mark the input dirty')
  h.edit('InputText', '{"changed":true}')
  assert.deepEqual(h.calls.dirty, [false, true])
  h.render(); h.render()
  assert.deepEqual(h.calls.dirty, [false, true], 'unchanged renders do not re-report')
  h.edit('InputText', original)
  assert.equal(h.calls.dirty.at(-1), false, 'exact undo clears dirty')
  h.edit('Expression', '.a'); h.edit('Operation', 'format')
  assert.equal(h.calls.dirty.at(-1), true, 'an expression remains dirty while its controls are hidden')
  h.edit('Expression', '')
  assert.equal(h.calls.dirty.at(-1), false)
  h.replaceInitialText('later prop text')
  assert.equal(h.calls.dirty.at(-1), false, 'the original loaded input remains the baseline')
  h.edit('InputText', '')
  assert.equal(h.calls.dirty.at(-1), true, 'user clearing supplied input is an edit')
})
await check('user replacement by output counts as an input edit; unmount never sends a stale clear', async () => {
  const h = harness()
  h.view.useOutputAsInput(); h.render()
  assert.deepEqual(h.calls.dirty, [false, true])
  h.unmount()
  assert.deepEqual(h.calls.dirty, [false, true], 'renderer owns lifetime cleanup')
  const oldHost = harness({ legacyHost: true })
  oldHost.edit('InputText', '{"changed":true}')
  assert.deepEqual(oldHost.calls.dirty, [], 'optional API retains compatibility with older hosts')
})
console.log(`JSON result return: ${passed} production-module logic scenarios passed`)
