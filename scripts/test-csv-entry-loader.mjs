import assert from 'node:assert/strict'
import fs from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'
const compiled = ts.transpileModule(fs.readFileSync('src/plugins/csv/entryLoader.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports, Error, URL, setTimeout, clearTimeout })
const { createEntryLoader, EntryStylesheetError, identifyStylesheetFailure, reloadStylesheet } = module.exports
const link = { getAttribute: () => '/assets/grid.css', href: 'https://example.test/assets/grid.css' }
const doc = { baseURI: 'https://example.test/', querySelectorAll: () => [link] }
assert.ok(identifyStylesheetFailure(new Error('Unable to preload CSS for /assets/grid.css'), doc) instanceof EntryStylesheetError)
assert.equal(identifyStylesheetFailure(new Error('render failed'), doc), undefined)
assert.equal(identifyStylesheetFailure(new Error('Unable to preload CSS for /other.css'), doc), undefined)
let loads = 0, repairs = 0, release
const loader = createEntryLoader(async () => { if (++loads === 1) throw new Error('preload'); return 'module' }, () => new EntryStylesheetError(link), async () => { repairs++; await new Promise(resolve => { release = resolve }) })
await assert.rejects(loader.read(), EntryStylesheetError)
await assert.rejects(loader.read(), EntryStylesheetError)
assert.equal(loads, 1)
const retry = loader.retry()
assert.equal(loader.retry(), retry)
assert.equal(repairs, 1)
release()
assert.equal(await retry, 'module')
assert.equal(await loader.read(), 'module')
assert.equal(loads, 2)
let attempts = 0
const persistent = createEntryLoader(async () => { attempts++; throw new Error('preload') }, () => new EntryStylesheetError(link), async () => { throw new EntryStylesheetError(link) })
await assert.rejects(persistent.read())
await assert.rejects(persistent.retry())
await assert.rejects(persistent.retry())
assert.equal(attempts, 1)
const runtime = new Error('module evaluation')
const fatal = createEntryLoader(async () => { throw runtime }, () => undefined, async () => { assert.fail('not repairable') })
await assert.rejects(fatal.read(), error => error === runtime)
await assert.rejects(fatal.retry(), error => error === runtime)
let originalRemoved = false, replacementRemoved = false, replacement
const original = { cloneNode: () => replacement = { remove() { replacementRemoved = true } }, remove() { originalRemoved = true }, ownerDocument: { head: { appendChild() {} } } }
const failedReload = reloadStylesheet(original)
replacement.onerror()
await assert.rejects(failedReload, EntryStylesheetError)
assert.equal(originalRemoved, false)
assert.equal(replacementRemoved, true)
const success = reloadStylesheet(original)
replacement.onload()
await success
assert.equal(originalRemoved, true)
console.log('PASS entry failure classification, cache repair ordering, retry deduplication, persistent failure, runtime errors, stylesheet cleanup')
