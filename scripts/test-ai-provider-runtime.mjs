import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const xai = read('src/workspace/ai/xaiProvider.ts')

const xaiCompiled = ts.transpileModule(xai, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const xaiExports = {}
vm.runInNewContext(xaiCompiled, {
  exports: xaiExports,
  module: { exports: xaiExports },
  require: () => ({ Channel: class {}, invoke: async () => {} }),
  Date,
  Number,
  String,
  Set,
})
const agent = xaiExports.mapAgent({ id: 'grok-4.6', input_modalities: ['text', 'image'], context_window: 500_000 })
assert.equal(agent.contextWindow, 500_000)
assert.ok(agent.capabilities.includes('image.understand'))
assert.ok(agent.capabilities.includes('web.search'))
assert.equal(
  JSON.stringify(xaiExports.mapStreamEvent({ type: 'response.output_text.delta', delta: 'hi' }, 'run-1')),
  JSON.stringify([{ type: 'text.delta', runId: 'run-1', delta: 'hi' }]),
)
const quota = xaiExports.quotaFromBilling({
  config: {
    creditUsagePercent: 37,
    currentPeriod: { start: '2026-08-20T00:00:00Z', end: '2026-08-27T00:00:00Z' },
  },
})
assert.equal(quota.buckets[0].primary.usedPercent, 37)
assert.equal(quota.buckets[0].primary.windowDurationMinutes, 7 * 24 * 60)

await import('./test-ai-cancellation-behavior.mjs')
await import('./test-ai-permission-behavior.mjs')

console.log('AI provider runtime contract OK')
