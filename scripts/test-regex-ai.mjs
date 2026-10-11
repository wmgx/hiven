import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import ts from 'typescript'

// Pure session/contract checks with simulated providers; never call a real model.
const scratch = await mkdtemp(join(tmpdir(), 'hiven-regex-ai-'))
try {
  for (const name of ['aiCandidate', 'aiCandidateSession', 'regexExecution']) {
    let source = await readFile(new URL(`../src/plugins/regex-tester/${name}.ts`, import.meta.url), 'utf8')
    source = source.replace("import InlineRegexWorker from './regex.worker?worker&inline'", 'const InlineRegexWorker = class { constructor() { throw new Error("Inject execution") } }')
      .replace("'./aiCandidate'", "'./aiCandidate.mjs'").replace("'./regexExecution'", "'./regexExecution.mjs'")
    await writeFile(join(scratch, `${name}.mjs`), ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText)
  }
  const { createAiCandidateSession } = await import(pathToFileURL(join(scratch, 'aiCandidateSession.mjs')))
  const { parseCandidate, AI_CANDIDATE_LIMITS } = await import(pathToFileURL(join(scratch, 'aiCandidate.mjs')))
  const input = { description: 'Match order IDs exactly', positiveExamples: ['ORD-12'], negativeExamples: ['wrong'] }
  const ready = { status: 'ready', providerId: 'configured', agentId: 'configured-model', selectionKey: 'selection' }
  const started = { type: 'run.started', runId: 'run', providerId: ready.providerId, agentId: ready.agentId }
  const completed = { type: 'completed', runId: 'run', status: 'completed' }
  const payload = JSON.stringify({ pattern: '^ORD-\\d+$', flags: '' })
  const delta = (value = payload) => ({ type: 'text.delta', runId: 'run', delta: value })
  const gate = () => { let resolve; const promise = new Promise((done) => { resolve = done }); return { promise, resolve } }
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0))
  const fixture = (stream, outcome) => {
    const states = [], calls = [], cancelled = [], validations = []
    let selectionListener, cancellationCount = 0
    const ai = {
      preflight: async (request) => { assert.deepEqual(request, { capabilities: ['text.generate'], inputModalities: ['text'] }); return ready },
      subscribePreflight: (listener) => { selectionListener = listener; return () => { selectionListener = undefined } },
      stream: (request) => { calls.push(request); return stream(request) },
      cancel: async (id) => { cancelled.push(id) },
    }
    const execution = {
      cancel: () => { cancellationCount++ },
      run: async (request) => {
        validations.push(request)
        return outcome?.(request) ?? { status: 'ready', matches: request.sourceText === 'ORD-12' ? [{ text: 'ORD-12' }] : [], error: null }
      },
    }
    const session = createAiCandidateSession(ai, (state) => states.push(state), { execution, generationMs: 60 })
    return { session, states, calls, cancelled, validations, ai, changeSelection: () => selectionListener?.(), get cancellationCount() { return cancellationCount } }
  }
  const success = async function* () { yield started; yield delta(); yield completed }
  let f = fixture(success)
  await f.session.generate({ ...input, sourceText: 'PRIVATE_EDITOR_SENTINEL' })
  assert.equal(f.states.at(-1).status, 'ready')
  assert.equal(f.calls[0].providerId, 'configured')
  assert.equal(f.calls[0].agentId, 'configured-model')
  assert.ok(!JSON.stringify(f.calls).includes('PRIVATE_EDITOR_SENTINEL'))
  assert.equal(f.validations.length, 3, 'Compile plus independent positive and negative checks')
  assert.deepEqual(f.session.adopt(), { pattern: '^ORD-\\d+$', flags: '' })
  assert.equal(f.session.adopt(), null)
  f.session.dispose()

  const partialGate = gate()
  f = fixture(async function* () { yield started; yield delta(); await partialGate.promise; yield completed })
  const pending = f.session.generate(input)
  await tick()
  assert.equal(f.states.at(-1).status, 'generating')
  assert.equal(f.validations.length, 0, 'Never execute a partial candidate')
  assert.equal(f.session.adopt(), null)
  f.session.invalidate()
  partialGate.resolve()
  await pending
  await tick()
  assert.equal(f.states.at(-1).status, 'idle')
  assert.equal(f.validations.length, 0)
  assert.deepEqual(f.cancelled, ['run'])
  f.session.dispose()

  f = fixture(async function* () { yield started; yield delta() })
  await f.session.generate(input)
  assert.equal(f.states.at(-1).reason, 'response', 'Transport EOF is not completed')
  f.session.dispose()

  f = fixture(success, () => ({ status: 'ready', matches: [], error: null }))
  await f.session.generate(input)
  assert.equal(f.states.at(-1).reason, 'validation')
  assert.deepEqual(f.states.at(-1).validation, [{ kind: 'positive', index: 0, passed: false }, { kind: 'negative', index: 0, passed: true }])
  assert.equal(f.session.adopt(), null)
  f.session.dispose()

  f = fixture(success)
  await f.session.generate(input)
  f.changeSelection()
  assert.equal(f.states.at(-1).reason, 'changed')
  assert.equal(f.session.adopt(), null)
  f.session.dispose()

  f = fixture(async function* () { yield { ...started, providerId: 'fallback' }; yield delta(); yield completed })
  await f.session.generate(input)
  assert.equal(f.states.at(-1).reason, 'changed')
  assert.equal(f.validations.length, 0)
  f.session.dispose()

  const validationGate = gate()
  f = fixture(success, () => validationGate.promise)
  const validating = f.session.generate(input)
  await tick()
  assert.equal(f.states.at(-1).status, 'validating')
  f.session.cancel()
  await validating
  validationGate.resolve({ status: 'ready', matches: [], error: null })
  await tick()
  assert.equal(f.states.at(-1).status, 'cancelled')
  assert.ok(f.cancellationCount > 1)
  f.session.dispose()

  const stalledGate = gate()
  f = fixture(async function* () { yield started; await stalledGate.promise; yield delta(); yield completed })
  await f.session.generate(input)
  assert.equal(f.states.at(-1).reason, 'timeout')
  assert.equal(f.calls[0].signal.aborted, true)
  stalledGate.resolve()
  await tick()
  assert.equal(f.states.at(-1).reason, 'timeout')
  assert.equal(f.validations.length, 0)
  f.ai.stream = () => success()
  await f.session.generate(input)
  assert.equal(f.states.at(-1).status, 'ready', 'Timeout remains retryable')
  f.session.dispose()

  f = fixture(success, () => ({ status: 'timeout', matches: [], error: null }))
  await f.session.generate(input)
  assert.equal(f.states.at(-1).reason, 'timeout')
  assert.equal(f.session.adopt(), null)
  f.session.dispose()

  f = fixture(success)
  f.ai.preflight = async () => ({ status: 'blocked', reason: 'provider_login_required' })
  await f.session.generate(input)
  assert.equal(f.states.at(-1).reason, 'blocked')
  assert.equal(f.calls.length, 0)
  f.session.dispose()

  f = fixture(success)
  await f.session.generate({ ...input, positiveExamples: Array(13).fill('a') })
  assert.equal(f.states.at(-1).reason, 'limits')
  assert.equal(f.calls.length, 0)
  f.session.dispose()

  f = fixture(async function* () { yield started; yield { type: 'error', runId: 'run', code: 'provider', message: 'Diagnostic must not become UI text' } })
  await f.session.generate(input)
  assert.equal(f.states.at(-1).reason, 'model')
  assert.ok(!JSON.stringify(f.states).includes('Diagnostic'))
  f.session.dispose()

  f = fixture(async function* () { yield started; yield delta('x'.repeat(AI_CANDIDATE_LIMITS.response + 1)); yield completed })
  await f.session.generate(input)
  assert.equal(f.states.at(-1).reason, 'response')
  assert.equal(f.validations.length, 0)
  assert.equal(f.calls[0].signal.aborted, true)
  f.session.dispose()

  const lateStart = gate()
  f = fixture(async function* () { await lateStart.promise; yield started; yield delta(); yield completed })
  const leaving = f.session.generate(input)
  await tick()
  f.session.dispose()
  const publications = f.states.length
  await leaving
  lateStart.resolve()
  await tick()
  assert.deepEqual(f.cancelled, ['run'], 'Cancel a provider run announced after disposal')
  assert.equal(f.states.length, publications, 'No publication after leaving')
  assert.equal(f.validations.length, 0)

  for (const value of ['```json\n' + payload + '\n```', '({pattern:"x",flags:""})', '{"pattern":"","flags":""}', '{"pattern":"x","flags":"gg"}', '{"pattern":"x","flags":"","execute":"evil"}', 'x'.repeat(AI_CANDIDATE_LIMITS.response + 1)]) {
    assert.equal(parseCandidate(value), null)
  }
  console.log('Regex AI candidate contracts passed (mock provider only).')
} finally {
  await rm(scratch, { recursive: true, force: true })
}
