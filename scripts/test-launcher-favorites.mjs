#!/usr/bin/env node
/**
 * test-launcher-favorites.mjs — pure favorites helpers + action recommendation cap.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function loadTs(path, importStub = '') {
  let src = readFileSync(path, 'utf8')
  if (importStub) {
    src = src.replace(/import\s*(?:type\s*)?\{[^}]*\}\s*from\s*'[^']*'\s*;?\s*\n?/g, importStub)
  }
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const fav = loadTs('src/workspace/launcher/favorites.ts', '')

/** Clone out of the vm realm so assert.deepEqual works (Node cross-realm arrays). */
const asArr = (v) => Array.from(v ?? [])

assert.deepEqual(asArr(fav.emptyLauncherFavorites()), [])
assert.equal(fav.isLauncherFavorite([], 'a'), false)

let keys = asArr(fav.toggleLauncherFavorite([], 'plugin:x:launcher:a'))
assert.deepEqual(keys, ['plugin:x:launcher:a'])
keys = asArr(fav.toggleLauncherFavorite(keys, 'plugin:x:launcher:b'))
assert.deepEqual(keys, ['plugin:x:launcher:b', 'plugin:x:launcher:a'], 'newest pin first')
keys = asArr(fav.toggleLauncherFavorite(keys, 'plugin:x:launcher:a'))
assert.deepEqual(keys, ['plugin:x:launcher:b'], 'toggle off removes')
assert.ok(fav.isLauncherFavorite(['plugin:x:launcher:b'], 'plugin:x:launcher:b'))

// Cap
let capped = []
for (let i = 0; i < fav.LAUNCHER_FAVORITES_MAX + 5; i++) {
  capped = asArr(fav.toggleLauncherFavorite(capped, `k${i}`))
}
assert.equal(capped.length, fav.LAUNCHER_FAVORITES_MAX, 'favorites hard-capped')
assert.equal(capped[0], `k${fav.LAUNCHER_FAVORITES_MAX + 4}`, 'newest pin at front when capped')

assert.deepEqual(asArr(fav.normalizeLauncherFavorites([' a ', '', 1, 'a', 'b', 'a'])), ['a', 'b'])
assert.deepEqual(asArr(fav.normalizeLauncherFavorites(null)), [])

// Recommendation cap constant present
const recSrc = readFileSync('src/launcher/clipboard/actionRecommendation.ts', 'utf8')
assert.match(recSrc, /RECOMMENDED_ACTIONS_MAX\s*=\s*5/, 'recommended actions capped at 5')
assert.match(recSrc, /\.slice\(0,\s*RECOMMENDED_ACTIONS_MAX\)/, 'merge path applies cap')

console.log('✓ test-launcher-favorites passed')
