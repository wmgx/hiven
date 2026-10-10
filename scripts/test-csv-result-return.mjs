#!/usr/bin/env node
// Exercise production CSV processing and surface callbacks; no DOM/style assertions.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const surfacePath = 'src/plugins/csv/CsvSurface.tsx'
const surfaceSource = readFileSync(surfacePath, 'utf8')
const file = ts.createSourceFile(surfacePath, surfaceSource, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX)
const surface = file.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === 'CsvSurface')
const returned = surface.body.statements.find(ts.isReturnStatement)
const exits = {}, edits = {}
const inspect = (node) => {
  if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
    const expression = node.initializer.expression?.getText(file) ?? ''
    const setter = expression.match(/set(SourceText|Delimiter|Header|Output|Minify|Indent|TableName|DropEmpty|Dedupe|Transpose)\(/)?.[1]
    if (setter) {
      assert.match(expression, /updateResult\(/, `${setter} must revoke a pending snapshot before its state update`)
      edits[setter] = expression
    }
    for (const name of ['requestBack', 'close', 'detachToWindow']) {
      if (expression.includes(`host.${name}(`)) exits[name] = expression
    }
  }
  ts.forEachChild(node, inspect)
}
inspect(returned)
assert.equal(Object.keys(edits).length, 10, 'all source, parsing, transform and output controls are exercised')
const fields = [
  'sourceText', 'delimiter', 'header', 'output', 'minify', 'indent', 'tableName', 'dropEmpty', 'dedupe', 'transpose',
  'outputText', 'tableFull', 'fullJob', 'fullJobReady', 'fullOutputRef', 'jobFingerprint', 'fullReturnReady',
  'returnNeedsFullProcess', 'canReturnOutput', 'returning', 'returnOutput', 'runFullProcess', 'cancelFullProcess',
  'onFilePicked', 'readingFile', 'handleCopyPrimary', 'downloadFullResult', 'updateResult', 'setSourceText',
  'setSelectedCell', 'setSelectedColumns', 'setCellBlock', 'setGlobalFilter', 'setSqlFilter', 'setFilterMode', 'setMainView',
]
const probe = `({ ${fields.join(', ')}, edits: { ${Object.entries(edits).map(([name, fn]) => `${name}: ${fn}`).join(', ')} }, exits: { ${Object.entries(exits).map(([name, fn]) => `${name}: ${fn}`).join(', ')} } })`
const source = surfaceSource.slice(0, returned.expression.getStart(file)) + probe + surfaceSource.slice(returned.expression.end)
function load(path, dependencies, contents = readFileSync(path, 'utf8'), globals = {}) {
  const exports = {}
  const code = ts.transpileModule(contents, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  vm.runInNewContext(code, {
    exports, module: { exports }, AbortController, TextEncoder, setTimeout, console, ...globals,
    require: (name) => {
      assert.ok(Object.hasOwn(dependencies, name), `${path}: unexpected dependency ${name}`)
      return dependencies[name]
    },
  }, { filename: path })
  return exports
}
const core = load('src/plugins/csv/csvCore.ts', {})
const sql = load('src/plugins/csv/csvSqlFilter.ts', {})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const plain = (value) => JSON.parse(JSON.stringify(value))
function harness({ input = 'name,value\none,1\ntwo,2', operation = 'to-json', outcome = () => true, copyOutcome = () => Promise.resolve(), process = core.processFullSource } = {}) {
  const slots = [], effects = []
  let cursor = 0, view, mounted = true, changed = false, deferredInput, processing = false
  const calls = { handoff: [], messages: [], copied: [], navigation: 0, complete: 0, back: 0, close: 0, detach: 0 }
  const useState = (initial) => {
    const index = cursor++
    if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
    return [slots[index], (value) => {
      const next = typeof value === 'function' ? value(slots[index]) : value
      if (!Object.is(slots[index], next)) { slots[index] = next; changed = true }
    }]
  }
  const sameDeps = (left, right) => left && right && left.length === right.length && left.every((value, index) => Object.is(value, right[index]))
  const react = {
    useState,
    useRef: (initial) => useState(() => ({ current: initial }))[0],
    useMemo: (factory, deps) => {
      const index = cursor++, previous = slots[index]
      if (!previous || !sameDeps(previous.deps, deps)) slots[index] = { value: factory(), deps }
      return slots[index].value
    },
    useEffect: (setup, deps) => {
      const index = cursor++, previous = slots[index]
      if (!previous || !sameDeps(previous.deps, deps)) {
        const next = { deps, setup, cleanup: previous?.cleanup }
        slots[index] = next
        effects.push(() => { next.cleanup?.(); next.cleanup = setup() })
      }
    },
    useDeferredValue: (value) => deferredInput ?? value,
    useTransition: () => [processing, (fn) => fn()],
  }
  react.useCallback = (callback, deps) => react.useMemo(() => callback, deps)
  react.useLayoutEffect = react.useEffect
  const { CsvSurface } = load(surfacePath, {
    react, 'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    'react-data-grid': {}, 'react-data-grid/lib/styles.css': {},
    '@hiven/plugin-ui': {}, '@hiven/plugin-ui/icons': {},
    './csvCore': { ...core, processFullSource: process }, './csvSqlFilter': sql,
  }, source, { window: { addEventListener() {}, removeEventListener() {} }, navigator: { clipboard: { writeText: () => Promise.reject(Error('no browser clipboard')) } } })
  const makeHost = () => {
    const result = {
      returnToLauncherWithObject: (block, options) => {
        calls.handoff.push({ block: plain(block), signal: options.signal, host: result })
        return Promise.resolve(outcome(block, options)).then((accepted) => {
          if (accepted === true && !options.signal.aborted && mounted && result === host) calls.navigation++
          return accepted
        })
      },
      showMessage: (...args) => calls.messages.push(args),
      requestBack: () => { calls.back++ }, close: () => { calls.close++ }, detachToWindow: () => { calls.detach++ },
      complete: () => calls.complete++,
      clipboard: { writeText: async (text) => { calls.copied.push(text); await copyOutcome() } },
    }
    return result
  }
  let host = makeHost()
  const t = (key) => key
  const render = () => {
    let iterations = 0
    do {
      assert.ok(iterations++ < 15, 'surface effects must settle')
      changed = false; cursor = 0
      view = CsvSurface({ host, initialText: input, surfaceId: operation, t, appearance: { theme: 'dark' } })
      while (effects.length) effects.shift()()
    } while (changed)
    return view
  }
  render()
  return { calls, render, get view() { return view },
    edit(name, value, rerender = true) {
      view.edits[name]({ target: { value: String(value), checked: Boolean(value) } })
      if (rerender) render()
    },
    setDeferred(value) { deferredInput = value; render() },
    setProcessing(value) { processing = value; render() },
    async full() { await view.runFullProcess(); render() },
    draft: () => plain(Object.fromEntries(['sourceText', 'delimiter', 'header', 'output', 'minify', 'indent', 'tableName', 'dropEmpty', 'dedupe', 'transpose'].map((key) => [key, view[key]]))),
    replaceHost() { host = makeHost(); render() },
    unmount() { mounted = false; for (const slot of slots) slot?.cleanup?.() },
    replayEffects() { for (const slot of slots) if (slot?.setup) { slot.cleanup?.(); slot.cleanup = slot.setup() } },
  }
}
let passed = 0
async function check(name, run) {
  try { await run(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}
const csv = (rows) => 'name,value\n' + Array.from({ length: rows }, (_, i) => `row${i},${i}`).join('\n')
const expected = (input, mode = 'objects') => core.toOutput(core.parseSource(input).table, mode)

for (const viewName of ['table', 'output', 'source']) await check(`${viewName} returns all rows, ignoring selection and preview filtering`, async () => {
  const input = csv(1800), h = harness({ input })
  h.view.setMainView(viewName); h.view.setSelectedCell({ rowId: 0, columnKey: 'name' })
  h.view.setSelectedColumns(new Set(['name'])); h.view.setCellBlock({ start: { rowId: 0, columnKey: 'name' }, end: { rowId: 1, columnKey: 'name' } })
  h.view.setGlobalFilter('row1'); h.render()
  assert.equal(h.view.tableFull.rows.length, 1800)
  await h.view.returnOutput()
  assert.deepEqual(h.calls.handoff[0].block, { kind: 'text', text: expected(input), source: 'tool-result' })
  assert.equal(JSON.parse(h.calls.handoff[0].block.text).length, 1800)
  assert.equal(h.calls.copied.length + h.calls.complete + h.calls.back + h.calls.close, 0)
})
await check('SQL preview selection cannot become the returned result', async () => {
  const input = csv(30), h = harness({ input })
  h.view.setFilterMode('sql'); h.view.setSqlFilter('SELECT name FROM data LIMIT 1'); h.render()
  await h.view.returnOutput()
  assert.equal(h.calls.handoff[0].block.text, expected(input))
})
await check('8100 rows require a completed current full job and return the entire result', async () => {
  const input = csv(8100), h = harness({ input })
  assert.equal(h.view.canReturnOutput, false)
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 0)
  await h.full(); assert.equal(h.view.fullReturnReady, true)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff[0].block.text, expected(input))
  assert.equal(JSON.parse(h.calls.handoff[0].block.text).length, 8100)
})
await check('large single-row source is complete and returns directly below 1 MiB', async () => {
  const input = JSON.stringify([{ value: 'x'.repeat(512001) }]), h = harness({ input })
  assert.equal(h.view.tableFull.rows.length, 1)
  assert.equal(h.view.returnNeedsFullProcess, false)
  assert.equal(h.view.canReturnOutput, true)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff[0].block.text, expected(input))
})
await check('large one-line JSON reduced below the parse cap still requires full processing', async () => {
  const input = JSON.stringify(Array.from({ length: 8200 }, (_, i) => ({ value: i === 8199 ? 'tail' : 'x'.repeat(70) })))
  const h = harness({ input })
  h.edit('Dedupe', true)
  assert.equal(h.view.tableFull.rows.length, 1)
  assert.equal(h.view.canReturnOutput, false)
  await h.full(); await h.view.returnOutput()
  assert.equal(JSON.parse(h.calls.handoff[0].block.text).length, 2)
  assert.match(h.calls.handoff[0].block.text, /tail/)
})
await check('same length and edges cannot validate a stale full result', async () => {
  const input = csv(8100), h = harness({ input })
  await h.full()
  const fingerprint = h.view.jobFingerprint
  const changed = input.replace('row4000,4000', 'row4000,9000')
  // Deliberately retain the completed job to exercise the new exact identity gate,
  // independently of the source textarea's normal eager invalidation.
  h.view.updateResult(() => h.view.setSourceText(changed)); h.render()
  assert.equal(h.view.jobFingerprint, fingerprint)
  assert.equal(h.view.fullJobReady, true, 'legacy sampled fingerprint collides')
  assert.equal(h.view.fullReturnReady, false)
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 0)
  await h.full(); await h.view.returnOutput()
  assert.equal(h.calls.handoff[0].block.text, expected(changed))
})
for (const [name, value] of [['Delimiter', 'tab'], ['Header', 'no-header'], ['Output', 'csv'], ['Minify', true], ['Indent', 4], ['TableName', 'new_table'], ['DropEmpty', true], ['Dedupe', true], ['Transpose', true]]) {
  await check(`full output is stale after ${name} changes`, async () => {
    const h = harness({ input: csv(8100) })
    await h.full(); h.edit(name, value)
    assert.equal(h.view.fullReturnReady, false)
    // Some parsing parameters make the new input small enough to serialize directly.
    if (h.view.returnNeedsFullProcess) {
      await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 0)
    }
  })
}
for (const operation of ['to-ndjson', 'to-sql']) for (const large of [false, true]) await check(`${operation} accepts a legitimate empty ${large ? 'full' : 'small'} result`, async () => {
  const input = large ? JSON.stringify(Array.from({ length: 8100 }, () => ({}))) + ' '.repeat(256001) : '[]'
  const h = harness({ input, operation })
  if (large) { h.edit('DropEmpty', true); assert.equal(h.view.canReturnOutput, false); await h.full() }
  assert.equal(h.view.canReturnOutput, true)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff[0].block.text, '')
})
for (const [input, header] of [['[ \n ]', 'auto'], ['name,value', 'first-row']]) for (const operation of ['to-ndjson', 'to-sql']) await check(`${operation} preserves empty table output from ${JSON.stringify(input)}`, async () => {
  const h = harness({ input, operation })
  h.edit('Header', header)
  assert.equal(h.view.canReturnOutput, true)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff[0].block.text, '')
})
for (const finish of ['done', 'error', 'cancel', 'edit']) await check(`full processing ${finish} never returns an unfinished or stale snapshot`, async () => {
  const gate = deferred(), input = csv(8100)
  const h = harness({ input, process: async (...args) => { await gate.promise; return core.processFullSource(...args) } })
  const pending = h.view.runFullProcess(); h.render()
  assert.equal(h.view.fullJob.status, 'running')
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 0)
  if (finish === 'cancel') { h.view.cancelFullProcess(); h.render() }
  if (finish === 'edit') h.edit('Minify', true)
  if (finish === 'error') gate.reject(Error('failed full process'))
  else gate.resolve()
  await pending; h.render()
  if (finish === 'done') {
    await h.view.returnOutput(); assert.equal(h.calls.handoff[0].block.text, expected(input))
  } else {
    assert.equal(h.view.canReturnOutput, false)
    await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 0)
  }
})
for (const input of ['', ' \r\n\t', '\uFEFF  ', '"unterminated']) await check(`absent or invalid input ${JSON.stringify(input)} cannot return`, async () => {
  const h = harness({ input })
  assert.equal(h.view.canReturnOutput, false)
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 0)
})
for (const extra of [-1, 0, 1]) await check(`UTF-8 byte boundary ${1024 * 1024 + extra}`, async () => {
  const size = 1024 * 1024 + extra
  const contentBytes = size - 2 // CSV header 'v' and one newline.
  const value = '中'.repeat(Math.floor(contentBytes / 3)) + 'a'.repeat(contentBytes % 3)
  const h = harness({ input: JSON.stringify([{ v: value }]), operation: 'to-csv' })
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, extra <= 0 ? 1 : 0)
  if (extra <= 0) assert.equal(new TextEncoder().encode(h.calls.handoff[0].block.text).byteLength, size)
  else assert.deepEqual(h.calls.messages.at(-1), ['toast.returnTooLarge', 'error'])
})
await check('emoji use UTF-8 bytes and output growth is checked after serialization', async () => {
  const h = harness({ input: JSON.stringify([{ v: '🙂'.repeat(262144) }]), operation: 'to-csv' })
  await h.full(); await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 0)
  assert.equal(h.calls.messages.at(-1)[0], 'toast.returnTooLarge')
})
for (const outcome of [true, false, undefined, 'reject', 'throw']) await check(`receipt ${String(outcome)} preserves content and blocks double submission`, async () => {
  const receipt = deferred()
  const h = harness({ outcome: () => { if (outcome === 'throw') throw Error('sync failure'); return receipt.promise } })
  const before = h.draft(), old = h.view.returnOutput, pending = old()
  if (outcome !== 'throw') { await old(); h.render(); assert.equal(h.view.returning, true); assert.equal(h.calls.handoff.length, 1) }
  if (outcome === 'reject') receipt.reject(Error('async failure'))
  else receipt.resolve(outcome)
  await pending; h.render()
  assert.deepEqual(h.draft(), before)
  assert.equal(h.calls.complete + h.calls.back + h.calls.close, 0, 'host owns successful navigation')
  assert.equal(h.calls.navigation, outcome === true ? 1 : 0)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, outcome === true || outcome === undefined ? 1 : 2)
})
for (const [name, value] of [['SourceText', 'x,y\nnew,result'], ['Delimiter', 'tab'], ['Header', 'no-header'], ['Output', 'csv'], ['Minify', true], ['Indent', 4], ['TableName', 'new_table'], ['DropEmpty', true], ['Dedupe', true], ['Transpose', true]]) {
  for (const late of [true, false, 'reject']) await check(`${name} revokes before render and ignores late ${late}`, async () => {
    const receipts = [deferred(), deferred()]
    const h = harness({ outcome: () => receipts[h.calls.handoff.length - 1].promise })
    const old = h.view.returnOutput, pending = old()
    h.edit(name, value, false)
    assert.equal(h.calls.handoff[0].signal.aborted, true)
    await old(); assert.equal(h.calls.handoff.length, 1)
    h.render(); const current = h.view.returnOutput()
    await old(); assert.equal(h.calls.handoff.length, 2)
    if (late === 'reject') receipts[0].reject(Error('late error'))
    else receipts[0].resolve(late)
    await pending; h.render()
    assert.equal(h.view.returning, true)
    assert.equal(h.calls.messages.length + h.calls.navigation, 0)
    receipts[1].resolve(false); await current; h.render()
    assert.equal(h.view.returning, false)
  })
}
for (const action of ['requestBack', 'close', 'detachToWindow', 'unmount', 'replaceHost']) await check(`${action} aborts pending return and ignores late success`, async () => {
  const receipt = deferred(), h = harness({ outcome: () => receipt.promise })
  const old = h.view.returnOutput, pending = old()
  if (h[action]) h[action]()
  else h.view.exits[action]()
  assert.equal(h.calls.handoff[0].signal.aborted, true)
  await old(); assert.equal(h.calls.handoff.length, 1)
  receipt.resolve(true); await pending
  assert.equal(h.calls.navigation + h.calls.complete, 0)
  if (action === 'replaceHost') { assert.equal(h.view.returning, false); await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 2) }
})
await check('source deferred rendering and active parsing cannot return older rows', async () => {
  const input = csv(5), h = harness({ input })
  h.setDeferred(input); h.edit('SourceText', csv(6))
  assert.equal(h.view.canReturnOutput, false)
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 0)
  h.setDeferred(undefined); h.setProcessing(true)
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 0)
  h.setProcessing(false); await h.view.returnOutput()
  assert.equal(JSON.parse(h.calls.handoff[0].block.text).length, 6)
})
for (const result of ['load', 'reject', 'replaceHost', 'unmount']) await check(`file read ${result} cancels immediately and blocks old results while reading`, async () => {
  const receipt = deferred(), read = deferred(), h = harness({ outcome: () => receipt.promise })
  const old = h.view.returnOutput, pending = old()
  const loading = h.view.onFilePicked({ target: { files: [{ name: 'new.csv', text: () => read.promise }], value: 'file' } })
  assert.equal(h.calls.handoff[0].signal.aborted, true)
  await old(); h.render(); await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 1)
  assert.equal(h.view.readingFile, true)
  if (result === 'replaceHost') h.replaceHost()
  if (result === 'unmount') h.unmount()
  if (result === 'reject') read.reject(Error('read failed'))
  else read.resolve('x,y\nnew,result')
  receipt.resolve(true); await Promise.all([pending, loading])
  if (result !== 'unmount') h.render()
  assert.equal(h.calls.navigation + h.calls.complete, 0)
  assert.equal(h.view.sourceText, result === 'load' ? 'x,y\nnew,result' : 'name,value\none,1\ntwo,2')
  if (result !== 'unmount') assert.equal(h.view.readingFile, false)
})
await check('already-started copy keeps its previous completion and blocks return until settled', async () => {
  const copies = [deferred(), deferred()], receipt = deferred()
  const h = harness({ outcome: () => receipt.promise, copyOutcome: () => copies[h.calls.copied.length - 1].promise })
  const pending = h.view.returnOutput()
  h.view.handleCopyPrimary(); h.view.handleCopyPrimary(); h.render()
  assert.equal(h.calls.handoff[0].signal.aborted, true)
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 1)
  copies[0].resolve(); await new Promise((resolve) => setTimeout(resolve, 0))
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 1)
  copies[1].resolve(); await new Promise((resolve) => setTimeout(resolve, 0))
  receipt.resolve(true); await pending; h.render()
  assert.equal(h.calls.complete, 2)
  assert.deepEqual(h.calls.copied, [expected(h.view.sourceText), expected(h.view.sourceText)])
  assert.equal(h.calls.navigation, 0)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 2, 'return resumes after all copies settle')
})
await check('effect replay preserves an untouched result', async () => {
  const h = harness()
  h.replayEffects(); await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 1)
})
console.log(`CSV result return: ${passed} production-module logic scenarios passed`)
