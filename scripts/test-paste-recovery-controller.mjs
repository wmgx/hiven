#!/usr/bin/env node
// Actual controller/output flow; external delivery is a controlled asynchronous I/O.
import assert from 'node:assert/strict'
import { createServer } from 'vite'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import vm from 'node:vm'

const values = new Map()
const storage = { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }
globalThis.window = { localStorage: storage, sessionStorage: storage, addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) }
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const info = console.info
console.info = (...args) => { if (args[0] !== '[hiven:launcher-perf]') info(...args) }
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
try {
  const { LauncherController } = await server.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const { textResult, foregroundPasteResult } = await server.ssrLoadModule('/src/workspace/launcher/output.ts')
  const { getLastSaveableRun } = await server.ssrLoadModule('/src/workspace/savedActions/lastSaveableRun.ts')
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no }); return { promise, resolve, reject } }
  let mode = 'copied', wait, entered, closed = 0, nativeCalls = 0
  const guards = [], events = []
  const api = { copyText: async () => {}, returnToLauncher: async () => {}, pasteToForegroundApp: async () => {} }
  const controller = new LauncherController({
    surfaceId: 'global-launcher', api, locale: 'en', makeT: () => key => key, getSettings: () => ({}),
    recordSelection() {}, onChange() {}, requestClose() { closed++ }, appendExperienceEvent: event => events.push(event),
    makeApi(_item, current) {
      guards.push(current)
      return { ...api, async pasteToForegroundApp() {
        if (!current()) throw new Error('')
        nativeCalls++
        if (mode === 'copied') throw new Error('Copied, but not inserted. Paste manually.')
        if (mode === 'wait') { entered.resolve(); await wait.promise; if (!current()) throw new Error('') }
      } }
    },
  })
  const top = () => controller.getState().frames.at(-1)
  const item = (primary = false) => ({
    systemKey: 'host:paste-recovery:fixture', kind: 'host', display: { title: 'Synthetic paste' },
    behavior: { type: 'perform' }, inputPolicy: { mode: 'none' },
    execute: context => {
      const result = (primary ? foregroundPasteResult : textResult)('完整正文\nsecond line', context.api, 'en')
      result.output.choices.push({ id: 'other', title: 'Other', primaryAction: async () => {} })
      return result
    },
  })
  for (const primary of [false, true]) {
    controller.reset()
    await controller.selectItem(item(primary), { objectBlockText: "synthetic material" })
    assert.equal(top().kind, 'result', JSON.stringify(controller.getState()))
    const choice = top().output.choices[0]
    if (primary) await controller.activateChoice(choice)
    else await controller.activateSecondary(choice, 'paste-to-foreground-app')
    assert.equal(top().kind, 'result')
    assert.equal(top().output.choices[0].preview, '完整正文\nsecond line')
    assert.match(controller.getState().error, /Copied, but not inserted/)
    assert.equal(controller.getState().busy, false)
    assert.equal(closed, 0)
    assert.equal(events.filter(event => event.eventType === 'output.applied').length, 0)
    assert.equal(await getLastSaveableRun(), null)
  }
  const oldGuard = guards.at(-1)
  controller.reset()
  assert.equal(oldGuard(), false, 'API construction captures the old command generation')
  mode = 'wait'; wait = deferred(); entered = deferred()
  await controller.selectItem(item(), { objectBlockText: "synthetic material" })
  const oldChoice = top().output.choices[0]
  const pending = controller.activateSecondary(oldChoice, 'paste-to-foreground-app')
  await entered.promise
  controller.reset()
  await controller.selectItem(item(), { objectBlockText: "synthetic material" })
  const freshFrame = top()
  wait.reject(new Error('late old paste failed'))
  await pending
  assert.equal(top(), freshFrame)
  assert.equal(controller.getState().error, null, 'late failure cannot contaminate a new flow')
  assert.equal(closed, 0)
  mode = 'success'
  await controller.activateSecondary(freshFrame.output.choices[0], 'paste-to-foreground-app')
  assert.equal(closed, 1, 'successful delivery keeps the existing controller close contract')
  assert.equal(nativeCalls, 4)
  console.log('PASS paste recovery actual controller: primary/secondary copied retention, stale API, late failure, success')
} finally { await server.close(); console.info = info }

// Execute the real History delivery callback without rendering or testing styles.
const file = ts.createSourceFile('history.tsx', readFileSync('src/plugins/clipboard-history/surfaces/ClipboardHistorySurface.tsx', 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
let callback
function visit(node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(file) === 'handlePaste' && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0].getText(file)
  ts.forEachChild(node, visit)
}
visit(file)
assert.ok(callback)
const js = ts.transpileModule(`const run = ${callback}; globalThis.run = run`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText
for (const result of [{ ok: true }, { ok: false, fallback: 'copied', message: 'copied only' }, { ok: false, fallback: 'none', message: 'write failed' }, { ok: false, fallback: 'none', message: '' }, { ok: false, fallback: 'copied', message: 'late failure', stale: true }]) {
  let reset = 0, complete = 0, recorded = 0
  const messages = []
  const context = { combining: false, pasteNoticeGenerationRef: { current: 0 }, setPasteNotice: message => { if (message) messages.push([message]) }, t: key => key, resetBrowser() { reset++ },
    repository: { recordPaste: async () => { recorded++ } },
    host: { paste: { pasteText: async text => { assert.equal(text, 'current full text'); if (result.stale) context.pasteNoticeGenerationRef.current++; return result } }, complete() { complete++ }, showMessage: (...args) => messages.push(args) } }
  vm.createContext(context); vm.runInContext(js, context)
  await context.run({ id: 'synthetic', kind: 'text', text: 'current full text' })
  assert.equal(reset, result.ok ? 1 : 0)
  assert.equal(complete, result.ok ? 1 : 0)
  assert.equal(recorded, result.ok ? 1 : 0)
  assert.equal(messages.length, result.ok || !result.message || result.stale ? 0 : 1)
}
console.log('PASS actual History callback: only inserted results clear selection, record usage, or complete')
