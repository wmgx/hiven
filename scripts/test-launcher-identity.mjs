#!/usr/bin/env node
/**
 * test-launcher-identity.mjs
 * Verifies launcher system identity generation is stable and version/source-free,
 * and that validation rejects duplicate ids and unknown surfaces.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const src = readFileSync('src/workspace/launcher/identity.ts', 'utf8')


// ─── Behavioral checks (transpile + vm, project convention) ─────────────────
// Stub the ./types import so the module is standalone.
const srcStubbed = src.replace(
  /import\s*\{[^}]*\}\s*from\s*'\.\/types'\s*;?\s*\n?/,
  "const isLauncherSurfaceId = (v) => v === 'command-palette' || v === 'global-launcher';\n",
)
const transpiled = ts.transpileModule(srcStubbed, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2023,
    esModuleInterop: true,
  },
}).outputText

const moduleExports = {}
const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console }
vm.runInNewContext(transpiled, sandbox)
const mod = sandbox.module.exports

// Stable & deterministic
assert.equal(
  mod.getPluginLauncherItemKey('web-open', 'baidu'),
  mod.getPluginLauncherItemKey('web-open', 'baidu'),
  'same inputs → same key',
)
assert.equal(mod.getPluginLauncherItemKey('web-open', 'baidu'), 'plugin:web-open:launcher:baidu')
assert.equal(mod.getHostViewItemKey('settings'), 'host:view:settings')
assert.equal(mod.getHostActionItemKey('reload'), 'host:action:reload')

// Round-trip parse
const parsed = mod.parseLauncherItemKey('plugin:web-open:launcher:baidu')
assert.equal(parsed.kind, 'plugin-launcher')
assert.equal(parsed.pluginId, 'web-open')
assert.equal(parsed.itemId, 'baidu')
const parsedCommand = mod.parseLauncherItemKey('plugin:line-tools:command:line-tools.reverse')
assert.equal(parsedCommand.kind, 'unknown', 'old command-adapter keys are not launcher item identities')

// Duplicate ids rejected
const dupErrors = mod.validateLauncherItemIds(['a', 'b', 'a'])
assert.ok(dupErrors.some((e) => e.itemId === 'a' && e.reason === 'duplicate'), 'duplicate id reported')

// Invalid format rejected
const badErrors = mod.validateLauncherItemIds(['bad id!'])
assert.ok(badErrors.some((e) => e.reason === 'invalid-format'), 'invalid format reported')

// Unknown surfaces detected (compare by JSON — vm arrays live in another realm)
assert.equal(JSON.stringify(mod.findUnknownSurfaces(['command-palette'])), '[]', 'valid surface ok')
assert.equal(JSON.stringify(mod.findUnknownSurfaces(['unknown'])), '["unknown"]', 'unknown surface reported')
assert.equal(
  JSON.stringify(mod.sanitizeSurfaces(['command-palette', 'unknown'])),
  '["command-palette"]',
  'sanitize drops unknown',
)

console.log('✓ test-launcher-identity passed')
