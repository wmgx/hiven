#!/usr/bin/env node
// Real session, adapter and URL opener; all native/auth/browser boundaries are mocked.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { load } from './ai-runtime-test-harness.mjs'

const authUrl = 'https://auth.openai.com/oauth/authorize?response_type=code&client_id=synthetic&state=private-state&code_challenge=synthetic-challenge&code_challenge_method=S256&id_token_add_organizations=true'
const login = (loginId = 'login-1') => ({ url: authUrl, loginId })
const plain = (value) => JSON.parse(JSON.stringify(value))
const flush = () => new Promise((resolve) => setImmediate(resolve))
function deferred() {
  let resolve, reject
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail })
  return { promise, resolve, reject }
}
const sessions = load('src/workspace/ai/loginSession.ts', {}, { URL })
function sessionHarness(overrides = {}) {
  const changes = [], cancellations = [], timers = new Map()
  let starts = 0
  const module = load('src/workspace/ai/loginSession.ts', {}, {
    URL,
    setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id },
    clearTimeout(id) { timers.delete(id) },
    localStorage: { setItem() { assert.fail('Login state must never be persisted') } },
  })
  const session = module.createAiLoginSession({
    async start() { starts++; return overrides.start ? overrides.start() : login() },
    async cancel(id) { cancellations.push(id); return overrides.cancel?.(id) },
    onChange(snapshot) { changes.push(snapshot) },
  })
  return { session, changes, cancellations, timers, starts: () => starts,
    expire() { for (const [id, callback] of timers) { timers.delete(id); callback() } },
  }
}
function providerHarness(overrides = {}) {
  const calls = [], logs = []
  let listener, connection = 'connection-1'
  const module = load('src/workspace/ai/codexProvider.ts', {
    './loginSession': sessions,
    '@tauri-apps/api/core': { async invoke(command, args) {
      calls.push([command, args])
      if (args.expectedConnectionId && args.expectedConnectionId !== connection) throw new Error('HIVEN_CODEX_CONNECTION_CHANGED')
      const hook = overrides.invoke?.(command, args)
      const value = hook !== undefined ? await hook : args.method === 'account/login/start'
        ? { authUrl, loginId: 'login-1' } : {}
      return { ...value, _hivenConnectionId: connection }
    } },
    '@tauri-apps/api/event': { async listen(_name, callback) { listener = callback; return () => {} } },
  }, { window: { __TAURI_INTERNALS__: {} }, console: { log: (...args) => logs.push(args), info: (...args) => logs.push(args), warn: (...args) => logs.push(args) } })
  return { provider: module.codexChatGptProvider, calls, logs,
    methods: () => calls.map(([, args]) => args.method),
    replace(id) { connection = id },
    emit(method, params, id = connection) { listener({ payload: { method, params, _hivenConnectionId: id } }) },
  }
}
let passed = 0
async function check(name, work) {
  try { await work(); passed++ } catch (error) { error.message = `${name}: ${error.message}`; throw error }
}

await check('only official authorization requests without returned credentials are reusable', async () => {
  const cases = JSON.parse(readFileSync('scripts/fixtures/codex-login-url-validation.json', 'utf8'))
  for (const { name, url, valid } of cases) assert.equal(sessions.isSafeCodexLoginUrl(url), valid, name)
  const prefix = 'https://auth.openai.com/oauth/authorize?response_type=code&state='
  const largest = prefix + 's'.repeat(16_384 - prefix.length)
  assert.equal(sessions.isSafeCodexLoginUrl(largest), true)
  assert.equal(sessions.isSafeCodexLoginUrl(`${largest}s`), false)
  for (const value of [undefined, null, {}, [], 123]) assert.equal(sessions.isSafeCodexLoginUrl(value), false)
  assert.equal(sessions.isSafeCodexLoginUrl(authUrl), true)
  assert.equal(sessions.isSafeCodexLoginUrl('https://auth.openai.com:443/oauth/authorize?response_type=code&state=s&code_challenge=c'), true)
  for (const url of [null, '', ' http://auth.openai.com/oauth/authorize', 'https://auth.openai.com.example/oauth/authorize',
    'https://auth.openai.com/oauth/token', 'https://user@auth.openai.com/oauth/authorize',
    'https://auth.openai.com:8443/oauth/authorize', 'https://auth.openai.com/oauth/authorize#',
    'https://auth.openai.com/oauth/authorize#state=private', 'https://auth.openai.com\\@example.com/oauth/authorize',
    'https://auth.openai.com/oauth/authorize?%61ccess_token=private',
  ]) assert.equal(sessions.isSafeCodexLoginUrl(url), false, 'Unexpected unsafe authorization URL accepted')
  for (const key of ['access_token', 'id_token', 'refresh_token', 'token', 'client_secret', 'password', 'api_key', 'code',
    'code_verifier', 'authorization_code', 'session_token', 'ID_TOKEN', 'client[secret]', 'client_assertion', 'id_token_add_organizations']) {
    assert.equal(sessions.isSafeCodexLoginUrl(`${authUrl}&${encodeURIComponent(key)}=private`), false, key)
  }
})

await check('same-session start coalesces and retains one URL without persistence or extra RPCs', async () => {
  const gate = deferred(); const h = sessionHarness({ start: () => gate.promise })
  const first = h.session.start(), second = h.session.start()
  assert.equal(first, second); await flush(); assert.equal(h.starts(), 1)
  gate.resolve(login()); const ready = await first
  assert.equal(ready.phase, 'pending'); assert.equal(ready.url, authUrl)
  assert.equal(await h.session.start(), ready); assert.equal(h.starts(), 1)
  assert.equal(h.session.getSnapshot().url, authUrl, 'Reopen/copy reads the same URL')
  assert.equal(h.session.finish(ready.generation), true)
  assert.equal(h.session.getSnapshot().url, undefined); assert.equal(h.timers.size, 0)
  assert.equal(h.cancellations.length, 0, 'A completed login must not be cancelled or logged out')
})

await check('cancel clears immediately and cancels a late start reply without resurrection', async () => {
  const gate = deferred(); const h = sessionHarness({ start: () => gate.promise })
  const pending = h.session.start(); await flush(); await h.session.cancel()
  assert.equal(h.session.getSnapshot().phase, 'idle'); assert.equal(h.session.getSnapshot().reason, 'cancelled')
  gate.resolve(login()); assert.equal(await pending, undefined); await flush()
  assert.deepEqual(h.cancellations, ['login-1']); assert.equal(h.session.getSnapshot().url, undefined)
})

await check('cancel before the start callback prevents any backend login', async () => {
  const h = sessionHarness(); const pending = h.session.start(); await h.session.cancel()
  assert.equal(await pending, undefined); assert.equal(h.starts(), 0); assert.equal(h.timers.size, 0)
})

await check('timeout and stale success cannot clear or revive a newer generation', async () => {
  let id = 0; const h = sessionHarness({ start: async () => login(`login-${++id}`) })
  const first = await h.session.start(); const oldTimeout = [...h.timers.values()][0]
  h.expire(); assert.equal(h.session.getSnapshot().url, undefined)
  assert.equal(h.session.getSnapshot().reason, 'timeout'); await flush()
  const second = await h.session.start()
  assert.equal(h.session.finish(first.generation), false); oldTimeout()
  assert.equal(h.session.getSnapshot(), second); assert.deepEqual(h.cancellations, ['login-1'])
  await h.session.cancel(); assert.equal(h.session.getSnapshot().url, undefined)
  assert.deepEqual(h.cancellations, ['login-1', 'login-2'])
})

await check('timeout while starting cancels the eventual backend login and never exposes its URL', async () => {
  const gate = deferred(); const h = sessionHarness({ start: () => gate.promise })
  const pending = h.session.start(); await flush(); h.expire(); gate.resolve(login())
  assert.equal(await pending, undefined); await flush()
  assert.equal(h.session.getSnapshot().reason, 'timeout'); assert.deepEqual(h.cancellations, ['login-1'])
  assert.ok(h.changes.every((snapshot) => snapshot.url === undefined))
})

await check('errors are sanitized; a stale rejection does not replace newer state', async () => {
  const gates = [deferred(), deferred()]; let index = 0
  const h = sessionHarness({ start: () => gates[index++].promise })
  const old = h.session.start(); await flush(); await h.session.cancel()
  const current = h.session.start(); await flush(); gates[0].reject(new Error(authUrl))
  assert.equal(await old, undefined); assert.equal(h.session.getSnapshot().phase, 'starting')
  gates[1].reject(new Error(authUrl)); await assert.rejects(current, /^Error: AI_LOGIN_START_FAILED$/)
  assert.equal(h.session.getSnapshot().url, undefined); assert.equal(h.session.getSnapshot().reason, 'error')
  assert.equal(h.timers.size, 0)
})

await check('unsafe result and cancellation failure clear local state without leaking payloads', async () => {
  const h = sessionHarness({ start: async () => ({ ...login(), url: `${authUrl}&access_token=private` }) })
  await assert.rejects(h.session.start(), /^Error: AI_LOGIN_START_FAILED$/); await flush()
  assert.equal(h.session.getSnapshot().url, undefined); assert.deepEqual(h.cancellations, ['login-1'])
  const failed = sessionHarness({ cancel: async () => { throw new Error(authUrl) } })
  await failed.session.start(); await assert.rejects(failed.session.cancel(), /^Error: AI_LOGIN_CANCEL_FAILED$/)
  assert.equal(failed.session.getSnapshot().url, undefined); assert.equal(failed.timers.size, 0)
})

await check('dispose clears pending state and late results without notifying an unmounted UI', async () => {
  const gate = deferred(); const h = sessionHarness({ start: () => gate.promise })
  const pending = h.session.start(); await flush(); const count = h.changes.length
  h.session.dispose(); gate.resolve(login()); assert.equal(await pending, undefined); await flush()
  assert.equal(h.changes.length, count); assert.equal(h.session.getSnapshot().url, undefined)
  assert.equal(h.session.getSnapshot().reason, 'disposed'); assert.equal(h.timers.size, 0)
  assert.deepEqual(h.cancellations, ['login-1']); assert.equal(await h.session.start(), undefined)
})

await check('Codex preserves the login id and cancels that exact login on its original connection', async () => {
  const h = providerHarness(); assert.deepEqual(plain(await h.provider.login()), login())
  await h.provider.cancelLogin('login-1'); await h.provider.cancelLogin('login-1')
  assert.deepEqual(h.methods(), ['initialize', 'initialized', 'account/login/start', 'account/login/cancel'])
  assert.deepEqual(plain(h.calls.at(-1)[1]), { method: 'account/login/cancel', params: { loginId: 'login-1' }, expectedConnectionId: 'connection-1' })
  assert.equal(h.logs.length, 0)
})

await check('invalid Codex login URLs are never returned and their backend sessions are cancelled', async () => {
  const h = providerHarness({ invoke: (_command, args) => args.method === 'account/login/start'
    ? { loginId: 'login-1', authUrl: `${authUrl}&code=private` } : undefined })
  await assert.rejects(h.provider.login(), /^Error: HIVEN_CODEX_LOGIN_FAILED$/); await flush()
  assert.equal(h.methods().at(-1), 'account/login/cancel'); assert.equal(h.logs.length, 0)
  const missing = providerHarness({ invoke: (_command, args) => args.method === 'account/login/start' ? { authUrl } : undefined })
  await assert.rejects(missing.provider.login(), /^Error: HIVEN_CODEX_LOGIN_FAILED$/)
  assert.equal(missing.methods().includes('account/logout'), false)
})

await check('Codex error payloads are suppressed and cancellation never becomes logout', async () => {
  const h = providerHarness({ invoke: (_command, args) => args.method === 'account/login/cancel'
    ? Promise.reject(new Error(authUrl)) : undefined })
  await h.provider.login(); await assert.rejects(h.provider.cancelLogin('login-1'), /^Error: HIVEN_CODEX_LOGIN_CANCEL_FAILED$/)
  assert.equal(h.methods().includes('account/logout'), false); assert.equal(h.logs.length, 0)
  const failed = providerHarness({ invoke: (_command, args) => args.method === 'account/login/start'
    ? Promise.reject(new Error(authUrl)) : undefined })
  await assert.rejects(failed.provider.login(), /^Error: HIVEN_CODEX_LOGIN_FAILED$/); assert.equal(failed.logs.length, 0)
})

await check('connection replacement and login completion revoke obsolete cancellation handles', async () => {
  const closed = providerHarness(); await closed.provider.login()
  closed.emit('hiven/transport/closed', {}); closed.replace('connection-2'); await closed.provider.cancelLogin('login-1')
  assert.equal(closed.methods().includes('account/login/cancel'), false)
  const replaced = providerHarness(); await replaced.provider.login(); replaced.replace('connection-2')
  await assert.rejects(replaced.provider.cancelLogin('login-1'), /^Error: HIVEN_CODEX_LOGIN_CANCEL_FAILED$/)
  assert.equal(replaced.methods().filter((method) => method === 'initialize').length, 1, 'An obsolete cancellation must not initialize a replacement server')
  const complete = providerHarness(); await complete.provider.login()
  complete.emit('account/login/completed', { loginId: 'login-1', success: true }); await complete.provider.cancelLogin('login-1')
  assert.equal(complete.methods().includes('account/login/cancel'), false)
})

await check('runtime cancellation forwards the login id and never falls back to account logout', async () => {
  const calls = []
  const provider = { id: 'openai-chatgpt', login: async () => login(), cancelLogin: async (id) => calls.push(['cancel', id]),
    logout: async () => calls.push(['logout']) }
  const runtime = load('src/workspace/ai/runtime.ts', {
    '@tauri-apps/api/core': {}, '../../i18n': {}, '../../store': {}, '../pluginPermissions': {},
    '../pluginRegistry': {}, '../telemetry': {}, './codexProvider': { codexChatGptProvider: provider },
    './xaiProvider': { xaiGrokProvider: { id: 'xai', logout: async () => calls.push(['other-logout']) } },
    './ollamaProvider': { ollamaLocalProvider: { id: 'ollama' } },
  })
  assert.deepEqual(plain(await runtime.loginAiProvider(provider.id)), login())
  await runtime.cancelAiProviderLogin(provider.id, 'login-1')
  await runtime.cancelAiProviderLogin('xai', 'other-login')
  assert.deepEqual(calls, [['cancel', 'login-1']])
})

function openerHarness({ fail = false, route = 'shell-open' } = {}) {
  const calls = [], logs = []
  const module = load('src/workspace/effectRunner.ts', {
    './workspaceStore': {}, './runtimeRegistry': {}, './surfaceCoordinator': {}, './monacoBridge': {},
    './toast': {}, './pluginRegistry': {}, '../i18n': {}, '../store': {},
    './urlSchemeRegistry': { routeHostOpenUrl: () => route, canHostOpenUrl: () => true, extractUrlScheme: () => 'https' },
    '@tauri-apps/plugin-shell': { async open(url) { calls.push(['shell', url]); if (fail) throw new Error(`failed ${url}`) } },
    '@tauri-apps/api/core': { async invoke(...args) { calls.push(['native', ...args]) } },
  }, { window: { open: (...args) => calls.push(['window', ...args]) },
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
  })
  return { ...module, calls, logs }
}

await check('sensitive open suppresses both URL and native error logs, with no unsafe fallback', async () => {
  const ok = openerHarness(); await ok.openExternalUrl(authUrl, undefined, { sensitive: true })
  assert.deepEqual(ok.calls, [['shell', authUrl]]); assert.deepEqual(ok.logs, [])
  const failed = openerHarness({ fail: true })
  await assert.rejects(failed.openExternalUrl(authUrl, undefined, { sensitive: true }), /^Error: HIVEN_SENSITIVE_URL_OPEN_FAILED$/)
  assert.deepEqual(failed.calls, [['shell', authUrl]]); assert.deepEqual(failed.logs, [])
  const denied = openerHarness({ route: 'deny' })
  await assert.rejects(denied.openExternalUrl(authUrl, undefined, { sensitive: true }), /^Error: HIVEN_SENSITIVE_URL_OPEN_FAILED$/)
  assert.equal(denied.calls.length, 0); assert.equal(denied.logs.length, 0)
})

await check('sensitive opener respects cancellation and ordinary opens preserve native fallback', async () => {
  const h = openerHarness(); const controller = new AbortController()
  const opening = h.openExternalUrl(authUrl, controller.signal, { sensitive: true }); controller.abort(); await opening
  assert.equal(h.calls.length, 0); assert.equal(h.logs.length, 0)
  const regular = openerHarness({ fail: true }); await regular.openExternalUrl('https://example.com')
  assert.deepEqual(plain(regular.calls), [['shell', 'https://example.com'], ['native', 'open_system_url', { url: 'https://example.com' }]])
  assert.ok(regular.logs.length > 0)
})

console.log(`${passed} AI login fallback behavior checks passed`)
