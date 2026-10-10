#!/usr/bin/env node
/** Real host export, material, controller and focus modules; all native I/O is synthetic. */
import assert from 'node:assert/strict'
import { createServer } from 'vite'

const values = new Map()
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: (key) => values.delete(key),
}
globalThis.window = {
  localStorage: storage, sessionStorage: storage, location: { search: '' },
  addEventListener() {}, removeEventListener() {}, dispatchEvent() {},
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
}
globalThis.localStorage = storage
globalThis.sessionStorage = storage
const vite = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'silent' })
const forbidden = () => { throw new Error('Unexpected acquisition or side effect') }
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }

try {
  const textExport = await vite.ssrLoadModule('/src/launcher/clipboard/currentTextExport.ts')
  const blocks = await vite.ssrLoadModule('/src/launcher/clipboard/objectBlock.ts')
  const { createFileTextMaterial } = await vite.ssrLoadModule('/src/launcher/clipboard/fileTextMaterial.ts')
  const { LauncherController } = await vite.ssrLoadModule('/src/workspace/launcher/controller.ts')
  const focus = await vite.ssrLoadModule('/src/workspace/launcherBlurGuard.ts')
  const { t } = await vite.ssrLoadModule('/src/i18n/index.ts')
  const labels = { dialogTitle: t('en', 'palette.currentTextExportDialogTitle') }
  const originalText = `  α🙂中文\r\n${'full payload beyond preview '.repeat(100)}\r\n /synthetic/file.txt \r\n\r\n`
  const original = blocks.createToolResultObjectBlock(originalText)

  for (const text of ['', ' \r\n\t ', '0', 'false', originalText, '/synthetic/file.txt']) {
    const block = { ...original, payloadText: text }
    assert.equal(textExport.getCurrentTextExportPayload(block), text)
    assert.equal(textExport.canExportCurrentText({ block, nativeDesktop: true, standaloneLauncher: true }), true)
    assert.equal(textExport.canExportCurrentText({ block, nativeDesktop: false, standaloneLauncher: true }), false)
    assert.equal(textExport.canExportCurrentText({ block, nativeDesktop: true, standaloneLauncher: false }), false)
  }
  assert.equal(textExport.getCurrentTextExportPayload(createFileTextMaterial('/synthetic/empty.txt', '')), '')
  for (const block of [null, ...[
    { payloadText: undefined, preview: 'preview must not be exported' }, { payloadText: 'binary\0text' },
    { secretMasked: true }, { kind: 'secret' }, { kind: 'secret-like' }, { kind: 'image' }, { kind: 'files' },
    { payloadImage: { blobId: 'private' } }, { payloadFiles: { paths: ['/synthetic/file.txt'] } },
  ].map((extras) => ({ ...original, ...extras }))]) {
    assert.equal(textExport.getCurrentTextExportPayload(block), null)
    assert.equal(textExport.canExportCurrentText({ block, nativeDesktop: true, standaloneLauncher: true }), false)
  }
  for (const locale of ['en', 'zh']) {
    for (const key of ['palette.saveCurrentText', 'palette.currentTextExportDialogTitle', 'palette.currentTextExportSaved', ...Object.values(textExport.CURRENT_TEXT_EXPORT_ERROR_KEYS)]) {
      assert.notEqual(t(locale, key), key)
      assert.notEqual(t(locale, key), key.slice('palette.'.length))
    }
  }

  function harness(text = originalText) {
    const h = {
      block: { ...original, payloadText: text }, materialGeneration: 1, queryGeneration: 1,
      lifetime: 1, mounted: true, open: true, visible: true, prepared: [], committed: [], discarded: [],
    }
    h.controller = new LauncherController({
      surfaceId: 'global-launcher', locale: 'en',
      api: { getSelectionText: forbidden, getActiveText: forbidden, getClipboardText: forbidden },
      makeT: () => (key) => key, getSettings: () => ({}), recordSelection: forbidden,
      requestClose: forbidden, onChange() {}, appendExperienceEvent: forbidden,
    })
    h.native = {
      getSession: async () => 7,
      prepare: async (text, receivedLabels, expectedSession) => { h.prepared.push({ text, labels: receivedLabels, expectedSession }); return { status: 'prepared', exportId: 41 } },
      commit: async (exportId) => { h.committed.push(exportId); return { status: 'saved' } },
      discard: async (exportId) => { h.discarded.push(exportId) },
    }
    h.run = textExport.createCurrentTextExport(h.native)
    h.scope = () => textExport.captureCurrentTextExportScope({
      block: h.block, getMaterialGeneration: () => h.materialGeneration,
      hasMaterial: (block) => h.block === block,
      getController: () => h.controller, isOpen: () => h.open, isRootVisible: () => h.visible,
      getQueryGeneration: () => h.queryGeneration,
      getLifetime: () => h.mounted && h.open ? h.lifetime : undefined,
    })
    h.options = (scope = h.scope()) => ({
      block: h.block, ...scope, labels,
      acquireFocusLease: () => focus.acquireLauncherNativeDialogFocus(scope.isCurrentLifetime),
    })
    return h
  }

  // Exact strings become exact native snapshots, including a zero-byte explicit material.
  for (const text of ['', ' \r\n\t ', '0', 'false', originalText, '/synthetic/file.txt']) {
    const h = harness(text)
    assert.deepEqual(await h.run(h.options()), { status: 'saved' })
    assert.deepEqual(h.prepared, [{ text, labels, expectedSession: 7 }])
    assert.deepEqual(h.committed, [41]); assert.deepEqual(h.discarded, [])
    assert.equal(h.block.payloadText, text); assert.equal(h.open, true)
  }

  // The limit is UTF-8 bytes, inclusive, and is checked before dialog/focus acquisition.
  for (const text of ['a'.repeat(1024 * 1024), '🙂'.repeat(256 * 1024)]) {
    const h = harness(text)
    assert.equal((await h.run(h.options())).status, 'saved')
  }
  for (const text of ['a'.repeat(1024 * 1024 + 1), '🙂'.repeat(256 * 1024) + '中']) {
    const h = harness(text)
    assert.deepEqual(await h.run({ ...h.options(), acquireFocusLease: forbidden }), { status: 'error', code: 'TEXT_EXPORT_TOO_LARGE' })
    assert.equal(h.prepared.length, 0)
  }

  const invalidations = {
    query: (h) => { h.queryGeneration++ },
    'query changed and restored': (h) => { h.queryGeneration += 2 },
    material: (h) => { h.block = { ...h.block, payloadText: 'new draft' }; h.materialGeneration++ },
    generation: (h) => { h.materialGeneration++ },
    navigation: (h) => { h.controller.reset() },
    'root hidden': (h) => { h.visible = false },
    'controller replaced': (h) => { h.controller = { getState: () => ({ busy: false, frames: [{ kind: 'list' }] }) } },
    close: (h) => { h.open = false },
    'close and reopen': (h) => { h.open = false; h.lifetime++; h.open = true },
    'new native session': (h) => { h.lifetime++ },
    unmount: (h) => { h.mounted = false },
  }
  for (const [name, invalidate] of Object.entries(invalidations)) {
    const h = harness(), options = h.options()
    invalidate(h)
    assert.equal(await h.run(options), null, `${name}: stale row cannot start`)
    assert.equal(h.prepared.length, 0)
  }
  for (const [name, invalidate] of Object.entries(invalidations)) {
    const h = harness(), choice = deferred(), options = h.options()
    h.native.prepare = async (text) => { h.prepared.push(text); return choice.promise }
    const pending = h.run(options)
    await flush()
    assert.equal(h.run.isBusy(), true)
    assert.equal(focus.launcherNativeDialogFocus.isActive(), true)
    assert.equal(await h.run(options), null, 'duplicate click is ignored while the chooser is open')
    invalidate(h)
    if (options.isCurrentLifetime()) assert.equal(focus.launcherNativeDialogFocus.isActive(), true, `${name}: same-session dialog still owns focus`)
    else assert.equal(focus.launcherNativeDialogFocus.isActive(), false, `${name}: old session cannot suppress new focus`)
    assert.equal(await h.run(h.options()), null, 'old native chooser remains single-flight even after session change')
    choice.resolve({ status: 'prepared', exportId: 42 })
    assert.equal(await pending, null, `${name}: no stale UI result`)
    assert.deepEqual(h.committed, [], `${name}: stale preparation never writes`)
    assert.deepEqual(h.discarded, [42], `${name}: only the stale ticket is discarded`)
    assert.equal(h.run.isBusy(), false)
    assert.equal(focus.launcherNativeDialogFocus.isActive(), false)
  }

  {
    const h = harness(), choice = deferred(), options = h.options()
    h.native.prepare = async (text) => { h.prepared.push(text); return choice.promise }
    const pending = h.run(options)
    await flush()
    h.block.payloadText = 'changed mutable caller object'
    choice.resolve({ status: 'prepared', exportId: 41 })
    assert.equal((await pending).status, 'saved')
    assert.deepEqual(h.prepared, [originalText], 'payload is snapshotted before opening the chooser')
  }
  for (const [name, invalidate] of Object.entries(invalidations)) {
    const h = harness(), session = deferred(), options = h.options()
    h.native.getSession = () => session.promise
    const pending = h.run(options)
    assert.equal(h.run.isBusy(), true)
    assert.equal(await h.run(options), null)
    assert.equal(focus.launcherNativeDialogFocus.isActive(), false, 'session lookup does not own dialog focus')
    invalidate(h)
    session.resolve(8)
    assert.equal(await pending, null, `${name}: stale native session lookup cannot open a dialog`)
    assert.equal(h.prepared.length, 0)
    assert.deepEqual(h.discarded, [])
    assert.equal(h.run.isBusy(), false)
  }
  {
    const h = harness()
    h.native.prepare = async () => ({ status: 'cancelled' })
    assert.deepEqual(await h.run(h.options()), { status: 'cancelled' })
    assert.deepEqual(h.committed, []); assert.deepEqual(h.discarded, [])
    assert.equal(focus.launcherNativeDialogFocus.isActive(), false)
  }
  for (const error of [...Object.keys(textExport.CURRENT_TEXT_EXPORT_ERROR_KEYS), new Error('private path /secret/user/file.txt')]) {
    const h = harness()
    h.native.prepare = async () => { throw error }
    assert.deepEqual(await h.run(h.options()), {
      status: 'error', code: typeof error === 'string' ? error : 'TEXT_EXPORT_WRITE_FAILED',
    })
    assert.equal(focus.launcherNativeDialogFocus.isActive(), false)
    assert.equal(h.run.isBusy(), false)
  }
  {
    const h = harness()
    h.native.commit = async () => { throw 'TEXT_EXPORT_WRITE_FAILED' }
    assert.deepEqual(await h.run(h.options()), { status: 'error', code: 'TEXT_EXPORT_WRITE_FAILED' })
    assert.deepEqual(h.discarded, [41])
    h.native.commit = async () => ({ status: 'saved' })
    assert.equal((await h.run(h.options())).status, 'saved', 'a failed write permits an explicit retry')
  }
  {
    const h = harness(), write = deferred()
    h.native.commit = async (exportId) => { h.committed.push(exportId); return write.promise }
    const pending = h.run(h.options())
    await flush()
    assert.deepEqual(h.committed, [41], 'native commit has been dispatched')
    assert.equal(await h.run(h.options()), null, 'commit remains single-flight')
    h.lifetime++; h.block = { ...h.block, payloadText: 'new session draft' }
    write.resolve({ status: 'saved' })
    assert.equal(await pending, null, 'commit completion cannot show success in a new session')
    assert.deepEqual(h.discarded, [], 'already-dispatched successful writes are not claimed to be revocable')
    assert.equal(h.block.payloadText, 'new session draft')
  }
  {
    const h = harness(), options = h.options()
    assert.equal(await h.run({ ...options, acquireFocusLease: () => () => { h.queryGeneration++ } }), null)
    assert.deepEqual(h.committed, [], 'ownership is rechecked after focus-release listeners run')
    assert.deepEqual(h.discarded, [41])
  }

  // A stale lease is physically released only when its dialog settles, silently for newer sessions.
  {
    let owner = 1, notifications = 0
    const stop = focus.launcherNativeDialogFocus.subscribe(() => { notifications++ })
    const releaseOld = focus.acquireLauncherNativeDialogFocus(() => owner === 1)
    assert.equal(notifications, 1)
    owner = 2
    assert.equal(focus.launcherNativeDialogFocus.isActive(), false)
    const releaseNew = focus.acquireLauncherNativeDialogFocus(() => owner === 2)
    assert.equal(notifications, 2)
    releaseOld(); releaseOld()
    assert.equal(notifications, 2, 'old finally cannot trigger a new-session blur check')
    assert.equal(focus.launcherNativeDialogFocus.isActive(), true)
    releaseNew(); releaseNew()
    assert.equal(notifications, 3)
    const releasePicker = focus.acquireLauncherNativeDialogFocus()
    owner++
    assert.equal(focus.launcherNativeDialogFocus.isActive(), true, 'unscoped file picker retains its existing behavior')
    releasePicker(); stop()
  }

  // The actual native adapter sends no user-controlled path, blob id, or plugin authority.
  {
    const calls = []
    window.__TAURI_INTERNALS__ = { invoke: async (command, args) => {
      calls.push({ command, args })
      if (command === 'get_launcher_window_resize_session') return { session: 7, revision: 19 }
      if (command === 'prepare_host_text_export') return { status: 'prepared', exportId: 73 }
      if (command === 'commit_host_text_export') return { status: 'saved' }
    } }
    const run = textExport.createCurrentTextExport()
    assert.equal((await run({ block: original, isCurrent: () => true, labels, acquireFocusLease: () => () => {} })).status, 'saved')
    await textExport.nativeCurrentTextExport.discard(74)
    assert.deepEqual(calls, [
      { command: 'get_launcher_window_resize_session', args: {} },
      { command: 'prepare_host_text_export', args: { text: originalText, ...labels, expectedSession: 7 } },
      { command: 'commit_host_text_export', args: { exportId: 73 } },
      { command: 'discard_host_text_export', args: { exportId: 74 } },
    ])
  }
  console.log('PASS current text export: native eligibility, exact/empty payloads, UTF-8 bounds, scope invalidation, single-flight, focus lifetime, commit boundary, stable errors, and native adapter')
} finally {
  await vite.close()
}
