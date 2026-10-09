#!/usr/bin/env node
// Production clipboard watcher + history background + repository, entirely in memory.
// No OS clipboard, user history, filesystem fixtures, or file contents are read.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

let clipboardText = ''
let nativePaths = []
const nativeCalls = []
let poll
const memory = new Map()
const storage = {
  kv: {
    get: async (key) => structuredClone(memory.get(key)),
    set: async (key, value) => { memory.set(key, structuredClone(value)) },
    delete: async (key) => { memory.delete(key) },
  },
  blob: { delete: async () => { throw new Error('No blobs should be deleted') } },
}
function load(path, modules = {}) {
  const code = ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  const exports = {}
  vm.runInNewContext(code, {
    exports, module: { exports }, console, Date, TextEncoder, structuredClone,
    setInterval: (fn) => { poll = fn; return 1 },
    clearInterval: () => { poll = undefined },
    require(name) {
      assert.ok(Object.hasOwn(modules, name), `Unexpected dependency ${name} in ${path}`)
      return modules[name]
    },
  }, { filename: path })
  return exports
}
const native = { readNativeClipboardText: async () => clipboardText, isTauriClipboardRuntime: () => true }
const ipc = { invoke: async (command) => {
  nativeCalls.push(command)
  if (command === 'current_foreground_app_name') return 'Synthetic QA'
  if (command === 'read_clipboard_file_paths') return nativePaths
  throw new Error(`Unexpected native action: ${command}`)
} }
const clipboard = load('src/workspace/pluginClipboard.ts', {
  './nativeClipboard': native, './pluginPermissions': {}, '@tauri-apps/api/core': ipc,
}).createPluginClipboard('clipboard-history', undefined, storage)
const cache = load('src/plugins/clipboard-history/storage/clipboardHistoryCache.ts')
const store = load('src/plugins/clipboard-history/storage/clipboardHistoryStore.ts')
const repositoryModule = load('src/plugins/clipboard-history/storage/clipboardHistoryRepository.ts', {
  './clipboardHistoryStore': store, './clipboardHistoryCache': cache,
})
const repository = repositoryModule.createClipboardHistoryRepository(storage)
const settings = load('src/plugins/clipboard-history/settings/model.ts').DEFAULT_CLIPBOARD_HISTORY_SETTINGS
const background = load('src/plugins/clipboard-history/background/clipboardHistoryBackground.ts', {
  '../storage/clipboardHistoryRepository': repositoryModule,
}).clipboardHistoryBackground
const now = Date.now()
const legacy = await repository.addItem({
  kind: 'files', paths: ['/synthetic/old folder', '/synthetic/missing.txt'],
  fileNames: ['old folder', 'missing.txt'], byteSize: 45, hash: 'legacy-paths',
})
const originalLegacy = structuredClone(await repository.getItem(legacy.id))
const stop = await background.start({
  settings: { ...settings, enabled: true, recordImages: false, recordFiles: true },
  clipboard, storage, t: (key) => key,
  showMessage: (message) => { throw new Error(message) },
})
assert.equal(typeof stop, 'function')
const cases = [
  '/synthetic/report.json', '/synthetic/directory', '/synthetic/not-found.txt',
  '/synthetic/with spaces.csv', '  /synthetic/preserved spaces.txt  ',
  '/synthetic/one.txt\n/synthetic/two.json', '/synthetic/one.txt\r\n/synthetic/two.json',
  'file:///synthetic/with%20spaces.txt', 'https://example.test/data.json',
  'C:\\synthetic\\report.txt', '\\\\synthetic-server\\share\\report.txt', '~/synthetic.txt',
  '/开头只是普通正文，并非文件', '请打开 /synthetic/report.json',
  '/synthetic/first.txt\n这里是第二行正文', 'report.json',
]
const flush = async () => { for (let i = 0; i < 100; i++) await Promise.resolve() }
for (const text of cases) {
  clipboardText = text
  await poll()
  await flush()
  const items = await repository.getAllItems()
  const recorded = items.find((item) => item.kind === 'text' && item.text === text)
  assert.ok(recorded, `Preserve exact path-shaped text: ${text}`)
  assert.equal(recorded.kind, 'text')
}
assert.equal((await repository.getAllItems()).filter((item) => item.kind === 'files').length, 1)
assert.deepEqual(await repository.getItem(legacy.id), originalLegacy, 'Legacy records remain byte-for-byte compatible')
assert.ok((await repository.getListItems()).some((item) => item.id === legacy.id && item.kind === 'files'))
assert.equal(nativeCalls.includes('read_clipboard_file_paths'), false, 'History never fabricates or resolves file objects')
stop()
assert.equal(poll, undefined)

// Turning off text recording must not resume path capture via the old setting.
const count = (await repository.getAllItems()).length
const stopDisabled = await background.start({
  settings: { ...settings, enabled: true, recordText: false, recordImages: false, recordFiles: true },
  clipboard, storage, t: (key) => key, showMessage: assert.fail,
})
clipboardText = '/synthetic/must-not-record.txt'
await poll(); await flush()
assert.equal((await repository.getAllItems()).length, count)
stopDisabled()

const content = load('src/kits/content/detectContent.ts')
const snapshot = load('src/launcher/clipboard/clipboardSnapshot.ts', { '../../kits/content/index': content })
const attach = load('src/launcher/clipboard/attachPolicy.ts', {
  '../../kits/content/index': content, './clipboardSnapshot': snapshot,
})
const blocks = load('src/launcher/clipboard/objectBlock.ts', { './clipboardSnapshot': snapshot, './attachPolicy': attach })
const material = load('src/launcher/clipboard/fileTextMaterial.ts', { './clipboardSnapshot': snapshot, './objectBlock': blocks })
// Synthetic strings only: neither filename suffixes nor a higher URL/JSON score
// may bypass the clipboard's existing sensitive-content masking policy.
for (const text of [
  'password=synthetic-placeholder.json', '/synthetic/token-placeholder.txt',
  'https://example.test/?token=synthetic-placeholder.json', '{"password":"synthetic-placeholder.json"}',
]) {
  assert.equal(snapshot.detectClipboardType(text), 'secret-like')
  assert.equal(attach.findStrongClipboardAttachHits(text)[0].kind, 'secret-like')
  const block = blocks.createClipboardObjectBlock(snapshot.updateClipboardSnapshot(text))
  assert.equal(block.secretMasked, true)
  assert.equal(block.preview, undefined)
  assert.equal(material.getAttachedTextFilePath(block), null, 'Masked material must not offer a guessed file read')
}
assert.equal(snapshot.detectClipboardType('curl /synthetic/report.json'), 'command')
const reader = load('src/launcher/clipboard/readLauncherClipboard.ts', {
  './clipboardSnapshot': snapshot, '../../workspace/nativeClipboard': native,
  '../../workspace/launcher/perf': { launcherPerfNow: () => 0, logLauncherPerfDuration() {} },
  '@tauri-apps/api/core': ipc,
})
for (const text of ['/synthetic/one.json', 'report.json', 'C:\\synthetic\\report.sql', 'file:///synthetic/one.csv']) {
  assert.equal(snapshot.detectClipboardType(text), 'text')
}
nativePaths = ['/synthetic/with spaces.txt', '/synthetic/二.json']
clipboardText = ''
assert.equal(await reader.readLauncherClipboard(), nativePaths.join('\n'), 'Native list keeps every path, never first-file-only')
nativePaths = []
clipboardText = '/synthetic/not-found.json'
assert.equal(await reader.readLauncherClipboard(), clipboardText)
for (const text of ['https://example.test/report.json', 'https://example.test/data.csv']) {
  const before = nativeCalls.length
  clipboardText = text
  assert.equal(await reader.readLauncherClipboard(), text)
  assert.equal(snapshot.detectClipboardType(text), 'url')
  assert.equal(nativeCalls.length, before, 'URLs do not trigger file resolution')
}
assert.ok(Date.now() >= now)
console.log('Clipboard file classification passed: 16 literal text cases, recording off, legacy preservation, native multi-path retention, URL isolation and sensitive-content priority')
