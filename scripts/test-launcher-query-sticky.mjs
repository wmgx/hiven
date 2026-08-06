#!/usr/bin/env node
/**
 * Launcher sticky query — blur leave-to-copy resume
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function createSessionStorage() {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(String(k), String(v)) },
    removeItem: (k) => { map.delete(k) },
    clear: () => { map.clear() },
    get length() { return map.size },
    key: (i) => [...map.keys()][i] ?? null,
  }
}

function transpileAndRun(path, globals = {}) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    Date,
    JSON,
    Map,
    sessionStorage: createSessionStorage(),
    ...globals,
  }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const sticky = transpileAndRun('src/launcher/querySticky.ts')
const surface = 'global-launcher'

sticky.clearAllStickyLauncherQueries()

// Empty query does not sticky and does not wipe
sticky.saveStickyLauncherQuery(surface, 'keep-me')
sticky.saveStickyLauncherQuery(surface, '   ')
assert.equal(sticky.peekStickyLauncherQuery(surface), 'keep-me', 'empty save must not wipe sticky')

// Save + peek restores without consuming
sticky.clearAllStickyLauncherQueries()
sticky.saveStickyLauncherQuery(surface, '42 * 1.0')
assert.equal(sticky.peekStickyLauncherQuery(surface), '42 * 1.0')
assert.equal(sticky.peekStickyLauncherQuery(surface), '42 * 1.0', 'peek is non-destructive')

// consume is one-shot
assert.equal(sticky.consumeStickyLauncherQuery(surface), '42 * 1.0')
assert.equal(sticky.consumeStickyLauncherQuery(surface), null, 'consume is one-shot')

// TTL expiry
const now = Date.now()
sticky.saveStickyLauncherQuery(surface, '100 + 20', now)
assert.equal(
  sticky.peekStickyLauncherQuery(surface, now + sticky.LAUNCHER_QUERY_STICKY_TTL_MS + 1),
  null,
  'expired sticky should drop',
)

// discard path
sticky.saveStickyLauncherQuery(surface, 'still here')
sticky.clearStickyLauncherQuery(surface)
assert.equal(sticky.peekStickyLauncherQuery(surface), null, 'clear drops sticky')

// max chars guard
const long = 'x'.repeat(sticky.LAUNCHER_QUERY_STICKY_MAX_CHARS + 50)
sticky.saveStickyLauncherQuery(surface, long)
const restored = sticky.peekStickyLauncherQuery(surface)
assert.equal(restored.length, sticky.LAUNCHER_QUERY_STICKY_MAX_CHARS, 'sticky query is capped')

// sessionStorage survives memory clear (simulates remount reading storage)
sticky.clearAllStickyLauncherQueries()
const sticky2 = transpileAndRun('src/launcher/querySticky.ts')
// share: write via sticky2, wipe its memory map by loading fresh module with same storage
const storage = createSessionStorage()
const stickyA = transpileAndRun('src/launcher/querySticky.ts', { sessionStorage: storage })
stickyA.saveStickyLauncherQuery(surface, 'from-storage')
// new module instance, same storage — memory empty, storage has record
const stickyB = transpileAndRun('src/launcher/querySticky.ts', { sessionStorage: storage })
assert.equal(stickyB.peekStickyLauncherQuery(surface), 'from-storage', 'sessionStorage backs sticky across remount')

// Wiring: open edge peeks sticky; after-action discards
const lifecycle = readFileSync('src/components/launcher/GlobalLauncherHostLifecycle.ts', 'utf8')
assert.match(lifecycle, /peekStickyLauncherQuery/, 'open edge peeks sticky query (not one-shot consume)')
assert.match(lifecycle, /global-launcher/, 'sticky surface is global-launcher')
assert.doesNotMatch(lifecycle, /consumeStickyLauncherQuery/, 'open edge must not consume (StrictMode safe)')
assert.match(lifecycle, /startTransition/, 'sticky restore is non-urgent')
assert.match(lifecycle, /requestAnimationFrame/, 'sticky restore deferred past first paint')
// Open path must start empty so ranking/dynamic use empty-open fast path
assert.match(
  lifecycle,
  /setQuery\(''\)[\s\S]*peekStickyLauncherQuery[\s\S]*startTransition/,
  'empty open first, then deferred sticky restore',
)

const host = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
assert.match(host, /saveStickyLauncherQuery/, 'blur/esc close saves sticky query')
assert.match(host, /discardQuery:\s*true/, 'after-action discards sticky query')
assert.match(host, /clearStickyLauncherQuery/, 'discard path clears sticky')
assert.match(host, /closingRef/, 'double-close guard present')
assert.match(host, /inputRef\.current\?\.value/, 'prefer live input value when saving')

console.log('test-launcher-query-sticky: ok')
