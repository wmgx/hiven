#!/usr/bin/env node
/**
 * Tencent Cloud TMT adapter: TC3 signing, response parsing, migrate existing settings.
 */
import assert from 'node:assert/strict'
import { createHash, createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(path, extras = {}) {
  const src = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
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
    crypto,
    TextEncoder,
    URL,
    Date,
    Math,
    JSON,
    Array,
    Object,
    Uint8Array,
    Error,
    ...extras,
  })
  return moduleExports
}

function sha256Hex(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

function hmacRaw(key, message) {
  return createHmac('sha256', key).update(message, 'utf8').digest()
}

function signTc3WithNode({ secretId, secretKey, service, host, action, contentType, payload, timestamp, date }) {
  const hashedPayload = sha256Hex(payload)
  const canonicalHeaders = `content-type:${contentType}\nhost:${host}\nx-tc-action:${action.toLowerCase()}\n`
  const signedHeaders = 'content-type;host;x-tc-action'
  const canonicalRequest = ['POST', '/', '', canonicalHeaders, signedHeaders, hashedPayload].join('\n')
  const credentialScope = `${date}/${service}/tc3_request`
  const stringToSign = ['TC3-HMAC-SHA256', String(timestamp), credentialScope, sha256Hex(canonicalRequest)].join('\n')
  const secretDate = hmacRaw(`TC3${secretKey}`, date)
  const secretService = hmacRaw(secretDate, service)
  const secretSigning = hmacRaw(secretService, 'tc3_request')
  const signature = hmacRaw(secretSigning, stringToSign).toString('hex')
  return `TC3-HMAC-SHA256 Credential=${secretId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
}

const tencent = loadModule('src/plugins/translate/providers/tencent.ts')
const model = loadModule('src/plugins/translate/settings/model.ts')

assert.equal(tencent.tencentLang('ja'), 'ja')
assert.equal(tencent.tencentLang('auto'), 'auto')

const parsed = tencent.parseTencentTranslateResponse(200, JSON.stringify({
  Response: { TargetText: 'Hello', RequestId: 'req-1' },
}))
assert.equal(parsed.text, 'Hello')
assert.equal(parsed.requestId, 'req-1')

assert.throws(
  () => tencent.parseTencentTranslateResponse(200, JSON.stringify({
    Response: { Error: { Code: 'AuthFailure.SecretIdNotFound', Message: 'secret id not found' } },
  })),
  /secret id not found \(AuthFailure\.SecretIdNotFound\)/,
)

const now = new Date('2026-08-21T04:00:00.000Z')
const timestamp = Math.floor(now.getTime() / 1000)
const date = now.toISOString().slice(0, 10)
const req = { text: '你好', sourceLang: 'zh', targetLang: 'en' }
const profile = {
  secretId: 'AKIDexample',
  secretKey: 'secret-example',
  endpoint: 'https://tmt.tencentcloudapi.com',
  region: 'ap-guangzhou',
}

const built = await tencent.buildTencentTranslateRequest(req, profile, now)
const expectedAuth = signTc3WithNode({
  secretId: profile.secretId,
  secretKey: profile.secretKey,
  service: 'tmt',
  host: 'tmt.tencentcloudapi.com',
  action: 'TextTranslate',
  contentType: 'application/json; charset=utf-8',
  payload: built.body,
  timestamp,
  date,
})
assert.equal(built.headers.Authorization, expectedAuth)
assert.equal(built.headers['X-TC-Action'], 'TextTranslate')
assert.equal(built.headers['X-TC-Region'], 'ap-guangzhou')
assert.equal(built.headers['X-TC-Version'], '2018-03-21')
assert.match(built.body, /"SourceText":"你好"/)
assert.match(built.body, /"ProjectId":0/)

const network = {
  async request(input) {
    assert.equal(input.url, 'https://tmt.tencentcloudapi.com')
    assert.equal(input.method, 'POST')
    assert.equal(input.headers.Authorization, expectedAuth)
    return {
      status: 200,
      body: JSON.stringify({ Response: { TargetText: 'Hello', RequestId: 'abc' } }),
    }
  },
}
const translated = await tencent.translateWithTencent(req, { ...profile, provider: 'tencent', id: 't1', name: 't', enabled: true, defaultSourceLang: 'auto', defaultTargetLang: 'en', monthlyLimitChars: 0, usedCharsMonth: '', usedChars: 0 }, network, now)
assert.equal(translated.text, 'Hello')
assert.equal(translated.providerRequestId, 'abc')
assert.equal(translated.billedChars, 2)

const migrated = model.migrateTranslateSettings({
  defaultProfileId: 'baidu-default',
  defaultTargetLang: 'smart',
  profiles: [{ id: 'baidu-default', name: '百度中文', provider: 'baidu', enabled: true, defaultSourceLang: 'auto', defaultTargetLang: 'smart', monthlyLimitChars: 1, usedCharsMonth: '', usedChars: 0 }],
}, 3)
assert.equal(migrated.profiles.some((profile) => profile.provider === 'tencent'), true)
assert.equal(migrated.profiles.some((profile) => profile.provider === 'ai'), true)
assert.equal(migrated.profiles[0].id, 'baidu-default')

const already = model.migrateTranslateSettings({
  defaultProfileId: 'baidu-default',
  defaultTargetLang: 'smart',
  profiles: [{ id: 'mine', name: 'mine', provider: 'tencent', enabled: true, defaultSourceLang: 'auto', defaultTargetLang: 'smart', monthlyLimitChars: 1, usedCharsMonth: '', usedChars: 0 }],
}, 3)
assert.equal(already.profiles.length, 2)
assert.equal(already.profiles.some((profile) => profile.provider === 'ai'), true)

console.log('translate tencent adapter checks passed')
