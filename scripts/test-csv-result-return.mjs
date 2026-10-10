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
const exits = {}, edits = {}, queryEdits = {}
let clearSelection
const inspect = (node) => {
  if (ts.isJsxAttribute(node) && node.initializer && ts.isJsxExpression(node.initializer)) {
    const expression = node.initializer.expression?.getText(file) ?? ''
    const setter = expression.match(/set(SourceText|Delimiter|Header|Output|Minify|Indent|TableName|DropEmpty|Dedupe|Transpose)\(/)?.[1]
    if (setter) {
      assert.match(expression, /updateResult\(/, `${setter} must revoke a pending snapshot before its state update`)
      edits[setter] = expression
    }
    const querySetter = expression.includes('setGlobalFilter(event.target.value)') ? 'GlobalFilter'
      : expression.includes('setSqlFilter(el.value)') ? 'SqlFilter'
      : expression.includes("const next = value as 'text' | 'sql'") ? 'FilterMode' : null
    if (querySetter) {
      assert.match(expression, /updateResult\(/, `${querySetter} must revoke the previous result before updating`)
      queryEdits[querySetter] = expression
    }
    if (expression.includes('setSelectedColumns(new Set())') && expression.includes('setSortColumns([])')) clearSelection = expression
    for (const name of ['requestBack', 'close', 'detachToWindow']) {
      if (expression.includes(`host.${name}(`)) exits[name] = expression
    }
  }
  ts.forEachChild(node, inspect)
}
inspect(returned)
assert.equal(Object.keys(queryEdits).length, 3, 'all query controls revoke the previous result')
assert.ok(clearSelection, 'the existing clear action is exercised')
assert.equal(Object.keys(edits).length, 10, 'all source, parsing, transform and output controls are exercised')
const fields = [
  'sourceText', 'delimiter', 'header', 'output', 'minify', 'indent', 'tableName', 'dropEmpty', 'dedupe', 'transpose',
  'outputText', 'tableFull', 'fullJob', 'fullJobReady', 'fullOutputRef', 'jobFingerprint', 'fullReturnReady',
  'returnNeedsFullProcess', 'canReturnOutput', 'returning', 'returnOutput', 'runFullProcess', 'cancelFullProcess',
  'onFilePicked', 'readingFile', 'handleCopyPrimary', 'downloadFullResult', 'updateResult', 'setSourceText',
  'setSelectedCell', 'setSelectedColumns', 'setCellBlock', 'setGlobalFilter', 'setSqlFilter', 'setFilterMode', 'setMainView',
  'filterMode', 'globalFilter', 'sqlFilter', 'sortColumns', 'cycleSort', 'applySqlCompletion', 'sqlCompletions',
  'finalTable', 'table', 'tableHeaders', 'displayGridRows', 'filterError', 'canCopyOutput', 'copyFullOutput',
]
const probe = `({ ${fields.join(', ')}, clearSelection: ${clearSelection}, queryEdits: { ${Object.entries(queryEdits).map(([name, fn]) => `${name}: ${fn}`).join(', ')} }, edits: { ${Object.entries(edits).map(([name, fn]) => `${name}: ${fn}`).join(', ')} }, exits: { ${Object.entries(exits).map(([name, fn]) => `${name}: ${fn}`).join(', ')} } })`
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
const sql = load('src/plugins/csv/csvSqlFilter.ts', {})
const core = load('src/plugins/csv/csvCore.ts', { './csvSqlFilter': sql })
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const plain = (value) => JSON.parse(JSON.stringify(value))
function harness({ input = 'name,value\none,1\ntwo,2', operation = 'to-json', outcome = () => true, copyOutcome = () => Promise.resolve(), process = core.processFullSource } = {}) {
  const slots = [], effects = []
  let cursor = 0, view, mounted = true, changed = false, deferredInput, processing = false
  const calls = { handoff: [], messages: [], copied: [], downloads: [], navigation: 0, complete: 0, back: 0, close: 0, detach: 0 }
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
    './csvCore': { ...core, processFullSource: process, downloadTextFile: (filename, text) => calls.downloads.push({ filename, text }) }, './csvSqlFilter': sql,
  }, source, { requestAnimationFrame: (fn) => fn(), window: { addEventListener() {}, removeEventListener() {} }, navigator: { clipboard: { writeText: () => Promise.reject(Error('no browser clipboard')) } } })
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
    query(values, rerender = true) {
      if ('filterMode' in values) view.queryEdits.FilterMode(values.filterMode)
      if ('globalFilter' in values) view.queryEdits.GlobalFilter({ target: { value: values.globalFilter } })
      if ('sqlFilter' in values) view.queryEdits.SqlFilter({ target: { value: values.sqlFilter, selectionStart: values.sqlFilter.length } })
      if (rerender) render()
    },
    sort(key, rerender = true) { view.cycleSort(key); if (rerender) render() },
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

for (const viewName of ['table', 'output', 'source']) await check(`${viewName} returns the final text-filtered result independent of selection`, async () => {
  const input = csv(1800), h = harness({ input })
  h.query({ globalFilter: 'row1' })
  h.view.setMainView(viewName); h.view.setSelectedCell({ rowId: 0, columnKey: 'name' })
  h.view.setSelectedColumns(new Set(['name'])); h.view.setCellBlock({ start: { rowId: 0, columnKey: 'name' }, end: { rowId: 1, columnKey: 'name' } })
  h.render()
  const queried = core.applyTableQuery(core.parseSource(input).table, { filterMode: 'text', globalFilter: 'row1' })
  assert.equal(queried.ok, true)
  await h.view.returnOutput()
  assert.deepEqual(h.calls.handoff[0].block, { kind: 'text', text: core.toOutput(queried.table, 'objects'), source: 'tool-result' })
  assert.equal(h.calls.copied.length + h.calls.complete + h.calls.back + h.calls.close, 0)
})
await check('SQL projection and limit become the returned final result', async () => {
  const h = harness({ input: csv(30) })
  h.query({ filterMode: 'sql', sqlFilter: 'SELECT name FROM data ORDER BY value DESC LIMIT 1' })
  await h.view.returnOutput()
  assert.deepEqual(JSON.parse(h.calls.handoff[0].block.text), [{ name: 'row29' }])
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
  assert.equal(h.view.fullJobReady, false, 'exact snapshot identity rejects the sampled fingerprint collision')
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
await check('full copy blocks double clicks and return until settled', async () => {
  const copy = deferred(), receipt = deferred()
  const h = harness({ outcome: () => receipt.promise, copyOutcome: () => copy.promise })
  const pending = h.view.returnOutput()
  h.view.handleCopyPrimary(); h.view.handleCopyPrimary(); h.render()
  assert.equal(h.calls.handoff[0].signal.aborted, true)
  await h.view.returnOutput(); assert.equal(h.calls.handoff.length, 1)
  copy.resolve(); await new Promise((resolve) => setTimeout(resolve, 0))
  receipt.resolve(true); await pending; h.render()
  assert.equal(h.calls.complete, 1)
  assert.deepEqual(h.calls.copied, [expected(h.view.sourceText)])
  assert.equal(h.calls.navigation, 0)
  await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 2, 'return resumes after the copy settles')
})
for (const action of ['edit', 'unmount', 'replaceHost']) await check(`late copy cannot complete after ${action}`, async () => {
  const copy = deferred(), h = harness({ copyOutcome: () => copy.promise })
  h.view.handleCopyPrimary()
  if (action === 'edit') h.query({ globalFilter: 'one' })
  else h[action]()
  copy.resolve(); await new Promise((resolve) => setTimeout(resolve, 0))
  assert.equal(h.calls.complete, 0)
  assert.equal(h.calls.messages.length, 0)
})
await check('filtering beyond both preview caps feeds the same grid, copy, return and download', async () => {
  const h = harness({ input: csv(8105) })
  h.query({ globalFilter: 'row8104' })
  assert.equal(h.view.finalTable, null)
  assert.equal(h.view.displayGridRows.length, 0)
  assert.equal(h.view.canCopyOutput, false)
  h.view.handleCopyPrimary(); h.view.downloadFullResult(); await h.view.returnOutput()
  assert.equal(h.calls.copied.length + h.calls.downloads.length + h.calls.handoff.length, 0)
  await h.full()
  assert.equal(h.view.finalTable.rows.length, 1)
  assert.equal(h.view.displayGridRows[0].name, 'row8104')
  h.view.downloadFullResult()
  h.view.handleCopyPrimary(); await new Promise((resolve) => setTimeout(resolve, 0)); h.render()
  await h.view.returnOutput()
  const text = JSON.stringify([{ name: 'row8104', value: '8104' }], null, 2)
  assert.equal(h.calls.copied[0], text)
  assert.equal(h.calls.downloads[0].text, text)
  assert.equal(h.calls.handoff[0].block.text, text)
})
await check('SQL limit and header sort run before the grid and output preview slices', async () => {
  const h = harness({ input: csv(8105) })
  h.query({ filterMode: 'sql', sqlFilter: 'SELECT name, value FROM data WHERE value >= 8100 ORDER BY value DESC LIMIT 3' })
  h.sort('value')
  await h.full()
  assert.deepEqual(plain(h.view.finalTable.rows), [['row8102', '8102'], ['row8103', '8103'], ['row8104', '8104']])
  assert.deepEqual(plain(h.view.tableHeaders), ['name', 'value'])
  await h.view.returnOutput()
  assert.equal(JSON.parse(h.calls.handoff[0].block.text).length, 3)
})
await check('small complete tables query rows beyond the 5000-row grid limit', async () => {
  const h = harness({ input: csv(6000) })
  assert.equal(h.view.displayGridRows.length, 5000)
  h.query({ globalFilter: 'row5999' })
  assert.equal(h.view.displayGridRows[0].name, 'row5999')
  assert.equal(h.view.finalTable.rows.length, 1)
})
await check('a column first found after the parse cap is validated by the full query', async () => {
  const input = JSON.stringify(Array.from({ length: 8105 }, (_, i) => i === 8104 ? { value: 'tail', extra: 'found' } : { value: 'x'.repeat(40) }))
  const h = harness({ input })
  h.query({ filterMode: 'sql', sqlFilter: "SELECT extra FROM data WHERE extra = 'found'" })
  assert.equal(h.view.returnNeedsFullProcess, true)
  await h.full()
  assert.equal(h.view.fullJob.status, 'done')
  assert.deepEqual(plain(h.view.finalTable), { headers: ['extra'], rows: [['found']] })
  assert.ok(h.view.tableHeaders.includes('value'))
})
await check('invalid SQL disables every complete output until it is fixed in place', async () => {
  const h = harness()
  h.query({ filterMode: 'sql', sqlFilter: 'SELECT absent FROM data' })
  assert.ok(h.view.filterError)
  assert.equal(h.view.canCopyOutput, false)
  assert.equal(h.view.canReturnOutput, false)
  assert.deepEqual(plain(h.view.table.headers), ['name', 'value'])
  h.view.handleCopyPrimary(); h.view.downloadFullResult(); await h.view.returnOutput()
  assert.equal(h.calls.copied.length + h.calls.downloads.length + h.calls.handoff.length, 0)
  h.query({ sqlFilter: 'SELECT name FROM data LIMIT 1' })
  assert.equal(h.view.filterError, null)
  assert.equal(h.view.canReturnOutput, true)
  assert.deepEqual(plain(h.view.finalTable.rows), [['one']])
})
for (const operation of ['to-ndjson', 'to-sql']) await check(`${operation} shares a legitimate SQL zero-row result across every output`, async () => {
  const h = harness({ operation })
  h.query({ filterMode: 'sql', sqlFilter: 'SELECT name FROM data WHERE value > 99' })
  assert.equal(h.view.finalTable.rows.length, 0)
  assert.deepEqual(plain(h.view.table.headers), ['name'])
  assert.deepEqual(plain(h.view.tableHeaders), ['name', 'value'])
  h.view.downloadFullResult()
  h.view.handleCopyPrimary(); await new Promise((resolve) => setTimeout(resolve, 0)); h.render()
  await h.view.returnOutput()
  assert.deepEqual(h.calls.copied, [''])
  assert.equal(h.calls.downloads[0].text, '')
  assert.equal(h.calls.handoff[0].block.text, '')
})
for (const control of ['filterMode', 'globalFilter', 'sqlFilter', 'sort']) await check(`${control} immediately invalidates full output and a pending handoff`, async () => {
  const receipt = deferred(), h = harness({ input: csv(8105), outcome: () => receipt.promise })
  await h.full()
  const previousFingerprint = h.view.jobFingerprint
  const oldDownload = h.view.downloadFullResult, oldReturn = h.view.returnOutput, pending = oldReturn()
  if (control === 'sort') h.sort('value', false)
  else h.query({ [control]: control === 'filterMode' ? 'sql' : control === 'globalFilter' ? 'row8104' : 'SELECT name FROM data LIMIT 1' }, false)
  assert.equal(h.calls.handoff[0].signal.aborted, true)
  oldDownload(); await oldReturn()
  assert.equal(h.calls.downloads.length, 0)
  assert.equal(h.calls.handoff.length, 1)
  h.render()
  assert.notEqual(h.view.jobFingerprint, previousFingerprint)
  assert.equal(h.view.fullJobReady, false)
  assert.equal(h.view.canReturnOutput, false)
  receipt.resolve(true); await pending; h.render()
  assert.equal(h.calls.navigation, 0)
  assert.equal(h.view.fullJob.status, 'idle')
})
await check('SQL completion revokes a pending result and uses source columns', async () => {
  const h = harness()
  h.query({ filterMode: 'sql', sqlFilter: 'SELECT name FROM data' })
  h.view.queryEdits.SqlFilter({ target: { value: 'SELECT na FROM data', selectionStart: 9 } }); h.render()
  const completion = h.view.sqlCompletions.items.find((item) => item.label === 'name')
  assert.ok(completion)
  h.view.applySqlCompletion(completion); h.render()
  assert.equal(h.view.filterError, null)
  assert.equal(h.view.sqlFilter, 'SELECT name FROM data')
})
await check('clearing only a selection preserves a completed full result', async () => {
  const h = harness({ input: csv(8105) })
  await h.full()
  h.view.setSelectedColumns(new Set(['name'])); h.render()
  h.view.clearSelection(); h.render()
  assert.equal(h.view.fullJobReady, true)
  assert.equal(h.view.canReturnOutput, true)
})
for (const oldOutcome of ['resolve', 'reject']) await check(`a cancelled job cannot overwrite a new job through late progress or ${oldOutcome}`, async () => {
  const gates = [deferred(), deferred()], jobs = [], input = csv(8105)
  const table = core.parseSource(input).table
  const result = { table, sourceHeaders: table.headers, output: expected(input), rowCount: table.rows.length, colCount: table.headers.length }
  const h = harness({ input, process: async (_text, _options, hooks) => { jobs.push(hooks); return gates[jobs.length - 1].promise } })
  const oldRun = h.view.runFullProcess, old = oldRun()
  await oldRun(); assert.equal(jobs.length, 1, 'double click starts one job')
  h.render(); h.view.cancelFullProcess(); h.render()
  const current = h.view.runFullProcess(); h.render()
  jobs[1].onProgress({ phase: 'transform', ratio: 0.45 }); h.render()
  jobs[0].onProgress({ phase: 'output', ratio: 1 })
  if (oldOutcome === 'resolve') gates[0].resolve(result)
  else gates[0].reject(Error('late old failure'))
  await old; h.render()
  assert.equal(h.view.fullJob.status, 'running')
  assert.equal(h.view.fullJob.ratio, 0.45)
  gates[1].resolve(result); await current; h.render()
  assert.equal(h.view.fullJobReady, true)
})
await check('copying raw source while a full job runs does not strand its progress', async () => {
  const gate = deferred(), input = csv(8105), jobs = []
  const table = core.parseSource(input).table
  const h = harness({ input, process: async (_text, _options, hooks) => { jobs.push(hooks); return gate.promise } })
  const pending = h.view.runFullProcess(); h.render()
  h.view.setMainView('source'); h.render(); h.view.handleCopyPrimary()
  await new Promise((resolve) => setTimeout(resolve, 0)); h.render()
  jobs[0].onProgress({ phase: 'transform', ratio: 0.5 }); h.render()
  assert.equal(h.view.fullJob.ratio, 0.5)
  gate.resolve({ table, sourceHeaders: table.headers, output: expected(input), rowCount: table.rows.length, colCount: table.headers.length })
  await pending; h.render()
  assert.equal(h.view.fullJobReady, true)
  assert.deepEqual(h.calls.copied, [input])
  assert.equal(h.calls.complete, 0)
})
await check('replacing a host resets a running job and ignores its late completion', async () => {
  const gate = deferred(), jobs = []
  const h = harness({ input: csv(8105), process: async (_text, _options, hooks) => { jobs.push(hooks); return gate.promise } })
  const pending = h.view.runFullProcess(); h.render(); h.replaceHost()
  assert.equal(jobs[0].signal.aborted, true)
  assert.equal(h.view.fullJob.status, 'idle')
  jobs[0].onProgress({ phase: 'output', ratio: 1 }); gate.resolve({ output: 'old' })
  await pending; h.render()
  assert.equal(h.view.fullJob.status, 'idle')
  assert.equal(h.view.fullOutputRef.current, null)
})
await check('raw-source copy and cell copy retain their distinct meanings', async () => {
  const input = csv(3), source = harness({ input })
  source.query({ globalFilter: 'row1' })
  source.view.setMainView('source'); source.render(); source.view.handleCopyPrimary()
  await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(source.calls.copied, [input])
  assert.equal(source.calls.complete, 0)
  const cell = harness({ input })
  cell.query({ globalFilter: 'row1' })
  cell.view.setMainView('table'); cell.view.setSelectedCell({ rowId: 0, columnKey: 'name' }); cell.render()
  cell.view.handleCopyPrimary(); await new Promise((resolve) => setTimeout(resolve, 0))
  assert.deepEqual(cell.calls.copied, ['row1'])
  assert.equal(cell.calls.complete, 0)
})
await check('effect replay preserves an untouched result', async () => {
  const h = harness()
  h.replayEffects(); await h.view.returnOutput()
  assert.equal(h.calls.handoff.length, 1)
})
console.log(`CSV result return: ${passed} production-module logic scenarios passed`)
