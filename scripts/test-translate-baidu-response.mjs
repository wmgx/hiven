#!/usr/bin/env node
/**
 * Baidu translate response parsing: 52000 is success, 54004 is quota, HTTP errors fail.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const src = readFileSync(new URL('../src/plugins/translate/providers/adapters.ts', import.meta.url), 'utf8')
  .replace(/import\s+type\s*\{[\s\S]*?\}\s*from\s*'[^']*'\s*;?\s*\n?/g, '')
  .replace(/import\s+\{[^}]*\}\s*from\s*'\.\/tencent'\s*;?\s*\n?/g, '')
const out = ts.transpileModule(src, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const moduleExports = {}
vm.runInNewContext(out, {
  exports: moduleExports,
  module: { exports: moduleExports },
  console,
  TextEncoder,
})
const { baiduFailureMessage, isAutoTranslateReady, translateWithAi } = moduleExports

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
const aiResult = await translateWithAi({ text: '你好', sourceLang: 'auto', targetLang: 'en' }, { aiProviderId: 'system-ai', aiAgentId: 'translator', aiEffort: 'high' }, {
  async *stream(request) {
    aiRequests.push(request)
    aiPrompts.push(request.input[0].text)
    yield { type: 'text.delta', runId: '1', delta: 'Hel' }
    yield { type: 'text.delta', runId: '1', delta: 'lo' }
    yield { type: 'completed', runId: '1', status: 'completed' }
  },
})
assert.equal(aiResult.text, 'Hello')
assert.equal(aiResult.billedChars, 2)
assert.match(aiPrompts[0], /Return only the translation/)
assert.equal(aiRequests[0].providerId, 'system-ai')
assert.equal(aiRequests[0].agentId, 'translator')
assert.equal(aiRequests[0].effort, 'high')

console.log('translate baidu response checks passed')
