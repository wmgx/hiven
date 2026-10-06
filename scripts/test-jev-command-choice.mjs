#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const compile = (path) => ts.transpileModule(readFileSync(path, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const exports = {}
vm.runInNewContext(compile('src/workspace/ai/jev.ts'), {
  exports,
  require: () => ({ invoke: () => { throw new Error('unexpected network call') } }),
  URL,
  JSON,
  Number,
  Object,
  Error,
})
const { chooseJevCandidate, JevRequestError, validJevEndpoint } = exports
const settings = {
  enabled: true,
  endpoint: 'https://ai-gateway.edgeone.link/v1/systemone',
  apiKey: 'test-only',
  model: '@makers/jev',
}
const candidates = [
  { id: 'plugin:random:tool:password', description: 'Generate a random password' },
  { id: 'plugin:line-tools:tool:sort', description: 'Sort lines' },
]
let payload
const selected = await chooseJevCandidate(settings, '帮我生成一个随机密码', candidates, async (_settings, body) => {
  payload = JSON.parse(body)
  return { status: 200, body: JSON.stringify({ answers: {
    action: { type: 'choice', choice: 'c0', confidence: 0.91 },
    input_mode: { type: 'choice', choice: 'intent', confidence: 0.95 },
  } }) }
})
assert.equal(selected.id, candidates[0].id)
assert.equal(selected.useInput, false)
assert.equal(payload.model, '@makers/jev')
assert.equal(payload.state, '帮我生成一个随机密码')
assert.equal(payload.questions.action.criteria.c0, 'Generate a random password')
assert.equal(payload.questions.action.criteria.none, 'No suitable command / 没有合适的命令')

// Raw content is sent verbatim and can be bound to the chosen command locally.
const content = '  {"name":"demo"}\n'
const contentChoice = await chooseJevCandidate(settings, content, candidates, async (_settings, body) => {
  const request = JSON.parse(body)
  assert.equal(request.state, content)
  assert.equal(request.questions.input_mode.type, 'choice')
  return { status: 200, body: JSON.stringify({ answers: {
    action: { type: 'choice', choice: 'c1', confidence: 0.9 },
    input_mode: { type: 'choice', choice: 'content', confidence: 0.95 },
  } }) }
})
assert.equal(contentChoice.id, candidates[1].id)
assert.equal(contentChoice.useInput, true)

const forged = await chooseJevCandidate(settings, '去重', candidates, async () => ({
  status: 200,
  body: JSON.stringify({ answers: { action: { type: 'choice', choice: 'plugin:evil:tool:run', confidence: 1 } } }),
}))
assert.equal(forged, null)
await assert.rejects(chooseJevCandidate(settings, '去重', candidates, async () => ({ status: 401, body: 'secret' })),
  (error) => error instanceof JevRequestError && error.status === 401 && !error.message.includes('secret'))
assert.equal(validJevEndpoint('http://127.0.0.1:18432/v1/systemone'), true)
assert.equal(validJevEndpoint('http://example.com/v1/systemone'), false)

console.log('Jev command choice checks passed')
