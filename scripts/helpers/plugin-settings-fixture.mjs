// Actual production stores and backgrounds in separate VM windows. Every I/O boundary is synthetic.
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { createContext, Script } from 'node:vm'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const compiled = new Map()
export const settingsKey = 'hiven-plugin-settings'
export const plain = (value) => JSON.parse(JSON.stringify(value))
export const settle = async () => { for (let i = 0; i < 12; i++) await Promise.resolve() }

export function sharedSettingsStorage() {
  const values = new Map()
  return {
    writes: 0,
    failWrite: () => undefined,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, value) {
      const error = this.failWrite(++this.writes)
      if (error) throw error
      values.set(key, String(value))
    },
    removeItem: (key) => values.delete(key),
    clear: () => values.clear(),
    persisted: () => JSON.parse(values.get(settingsKey)).state.pluginSettings,
  }
}

export function settingsWindow(storage, { backgrounds = false } = {}) {
  const events = new Map()
  const modules = new Map()
  const mocks = new Map()
  const counts = { starts: 0, watches: 0, stops: 0, otherStarts: 0, captures: [] }
  let changeHandler
  const forbidden = () => { throw new Error('External I/O is forbidden in plugin settings tests') }
  const window = {
    localStorage: storage,
    addEventListener(type, listener) {
      if (!events.has(type)) events.set(type, new Set())
      events.get(type).add(listener)
    },
    removeEventListener: (type, listener) => events.get(type)?.delete(listener),
  }
  const context = createContext({ window, localStorage: storage, console, fetch: forbidden, TextEncoder })
  function load(file) {
    if (mocks.has(file)) return mocks.get(file)
    if (modules.has(file)) return modules.get(file).exports
    const module = { exports: {} }
    modules.set(file, module)
    if (!compiled.has(file)) {
      const source = readFileSync(file, 'utf8')
      compiled.set(file, file.endsWith('.ts') ? ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
        fileName: file,
      }).outputText : source)
    }
    const scopedRequire = (specifier) => {
      if (specifier === 'react') return require(specifier)
      if (specifier === 'zustand' || specifier.startsWith('zustand/')) return load(require.resolve(specifier))
      assert.ok(specifier.startsWith('.'), `Unexpected module: ${specifier}`)
      let target = resolve(dirname(file), specifier)
      if (!existsSync(target)) target += '.ts'
      return load(target)
    }
    new Script(`(function(require,module,exports){${compiled.get(file)}\n})`, { filename: file })
      .runInContext(context)(scopedRequire, module, module.exports)
    return module.exports
  }
  const path = (file) => resolve(root, file)
  mocks.set(path('src/store.ts'), { useAppStore: { getState: () => ({ locale: 'en' }) } })
  mocks.set(path('src/workspace/pluginStore.ts'), {
    usePluginStore: { getState: () => ({ plugins: { 'clipboard-history': { source: 'builtin' } } }) },
  })
  for (const [file, factory] of [
    ['pluginStorage', 'createPluginPrivateStorage'], ['pluginPaste', 'createPluginPaste'],
    ['pluginNetwork', 'createPluginNetwork'], ['pluginShell', 'createPluginShell'], ['ai/runtime', 'createPluginAi'],
  ]) mocks.set(path(`src/workspace/${file}.ts`), { [factory]: () => ({}) })
  mocks.set(path('src/workspace/pluginClipboard.ts'), {
    createPluginClipboard: () => ({ watch: async (_options, handler) => {
      counts.watches++
      changeHandler = handler
      return () => { counts.stops++; if (changeHandler === handler) changeHandler = undefined }
    } }),
  })
  mocks.set(path('src/workspace/toast.ts'), { showToast: forbidden })
  mocks.set(path('src/i18n/pluginI18nRegistry.ts'), { makePluginT: () => (key) => key })
  mocks.set(path('src/plugins/clipboard-history/storage/clipboardHistoryRepository.ts'), {
    createClipboardHistoryRepository: () => ({
      getListItems: async () => [],
      addItem: async (input) => counts.captures.push(input.text),
      pruneItems: async () => undefined,
    }),
  })
  const { DEFAULT_CLIPBOARD_HISTORY_SETTINGS: defaults } = load(path('src/plugins/clipboard-history/settings/model.ts'))
  const { clipboardHistoryBackground } = load(path('src/plugins/clipboard-history/background/clipboardHistoryBackground.ts'))
  const manifest = JSON.parse(readFileSync(path('src/plugins/clipboard-history/manifest.json'), 'utf8'))
  const definition = { settings: { defaultValue: defaults }, background: {
    start(ctx) { counts.starts++; return clipboardHistoryBackground.start(ctx) },
  } }
  const entries = [
    { pluginId: manifest.pluginId, source: 'production', permissions: manifest.permissions, definition },
    { pluginId: 'other-background', source: 'production', permissions: [], definition: {
      settings: { defaultValue: {} }, background: { start() { counts.otherStarts++ } },
    } },
  ]
  mocks.set(path('src/workspace/pluginRegistry.ts'), { pluginRegistry: { getAllPluginDefinitions: () => entries } })
  const { usePluginSettingsStore: store, resolvePluginSettings } = load(path('src/workspace/pluginSettingsStore.ts'))
  const permissions = load(path('src/workspace/pluginPermissions.ts'))
  const manager = backgrounds ? load(path('src/workspace/pluginBackgroundManager.ts')) : undefined
  return {
    store, defaults, manager, permissions, manifest, counts,
    enabled: () => resolvePluginSettings('builtin', manifest.pluginId, definition.settings).value.enabled,
    setEnabled: (enabled) => store.getState().setPluginSettings('builtin', manifest.pluginId, { ...defaults, enabled }, 1),
    event(key = settingsKey, extra = {}) {
      for (const listener of events.get('storage') ?? []) listener({ key, storageArea: storage, ...extra })
    },
    copySyntheticText: (text) => changeHandler?.({ kind: 'text', text, byteSize: text.length, hash: text }),
  }
}
