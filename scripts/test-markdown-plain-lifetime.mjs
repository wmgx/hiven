// Controlled worker completions, not a browser or native UI test.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
let state, effect, deps, cleanup, nextEffect
const workers = [], timers = []
class Worker {
  constructor() { workers.push(this) }
  postMessage(input) { this.input = input }
  terminate() { this.stopped = true }
  reply(text) { this.onmessage({ data: { status: 'ready', text } }) }
}
const exports = {}
vm.runInNewContext(ts.transpileModule(readFileSync('src/plugins/line-tools/useMarkdownPlainText.ts', 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}}).outputText, {
  exports, Error,
  setTimeout(fn) { timers.push(fn); return fn }, clearTimeout() {},
  require(name) {
    if (name === 'react') return {
      useState() { return [state, next => { state = next }] },
      useLayoutEffect(fn, next) { if (!deps || next.some((item, index) => !Object.is(item, deps[index]))) { effect = fn; nextEffect = next } },
    }
    if (name.includes('?worker')) return {__esModule: true, default: Worker}
    if (name === './markdownPlainText') return {checkMarkdownInput(text) { if (text.length > 20) throw Error('limit') }}
    throw Error(name)
  },
})
function render(text, revision, enabled = true) {
  effect = undefined
  const result = exports.useMarkdownPlainText(text, enabled, revision, 'Image')
  if (effect) { cleanup?.(); deps = nextEffect; cleanup = effect() }
  return result
}
assert.equal(render('old', 0).status, 'processing')
workers[0].reply('OLD'); assert.equal(render('old', 0).text, 'OLD')
assert.equal(render('new', 1).status, 'processing'); assert.equal(workers[0].stopped, true)
workers[0].reply('LATE'); assert.equal(render('new', 1).status, 'processing')
workers[1].reply('NEW'); assert.equal(render('new', 1).text, 'NEW')
assert.equal(render('new', 2).status, 'processing') // Cancelled Back gets a fresh generation.
timers.at(-1)(); assert.equal(render('new', 2).messageKey, 'markdownPlain.timeout'); assert.equal(workers.at(-1).stopped, true)
render('x'.repeat(21), 3); assert.equal(render('x'.repeat(21), 3).messageKey, 'markdownPlain.limit')
assert.equal(render('fixed', 4).status, 'processing'); workers.at(-1).reply('FIXED'); assert.equal(render('fixed', 4).text, 'FIXED')
render('unmount', 5); cleanup(); workers.at(-1).reply('LATE UNMOUNT'); assert.equal(state.result.text, 'FIXED')
console.log('Markdown worker cancellation, late-result rejection, timeout, bounded failure and correction passed (controlled worker).')
