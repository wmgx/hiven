import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
const code = ts.transpileModule(readFileSync('src/clipboardImageSaveHandoff.ts', 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const flush = async () => { for (let i = 0; i < 30; i++) await Promise.resolve() }
function fixture() {
  const listeners = new Set(), notices = [], state = { globalLauncherOpen: true, globalLauncherSessionId: 1, settings: { locale: 'en' } }
  const h = { readCount: 0, saves: 0, closes: 0, restores: 0, dismissed: [], allowed: true, bundled: true, gate: deferred(), committed: false, result: { status: 'saved', pathCopied: true } }
  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
  h.invalidate = () => { state.globalLauncherSessionId++; for (const fn of listeners) fn() }
  h.revoke = () => { h.allowed = false; for (const fn of listeners) fn(); h.allowed = true }
  const modules = {
    './store': { useAppStore: { getState: () => state, subscribe } },
    './workspace/bundledPluginIdentity': { isCurrentBundledDefinition: () => h.bundled },
    './workspace/pluginRegistry': { pluginRegistry: { subscribe, getPluginDefinition: () => ({}) } },
    './workspace/pluginPermissions': { getPluginPermissionSnapshot: () => ({}), requirePluginPermissions: () => { if (!h.allowed) throw Error('revoked') }, usePluginPermissionStore: { subscribe } },
    './workspace/pluginStorage': { createPluginPrivateStorage: (_s, _p, _permissions, owner) => { h.owner = owner; return {} } },
    './workspace/pluginClipboardImageRead': { createPluginClipboardImageReader: () => async () => { h.readCount++; return { bytes: new Uint8Array([1]), contentType: 'image/png' } } },
    './workspace/launcherBlurGuard': { acquireLauncherNativeDialogFocus: () => () => {} },
    './workspace/toastRouting': { captureHudTarget: async () => '0000000000000001', nativeToastRoutingAvailable: () => true },
    './workspace/toast': { dismissToast: id => h.dismissed.push(id), showToast: (_text, _level, options) => notices.push(options.hud) },
    './i18n': { t: (_locale, key) => key },
    './plugins/encode-decode/imageBase64': { inspectRaster: () => ({}), decodeRaster: async bytes => ({ png: bytes }) },
    './plugins/encode-decode/saveClipboardPng': { saveClipboardPng: async (_storage, _png, current) => {
      h.saves++
      if (h.committed) h.owner.onCommit()
      await h.gate.promise
      if (!h.committed && !current()) throw Error('cancelled')
      if (h.fail) throw Error('private/path must never leak')
      return h.result
    } },
  }
  const module = { exports: {} }; let id = 0
  vm.runInNewContext(code, { module, exports: module.exports, require: key => { if (!modules[key]) throw Error(key); return modules[key] }, AbortController, crypto: { randomUUID: () => `operation-${++id}` } })
  const item = { pluginId: 'encode-decode', source: 'builtin', systemKey: 'plugin:encode-decode:launcher:open-image-save', pluginLifetime: { active: true } }
  const bind = (overrides = {}) => module.exports.withClipboardImageSave(
    {},
    { ...item, ...overrides },
    async () => { h.closes++; state.globalLauncherOpen = false },
    async () => { h.restores++ },
  )
  const shortcut = (current = () => true) => module.exports.saveClipboardImageFromShortcut(current, {})
  return { ...h, h, notices, bind, shortcut, state }
}
{
  const { h, bind, notices } = fixture(); const api = bind(); const first = api.saveClipboardImageAsPng(); await flush(); await api.saveClipboardImageAsPng()
  assert.equal(h.readCount, 1); assert.equal(h.saves, 1); h.gate.resolve(); await first
  assert.equal(h.closes, 1); assert.equal(notices[0].result, 'image-saved')
}
for (const invalidate of ['invalidate', 'revoke']) {
  const { h, bind, notices } = fixture(); const api = bind(); const run = api.saveClipboardImageAsPng(); await flush(); h[invalidate](); h.gate.resolve(); await run
  assert.equal(h.closes, 0); assert.equal(notices.length, 0, 'Precommit invalidation cannot revive a result')
}
for (const result of [{ status: 'saved', pathCopied: false }, { status: 'cancelled' }]) {
  const { h, bind, notices } = fixture(); h.result = result; const run = bind().saveClipboardImageAsPng(); h.gate.resolve(); await run
  assert.equal(h.closes, result.status === 'cancelled' ? 0 : 1)
  assert.equal(h.restores, result.status === 'cancelled' ? 1 : 0)
  assert.equal(notices.length, result.status === 'cancelled' ? 0 : 1)
  if (result.status !== 'cancelled') assert.equal(notices[0].result, 'image-saved-path-failed')
}
for (const fail of [false, true]) {
  const { h, bind, notices } = fixture(); h.committed = true; h.fail = fail; const api = bind(); const run = api.saveClipboardImageAsPng(); await flush(); h.invalidate(); h.gate.resolve(); await run
  assert.equal(h.closes, 0, 'Late committed receipt must not close the replacement launcher')
  assert.equal(h.restores, 0, 'Late committed receipt must not focus the replacement launcher')
  assert.equal(notices[0].result, fail ? 'image-save-failed' : 'image-saved')
  assert.equal(JSON.stringify(notices).includes('private/path'), false)
  await api.saveClipboardImageAsPng(); assert.equal(h.readCount, 1, 'Retained old API cannot read in a replacement session')
}
{
  const { h, bind } = fixture(); assert.equal(bind({ source: 'installed' }).saveClipboardImageAsPng, undefined)
  assert.equal(bind({ systemKey: 'other' }).saveClipboardImageAsPng, undefined)
  h.bundled = false; assert.equal(bind().saveClipboardImageAsPng, undefined)
}
console.log('Image save handoff: one read/dialog, scoped cancellation, committed outcomes and exact bundled route passed')

{
  const { h, bind, notices, state } = fixture(); h.fail = true; const first = bind().saveClipboardImageAsPng(); h.gate.resolve(); await first
  assert.equal(notices[0].result, 'image-save-failed')
  assert.equal(h.closes, 0)
  assert.equal(h.restores, 1)
  state.globalLauncherOpen = true; state.globalLauncherSessionId++; h.fail = false
  await bind().saveClipboardImageAsPng()
  assert.equal(h.dismissed.length, 1, 'Explicit retry retires its previous failure before a new result')
  assert.equal(notices[1].result, 'image-saved')
}

{
  const { h, shortcut, notices } = fixture()
  let current = false
  await shortcut(() => current)
  assert.equal(h.readCount, 0, 'Disabled shortcut must exit before reading the clipboard')
  current = true
  h.allowed = false
  await shortcut(() => current)
  assert.equal(h.readCount, 0, 'Missing permissions must exit before reading the clipboard')
  assert.equal(notices.length, 0, 'An unavailable shortcut must not report a result')
}
{
  const { h, shortcut, notices } = fixture()
  let current = true
  const run = shortcut(() => current)
  await flush()
  await shortcut(() => current)
  assert.equal(h.readCount, 1, 'Repeated shortcut presses share the existing busy transaction')
  current = false
  h.gate.resolve()
  await run
  assert.equal(notices.length, 0, 'An invalidated shortcut owner must not leave late feedback')
}
{
  const { h, shortcut, notices } = fixture()
  h.result = { status: 'saved', pathCopied: false }
  h.gate.resolve()
  await shortcut()
  assert.equal(notices[0].result, 'image-saved-path-failed', 'A saved file with failed path copy needs an honest outcome')
}
{
  const { h, shortcut, notices } = fixture()
  h.result = { status: 'cancelled' }
  h.gate.resolve()
  await shortcut()
  assert.equal(notices.length, 0, 'Native chooser cancellation must stay silent')
}
console.log('Image save shortcut: read-before-authorization blocked, busy serialized, stale feedback suppressed and outcomes honest')
