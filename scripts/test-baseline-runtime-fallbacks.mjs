#!/usr/bin/env node
/** Host fallback contracts that must also work without desktop/idle APIs. */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, globals = {}) {
  const output = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
  }).outputText
  const exports = {}
  const sandbox = { exports, module: { exports }, ...globals }
  vm.runInNewContext(output, sandbox, { filename: path })
  return sandbox.module.exports
}

let nativeCalls = 0
const bridge = loadModule('src/workspace/desktopControl/bridgeTargets.ts', {
  window: {},
  require: (specifier) => {
    if (specifier === '@tauri-apps/api/core') return { invoke: () => { nativeCalls += 1 } }
    if (specifier === '../searchRanking') return {}
    throw new Error(`unexpected dependency: ${specifier}`)
  },
})
const targets = await bridge.listDesktopBridgeTargets('browser.chromium')
assert.ok(Array.isArray(targets), 'non-desktop target listing must return an array')
assert.equal(targets.length, 0)
assert.equal(nativeCalls, 0, 'non-desktop fallback must not invoke native commands')

let ran = 0
let idleCallback
let idleCancelled
const browserWindow = {
  requestIdleCallback(callback, options) {
    assert.equal(this, browserWindow, 'browser idle API keeps its Window receiver')
    assert.equal(options.timeout, 75)
    idleCallback = callback
    return 17
  },
  cancelIdleCallback(handle) {
    assert.equal(this, browserWindow)
    idleCancelled = handle
  },
}
const nativeIdle = loadModule('src/workspace/scheduleIdleWork.ts', {
  window: browserWindow,
  setTimeout: () => assert.fail('native idle path must not schedule a timeout'),
})
const cancelNative = nativeIdle.scheduleIdleWork(() => { ran += 1 }, 75)
assert.equal(ran, 0)
idleCallback()
assert.equal(ran, 1)
cancelNative()
assert.equal(idleCancelled, 17)

for (const browserGlobals of [{}, { window: {} }, { window: { requestIdleCallback: undefined } }]) {
  let timeoutCallback
  let timeoutCancelled
  const fallback = loadModule('src/workspace/scheduleIdleWork.ts', {
    ...browserGlobals,
    setTimeout(callback, delay) {
      assert.equal(delay, 50)
      timeoutCallback = callback
      return 23
    },
    clearTimeout(handle) { timeoutCancelled = handle },
  })
  const cancel = fallback.scheduleIdleWork(() => { ran += 1 }, 50)
  const before = ran
  assert.equal(typeof timeoutCallback, 'function')
  timeoutCallback()
  assert.equal(ran, before + 1)
  cancel()
  assert.equal(timeoutCancelled, 23)
}
console.log('baseline runtime fallback checks passed')
