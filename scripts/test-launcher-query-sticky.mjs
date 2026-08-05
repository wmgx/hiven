#!/usr/bin/env node
/**
 * Launcher sticky query — blur leave-to-copy resume
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

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
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, Date, JSON, Map, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const sticky = transpileAndRun('src/launcher/querySticky.ts')
const surface = 'global-launcher'

sticky.clearAllStickyLauncherQueries()

// Empty query does not sticky
sticky.saveStickyLauncherQuery(surface, '   ')
assert.equal(sticky.consumeStickyLauncherQuery(surface), null, 'blank query should not sticky')

// Save + consume restores
sticky.saveStickyLauncherQuery(surface, '42 * 1.0')
assert.equal(sticky.peekStickyLauncherQuery(surface), '42 * 1.0')
assert.equal(sticky.consumeStickyLauncherQuery(surface), '42 * 1.0', 'consume returns saved query')
assert.equal(sticky.consumeStickyLauncherQuery(surface), null, 'consume is one-shot')

// TTL expiry
const now = Date.now()
sticky.saveStickyLauncherQuery(surface, '100 + 20', now)
assert.equal(
  sticky.consumeStickyLauncherQuery(surface, now + sticky.LAUNCHER_QUERY_STICKY_TTL_MS + 1),
  null,
  'expired sticky should drop',
)

// discard path
sticky.saveStickyLauncherQuery(surface, 'still here')
sticky.clearStickyLauncherQuery(surface)
assert.equal(sticky.consumeStickyLauncherQuery(surface), null, 'clear drops sticky')

// max chars guard
const long = 'x'.repeat(sticky.LAUNCHER_QUERY_STICKY_MAX_CHARS + 50)
sticky.saveStickyLauncherQuery(surface, long)
const restored = sticky.consumeStickyLauncherQuery(surface)
assert.equal(restored.length, sticky.LAUNCHER_QUERY_STICKY_MAX_CHARS, 'sticky query is capped')

// Wiring: open edge consumes sticky; after-action discards
const lifecycle = readFileSync('src/components/launcher/GlobalLauncherHostLifecycle.ts', 'utf8')
assert.match(lifecycle, /consumeStickyLauncherQuery/, 'open edge restores sticky query')
assert.match(lifecycle, /global-launcher/, 'sticky surface is global-launcher')

const host = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
assert.match(host, /saveStickyLauncherQuery/, 'blur/esc close saves sticky query')
assert.match(host, /discardQuery:\s*true/, 'after-action discards sticky query')
assert.match(host, /clearStickyLauncherQuery/, 'discard path clears sticky')

console.log('test-launcher-query-sticky: ok')
