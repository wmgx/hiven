// Real store + isolated Zustand modules, with fake in-memory storage and forbidden external I/O.
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createContext, Script } from 'node:vm'
import ts from 'typescript'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const compiled = new Map()
export const plain = (value) => JSON.parse(JSON.stringify(value))

export function sharedStorage(initial) {
  const values = new Map()
  if (initial !== undefined) values.set('hiven-settings', JSON.stringify({ state: initial, version: 0 }))
  const storage = {
    writes: 0, failReads: false, failWrites: false,
    getItem(key) { if (storage.failReads) throw new Error('Synthetic storage read failure'); return values.get(key) ?? null },
    setItem(key, value) {
      if (storage.failWrites) throw new Error('Synthetic storage write failure')
      storage.writes++; values.set(key, String(value))
    },
    removeItem(key) { values.delete(key) },
    clear() { values.clear() },
    persisted() { return JSON.parse(storage.getItem('hiven-settings'))?.state },
  }
  return storage
}

export function windowStore(storage, { unavailable = false } = {}) {
  const listeners = new Map()
  const window = {
    get localStorage() { if (unavailable) throw new Error('Synthetic unavailable storage'); return storage },
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name).add(callback)
    },
  }
  const context = createContext({ window, localStorage: storage, AbortController, console })
  const modules = new Map()
  function load(file) {
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
      // Unused I/O boundaries throw if accidentally reached; tested store/helpers are real.
      if (specifier === '@tauri-apps/api/core') return { invoke() { throw new Error('Native calls forbidden in pure tests') } }
      if (specifier === '../effectRunner') return { openExternalUrl() { throw new Error('URL opening forbidden in pure tests') } }
      if (specifier === '../../i18n') return { pickLocale() { throw new Error('Unrelated localized UI is outside this test') } }
      if (specifier === 'react') return require(specifier)
      if (specifier.startsWith('zustand')) return load(require.resolve(specifier))
      assert.ok(specifier.startsWith('.'), `Unexpected module: ${specifier}`)
      const base = resolve(dirname(file), specifier)
      const target = [base, `${base}.ts`, `${base}.js`, resolve(base, 'index.ts')].find(existsSync)
      assert.ok(target, `Unresolved module: ${specifier}`)
      return load(target)
    }
    new Script(`(function(require,module,exports){${compiled.get(file)}\n})`, { filename: file })
      .runInContext(context)(scopedRequire, module, module.exports)
    return module.exports
  }
  const exported = load(resolve(root, 'src/store.ts'))
  const helpers = load(resolve(root, 'src/workspace/appLauncher/appSearchAliases.ts'))
  let hydrations = 0
  exported.useAppStore.persist?.onHydrate(() => hydrations++)
  return {
    ...exported, ...helpers,
    state: () => exported.useAppStore.getState(),
    get hydrations() { return hydrations },
    event(key = 'hiven-settings') {
      for (const callback of listeners.get('storage') ?? []) callback({ key, storageArea: storage })
    },
  }
}

