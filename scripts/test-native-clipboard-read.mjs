#!/usr/bin/env node
/**
 * Desktop clipboard reads must never call the web Clipboard API in Tauri.
 *
 * WKWebView shows a floating English "Paste" chip when JS calls
 * navigator.clipboard.readText() / .read() without a user gesture.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
assert.equal(
  packageJson.scripts?.['test:native-clipboard-read'],
  'node scripts/test-native-clipboard-read.mjs',
  'package.json must expose native clipboard read coverage',
)

const nativeSrc = readFileSync('src/workspace/nativeClipboard.ts', 'utf8')
const pluginClipboardSrc = readFileSync('src/workspace/pluginClipboard.ts', 'utf8')
const launcherReadSrc = readFileSync('src/launcher/clipboard/readLauncherClipboard.ts', 'utf8')
const appSrc = readFileSync('src/App.tsx', 'utf8')
const contextBrokerSrc = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')
const pluginApiSrc = readFileSync('src/workspace/launcher/pluginApi.ts', 'utf8')
const quickEditorSrc = readFileSync('src/workspace/quickEditor/quickEditorActions.ts', 'utf8')
const searchFrameSrc = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')

assert.match(nativeSrc, /isTauriClipboardRuntime/, 'shared Tauri runtime guard')
assert.match(nativeSrc, /readNativeClipboardText/, 'shared native text reader')
assert.match(pluginClipboardSrc, /readNativeClipboardText/, 'plugin clipboard uses shared reader')
assert.match(pluginClipboardSrc, /if \(isTauriClipboardRuntime\(\)\) return null/, 'plugin image read must not fall through in Tauri')
assert.match(launcherReadSrc, /readNativeClipboardText/, 'launcher clipboard uses shared reader')
assert.match(appSrc, /readNativeClipboardText/, 'age tracker uses shared reader')
assert.match(contextBrokerSrc, /readNativeClipboardText/, 'context broker uses shared reader')
assert.match(pluginApiSrc, /readNativeClipboardText/, 'plugin launcher API uses shared reader')
assert.match(quickEditorSrc, /readNativeClipboardText/, 'quick editor uses shared reader')
assert.match(searchFrameSrc, /autoComplete="off"/, 'launcher search must disable webkit autofill paste UI')

for (const [name, src] of [
  ['App.tsx', appSrc],
  ['readLauncherClipboard.ts', launcherReadSrc],
  ['contextBroker.ts', contextBrokerSrc],
  ['pluginApi.ts', pluginApiSrc],
  ['quickEditorActions.ts', quickEditorSrc],
]) {
  assert.doesNotMatch(
    src,
    /await navigator\.clipboard\.read/,
    `${name} must not call the web clipboard read API directly`,
  )
}

function loadNativeClipboard({ tauri, readTextImpl, navigatorReadText } = {}) {
  const out = ts.transpileModule(nativeSrc, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const calls = []
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    navigator: {
      clipboard: {
        readText: navigatorReadText ?? (async () => {
          calls.push(['navigator.readText'])
          return 'from-web'
        }),
      },
    },
  }
  if (tauri) sandbox.__TAURI_INTERNALS__ = {}
  sandbox.globalThis = sandbox
  sandbox.require = (specifier) => {
    if (specifier === '@tauri-apps/plugin-clipboard-manager') {
      return {
        readText: readTextImpl ?? (async () => {
          calls.push(['tauri.readText'])
          return 'from-native'
        }),
      }
    }
    throw new Error(`unexpected require: ${specifier}`)
  }
  vm.runInNewContext(out, sandbox, { filename: 'nativeClipboard.ts' })
  return { api: sandbox.module.exports, calls }
}

{
  const { api, calls } = loadNativeClipboard({ tauri: true })
  const text = await api.readNativeClipboardText()
  assert.equal(text, 'from-native')
  assert.deepEqual(calls, [['tauri.readText']], 'Tauri must use clipboard-manager only')
}

{
  const { api, calls } = loadNativeClipboard({
    tauri: true,
    readTextImpl: async () => {
      calls.push(['tauri.readText.throw'])
      throw new Error('empty pasteboard')
    },
  })
  const text = await api.readNativeClipboardText()
  assert.equal(text, '', 'native throw must become empty string')
  assert.deepEqual(calls, [['tauri.readText.throw']], 'native throw must not fall back to navigator.clipboard.readText')
}

{
  const { api, calls } = loadNativeClipboard({ tauri: false })
  const text = await api.readNativeClipboardText()
  assert.equal(text, 'from-web')
  assert.deepEqual(calls, [['navigator.readText']], 'web runtime may use navigator.clipboard')
}

console.log('native clipboard read contract passed')
