#!/usr/bin/env node
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const source = readFileSync('src/workspace/launcher/favoriteAvailability.ts', 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023 },
}).outputText
const module = { exports: {} }
vm.runInNewContext(compiled, { module, exports: module.exports })
const { describeFavoriteApp } = module.exports
const prefix = 'host:app-launcher:app:'
const first = { appId: 'linux:desktop:synthetic-a.desktop', name: 'Same editor' }
const second = { appId: 'linux:desktop:synthetic-b.desktop', name: 'Same editor' }
const apps = [first, second]
const ready = { status: 'ready', apps }

for (const app of apps) {
  const result = describeFavoriteApp(prefix + app.appId, ready)
  assert.equal(result.status, 'available')
  assert.equal(result.app, app, 'full colon-containing ID identifies each same-name app independently')
}
for (const appId of ['Same editor', 'linux:desktop:synthetic', first.appId.toUpperCase()]) {
  assert.equal(describeFavoriteApp(prefix + appId, ready).status, 'not-found', 'names, prefixes and case-folded IDs never substitute for exact identity')
}
for (const status of ['loading', 'error', 'unknown']) {
  for (const snapshot of [apps, []]) {
    const result = describeFavoriteApp(prefix + first.appId, { status, apps: snapshot })
    assert.equal(result.status, status === 'loading' ? 'loading' : 'unknown')
    assert.equal(result.app, undefined, 'pending/failed scans cannot reuse stale app identity')
  }
}
const absent = describeFavoriteApp(prefix + first.appId, { status: 'ready', apps: [] })
assert.equal(absent.status, 'not-found', 'successful empty scan only reports not-found, never uninstalled')
assert.equal(absent.app, undefined)
for (const key of [prefix, 'plugin:example:tool', 'host:app-launcher:refresh', 'host:app-launcher:appx:other', ` ${prefix}${first.appId}`]) {
  for (const status of ['loading', 'ready', 'error', 'unknown']) {
    assert.equal(describeFavoriteApp(key, { status, apps }).status, 'unknown', 'unsupported or malformed keys cannot inherit app availability')
  }
}
assert.equal(describeFavoriteApp(prefix + first.appId, ready).status, 'available', 'restored catalog identity becomes available again')
console.log('✓ test-favorite-availability passed')
