import assert from 'node:assert/strict'
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { Worker as NodeWorker } from 'node:worker_threads'
import ts from 'typescript'

const scratch = await mkdtemp(join(tmpdir(), 'hiven-regex-worker-'))
const workers = []
const exits = []
try {
  const compile = async (name, rewrite = (source) => source) => {
    const source = await readFile(new URL(`../src/plugins/regex-tester/${name}.ts`, import.meta.url), 'utf8')
    const output = ts.transpileModule(rewrite(source), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
    }).outputText
    await writeFile(join(scratch, `${name}.mjs`), output)
  }
  await compile('regexCore')
  await compile('regex.worker', (source) => source.replace("'./regexCore'", "'./regexCore.mjs'"))
  // Browser worker construction is injected; execute the real controller and
  // worker module using Node's worker_threads with only a transport adapter.
  await compile('regexExecution', (source) => source.replace(
    "import InlineRegexWorker from './regex.worker?worker&inline'",
    'const InlineRegexWorker = class { constructor() { throw new Error("Factory required in Node") } }',
  ))
  await writeFile(join(scratch, 'adapter.mjs'), `
    import { parentPort } from 'node:worker_threads';
    globalThis.self = { postMessage: data => parentPort.postMessage(data) };
    await import('./regex.worker.mjs');
    parentPort.on('message', data => self.onmessage({ data }));
  `)
  const { createRegexExecution, REGEX_EXECUTION_TIMEOUT_MS } = await import(pathToFileURL(join(scratch, 'regexExecution.mjs')))
  const createWorker = () => {
    const native = new NodeWorker(pathToFileURL(join(scratch, 'adapter.mjs')))
    const adapter = {
      onmessage: null, onerror: null, onmessageerror: null, terminated: false,
      postMessage: (data) => native.postMessage(data),
      terminate() { this.terminated = true; exits.push(native.terminate()) },
    }
    native.on('message', (data) => adapter.onmessage?.({ data }))
    native.on('error', () => adapter.onerror?.({ preventDefault() {} }))
    workers.push(adapter)
    return adapter
  }
  const executor = createRegexExecution({ createWorker })
  const run = (pattern, sourceText, flags = 'g') => executor.run({ pattern, sourceText, flags })
  let result = await run('(\\w+)', 'alpha\nβ\nomega')
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.matches.map(({ text, line, col, groups }) => ({ text, line, col, groups })), [
    { text: 'alpha', line: 1, col: 1, groups: ['alpha'] },
    { text: 'omega', line: 3, col: 1, groups: ['omega'] },
  ])
  assert.equal((await run('[', 'text')).status, 'invalid')
  assert.equal((await run('a', 'text', 'gg')).status, 'invalid')
  result = await run('missing', 'text')
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.matches, [])
  result = await run('(?:)', '😀', 'gu')
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.matches.map((match) => match.index), [0, 2])
  assert.equal((await run('a', 'a'.repeat(1100))).matches.length, 1000)

  let rendererResponsive = false
  const heartbeat = setTimeout(() => { rendererResponsive = true }, 50)
  const started = performance.now()
  result = await run('^(a+)+$', `${'a'.repeat(40)}!`)
  const elapsed = performance.now() - started
  clearTimeout(heartbeat)
  assert.equal(result.status, 'timeout')
  assert.equal(rendererResponsive, true, 'The parent event loop remains responsive')
  assert.ok(elapsed < REGEX_EXECUTION_TIMEOUT_MS + 1500, `Termination exceeded budget: ${elapsed}ms`)
  assert.equal(workers.at(-1).terminated, true)
  result = await run('a+', 'aa bb aaa')
  assert.equal(result.status, 'ready')
  assert.deepEqual(result.matches.map((match) => match.text), ['aa', 'aaa'])
  const cancelled = run('^(a+)+$', `${'a'.repeat(40)}!`)
  executor.cancel()
  assert.equal((await cancelled).status, 'cancelled')
  assert.equal(workers.at(-1).terminated, true)
  assert.ok(workers.every((worker) => worker.terminated), 'All real workers are disposed after settling')

  const fakes = []
  const identities = createRegexExecution({ createWorker: () => {
    const fake = {
      onmessage: null, onerror: null, onmessageerror: null, terminated: false,
      postMessage(data) { this.request = data },
      terminate() { this.terminated = true },
    }
    fakes.push(fake)
    return fake
  } })
  const old = identities.run({ pattern: 'a', flags: 'g', sourceText: 'a' })
  const oldReply = fakes[0].onmessage
  const current = identities.run({ pattern: 'b', flags: 'g', sourceText: 'b' })
  assert.equal((await old).status, 'cancelled')
  oldReply({ data: { requestId: 1, result: { error: null, matches: [{ text: 'old' }] } } })
  fakes[1].onmessage({ data: { requestId: 1, result: { error: null, matches: [{ text: 'wrong id' }] } } })
  fakes[1].onmessage({ data: { requestId: 2, result: { error: null, matches: [] } } })
  assert.deepEqual(await current, { status: 'ready', error: null, matches: [] })
  assert.ok(fakes.every((worker) => worker.terminated))
  const broken = createRegexExecution({ createWorker: () => { throw new Error('Not available') } })
  assert.equal((await broken.run({ pattern: 'a', flags: 'g', sourceText: 'a' })).status, 'failed')
  console.log(`Regex worker: real timeout terminated in ${Math.round(elapsed)}ms; recovery, cancellation, identity and semantics passed.`)
} finally {
  for (const worker of workers) if (!worker.terminated) worker.terminate()
  await Promise.all(exits)
  await rm(scratch, { recursive: true, force: true })
}
