#!/usr/bin/env node
/**
 * Baidu translate response parsing: 52000 is success, 54004 is quota, HTTP errors fail.
 */
import assert from 'node:assert/strict'
import { adapters } from './translate-test-harness.mjs'

const { baiduFailureMessage, isAutoTranslateReady, translateWithAi } = adapters

assert.equal(typeof baiduFailureMessage, 'function', 'baiduFailureMessage must be exported')
assert.equal(baiduFailureMessage(200, { trans_result: [{ src: 'hello', dst: '你好' }] }), null)
assert.equal(baiduFailureMessage(200, { error_code: '52000', trans_result: [{ src: 'hello', dst: '你好' }] }), null)
assert.equal(baiduFailureMessage(200, { error_code: 52000, trans_result: [{ src: 'hello', dst: '你好' }] }), null)
assert.equal(baiduFailureMessage(200, { error_code: '0' }), null)

const quota = baiduFailureMessage(200, { error_code: '54004', error_msg: 'Account balance is insufficient' })
assert.match(String(quota), /54004/)
assert.match(String(quota), /insufficient|balance/i)

const unauthorized = baiduFailureMessage(200, { error_code: '52003', error_msg: 'UNAUTHORIZED USER' })
assert.match(String(unauthorized), /52003/)

const httpFail = baiduFailureMessage(502, { error_msg: 'Bad Gateway' })
assert.equal(httpFail, 'Bad Gateway')

assert.equal(isAutoTranslateReady('你好'), true, 'two Chinese characters must translate')
assert.equal(isAutoTranslateReady('hi'), true, 'two Latin letters must translate')
assert.equal(isAutoTranslateReady('好'), true, 'single character must translate')
assert.equal(isAutoTranslateReady('a'), true, 'single Latin letter must translate')
assert.equal(isAutoTranslateReady('  hi  '), true, 'trim before counting')
assert.equal(isAutoTranslateReady('  '), false, 'whitespace-only stays idle')
assert.equal(isAutoTranslateReady(''), false, 'empty stays idle')

const aiPrompts = []
const aiRequests = []
const previews = []
const controller = new AbortController()
const aiResult = await translateWithAi({ text: '你好', sourceLang: 'auto', targetLang: 'en' }, { aiProviderId: 'system-ai', aiAgentId: 'translator', aiEffort: 'high' }, {
  async *stream(request) {
    aiRequests.push(request)
    aiPrompts.push(request.input[0].text)
    yield { type: 'text.delta', runId: '1', delta: 'Hel' }
    yield { type: 'text.delta', runId: '1', delta: 'lo' }
    yield { type: 'completed', runId: '1', status: 'completed' }
  },
}, { signal: controller.signal, onText: (text) => previews.push(text) })
assert.equal(aiResult.text, 'Hello')
assert.equal(aiResult.billedChars, 2)
assert.match(aiPrompts[0], /Return only the translation/)
assert.equal(aiRequests[0].providerId, 'system-ai')
assert.equal(aiRequests[0].agentId, 'translator')
assert.equal(aiRequests[0].effort, 'high')
assert.equal(aiRequests[0].signal, controller.signal, 'AI translation forwards the caller signal')
assert.deepEqual(previews, ['Hel', 'Hello'], 'each delta produces an unfinished accumulated preview')
assert.deepEqual(Array.from(aiRequests[0].capabilities), ['text.generate'])

const request = { text: '你好', sourceLang: 'auto', targetLang: 'en' }
const aiSelection = { providerId: 'fixture-provider', agentId: 'fixture-model' }
const delta = (text) => ({ type: 'text.delta', runId: 'run', delta: text })
const completed = { type: 'completed', runId: 'run', status: 'completed' }
const cancelled = { ...completed, status: 'cancelled' }
const failure = { type: 'error', runId: 'run', code: 'test', message: 'Provider failed' }
const aborted = (error) => error.name === 'AbortError'
const streamError = (code) => (error) => error.name === 'AiTranslationError' && error.code === code

async function checkTerminal(events, acceptsError) {
  const output = []
  let cleaned = false
  const pending = translateWithAi(request, {}, {
    async *stream() {
      try { yield* events } finally { cleaned = true }
    },
  }, { aiSelection, onText: (text) => output.push(text) })
  await assert.rejects(pending, acceptsError)
  assert.equal(cleaned, true, 'terminal failure closes the iterator')
  return output
}
assert.deepEqual(await checkTerminal([delta('partial'), cancelled, delta('late')], aborted), ['partial'])
assert.deepEqual(await checkTerminal([delta('partial')], streamError('incomplete')), ['partial'], 'EOF must never promote preview to success')
assert.deepEqual(await checkTerminal([delta('partial'), failure], /Provider failed/), ['partial'])
await checkTerminal([completed], streamError('empty'))
await checkTerminal([delta('  \n '), completed], streamError('empty'))
await checkTerminal([], streamError('incomplete'))

let opened = 0
await assert.rejects(translateWithAi(request, {}, { stream() { opened += 1; throw new Error('Must not open') } }), streamError('selection'))
assert.equal(opened, 0, 'missing concrete provider/model rejects without opening a stream')
controller.abort()
await assert.rejects(translateWithAi(request, {}, { stream() { opened += 1; throw new Error('Must not open') } }, { signal: controller.signal }), aborted)
assert.equal(opened, 0, 'pre-aborted translation never opens a stream')

const midController = new AbortController()
const midPreviews = []
let midCleaned = false
await assert.rejects(translateWithAi(request, {}, {
  async *stream() {
    try {
      yield delta('partial')
      midController.abort()
      yield delta('late')
      yield completed
    } finally { midCleaned = true }
  },
}, { aiSelection, signal: midController.signal, onText: (text) => midPreviews.push(text) }), aborted)
assert.deepEqual(midPreviews, ['partial'], 'late deltas after abort never reach the preview')
assert.equal(midCleaned, true)

let finishCleanup
const cleanup = new Promise((resolve) => { finishCleanup = resolve })
const ordered = []
let nextCalls = 0
const terminalPreviews = []
const events = [delta('complete'), completed, delta('late'), failure]
let resolved = false
const terminalResult = translateWithAi(request, {}, {
  stream() {
    return {
      [Symbol.asyncIterator]() { return this },
      async next() { ordered.push('next'); return { value: events[nextCalls++], done: false } },
      async return() { ordered.push('cleanup-start'); await cleanup; ordered.push('cleanup-end'); return { done: true } },
    }
  },
}, { aiSelection, onText: (text) => terminalPreviews.push(text) }).then((result) => { resolved = true; return result })
await new Promise((resolve) => setImmediate(resolve))
assert.equal(resolved, false, 'success waits for iterator cleanup')
assert.equal(nextCalls, 2, 'completed immediately stops pulling late delta/error events')
assert.deepEqual(ordered, ['next', 'next', 'cleanup-start'])
finishCleanup()
assert.equal((await terminalResult).text, 'complete')
assert.deepEqual(terminalPreviews, ['complete'])
assert.deepEqual(ordered, ['next', 'next', 'cleanup-start', 'cleanup-end'])

console.log('translate Baidu response and AI stream lifecycle checks passed')
