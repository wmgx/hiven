#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function compile(rel) {
  return ts.transpileModule(readFileSync(rel, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, jsx: ts.JsxEmit.ReactJSX },
  }).outputText
}

function deferred() {
  let resolve
  const promise = new Promise((done) => { resolve = done })
  return { promise, resolve }
}

async function componentReadyRace() {
  let rendered = null
  let listener
  const effects = []
  const ready = deferred()
  const react = {
    useState(initial) {
      rendered = initial
      return [rendered, (next) => { rendered = typeof next === 'function' ? next(rendered) : next }]
    },
    useRef(value) { return { current: value } },
    useEffect(effect) { effects.push(effect) },
  }
  const module = { exports: {} }
  const dependencies = {
    react,
    'react/jsx-runtime': { jsx: () => null, jsxs: () => null },
    '@tauri-apps/api/core': { invoke: () => ready.promise },
    '@tauri-apps/api/event': { listen: (_event, callback) => { listener = callback; return Promise.resolve(() => {}) } },
    '../i18n': { translate: () => '' },
    './TextResultHud.css': {},
    './textResultHudUpdates': loadUpdates,
  }
  const requireFn = (specifier) => {
    if (specifier in dependencies) return dependencies[specifier]
    throw new Error(`Unexpected component import: ${specifier}`)
  }
  vm.runInNewContext(`(function(module, exports, require) { ${compile('src/components/TextResultHud.tsx')}\n})`, {
    module, exports: module.exports, require: requireFn, Promise,
  })(module, module.exports, requireFn)
  module.exports.TextResultHud()
  effects[0]()
  await Promise.resolve()
  await Promise.resolve()
  const base = { phase: 'active', truncated: false, copyFailed: false, complete: true, sensitive: false,
    expiresAt: 999999, locale: 'en', theme: 'dark' }
  const oldTranslation = { revision: 1, snapshot: { ...base, product: 'translation', sessionId: 'old', revision: 4, preview: 'old' }, fullText: 'old full text' }
  const currentQr = { revision: 2, snapshot: { ...base, product: 'qr-scan', sessionId: 'current', revision: 2, preview: 'current' }, fullText: 'current QR text' }
  listener({ payload: currentQr })
  ready.resolve(oldTranslation)
  await Promise.resolve()
  await Promise.resolve()
  const visible = rendered?.snapshot ?? rendered
  assert.equal(visible?.sessionId, 'current', 'an older ready response must not replace a newer product event')
}

let loadUpdates = {}
try {
  const module = { exports: {} }
  vm.runInNewContext(`(function(module, exports) { ${compile('src/components/textResultHudUpdates.ts')}\n})(module, exports)`, { module, exports: module.exports })
  loadUpdates = module.exports
} catch {
  // The initial red test deliberately runs before the ordered-update helper exists.
}

await componentReadyRace()

{
  const { acceptTextResultHudUpdate } = loadUpdates
  const current = acceptTextResultHudUpdate({ generation: -1, snapshot: null }, {
    revision: 2, snapshot: { sessionId: 'current' }, fullText: 'current',
  })
  const dismissed = acceptTextResultHudUpdate(current, { revision: 3, snapshot: null })
  const stale = acceptTextResultHudUpdate(dismissed, {
    revision: 2, snapshot: { sessionId: 'stale' }, fullText: 'stale sensitive text',
  })
  assert.equal(stale.snapshot, null, 'an older product update must not reopen after a newer dismissal')
}

const ownershipModule = { exports: {} }
vm.runInNewContext(`(function(module, exports) { ${compile('src/workspace/textResultHudOwnership.ts')}\n})`, {
  module: ownershipModule, exports: ownershipModule.exports, Promise, Symbol,
})(ownershipModule, ownershipModule.exports)
const { claimTextResultHud } = ownershipModule.exports
const blocked = deferred()
const cancellationEntered = deferred()
const ownerA = claimTextResultHud(Symbol('A'), () => {
  cancellationEntered.resolve()
  return blocked.promise
})
const leaseA = await ownerA.acquired
const ownerB = claimTextResultHud(Symbol('B'), async () => {})
await cancellationEntered.promise
ownerB.cancel()
blocked.resolve()
assert.equal(await ownerB.acquired, null, 'a cancelled pending claim must never acquire the HUD')
assert.equal(leaseA.isCurrent(), true, 'cancelling a pending replacement must preserve the current owner')

const replacement = claimTextResultHud(Symbol('C'), async () => {})
const leaseC = await replacement.acquired
leaseA.release()
assert.equal(leaseC.isCurrent(), true, 'releasing an old lease must not clear its replacement')
leaseC.release()

console.log('Text result HUD generation ordering and cancellable ownership races passed')
