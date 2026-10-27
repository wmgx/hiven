#!/usr/bin/env node
/**
 * Standalone global launcher: auto-exit after 5 min continuous background.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function loadTs(path, importStubs = []) {
  let src = readFileSync(path, 'utf8')
  for (const [importMatch, replacement] of importStubs) {
    src = src.replace(importMatch, replacement)
  }
  // Strip remaining ESM imports (React hooks etc. not needed for pure helpers).
  src = src.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
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
    require: () => {
      throw new Error('unexpected require while loading pure helpers')
    },
  }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const packageJson = JSON.parse(read('package.json'))

assert.equal(
  packageJson.scripts?.['test:standalone-launcher-background-idle'],
  'node scripts/test-standalone-launcher-background-idle.mjs',
  'package.json must expose standalone launcher background-idle contract',
)

const {
  STANDALONE_LAUNCHER_BACKGROUND_IDLE_MS,
  isStandaloneLauncherBackgroundIdle,
} = loadTs('src/components/launcher/GlobalLauncherWindowLifecycle.ts')

assert.equal(
  STANDALONE_LAUNCHER_BACKGROUND_IDLE_MS,
  5 * 60 * 1000,
  'exported idle constant must equal 5 minutes',
)

const t0 = 1_700_000_000_000

assert.equal(
  isStandaloneLauncherBackgroundIdle(null, t0),
  false,
  'focused / unknown unfocusedAt must not close',
)

assert.equal(
  isStandaloneLauncherBackgroundIdle(undefined, t0),
  false,
  'missing unfocusedAt must not close',
)

assert.equal(
  isStandaloneLauncherBackgroundIdle(t0, t0 + 5 * 60 * 1000 - 1),
  false,
  'just under 5 minutes must not close',
)

assert.equal(
  isStandaloneLauncherBackgroundIdle(t0, t0 + 5 * 60 * 1000),
  true,
  'exactly 5 minutes unfocused must close',
)

assert.equal(
  isStandaloneLauncherBackgroundIdle(t0, t0 + 5 * 60 * 1000 + 1),
  true,
  'over 5 minutes unfocused must close',
)

assert.equal(
  isStandaloneLauncherBackgroundIdle(t0, t0 + 1000, 500),
  true,
  'custom idleMs must be honored when elapsed',
)

assert.equal(
  isStandaloneLauncherBackgroundIdle(t0, t0 + 100, 500),
  false,
  'custom idleMs must not fire early',
)

assert.equal(
  isStandaloneLauncherBackgroundIdle(Number.NaN, t0),
  false,
  'invalid unfocusedAt must not close',
)

console.log('standalone-launcher-background-idle: ok')
