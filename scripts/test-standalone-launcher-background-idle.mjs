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
const lifecycle = read('src/components/launcher/GlobalLauncherWindowLifecycle.ts')
const host = read('src/launcher/hosts/GlobalLauncherHost.tsx')
const closeApi = read('src/components/launcher/GlobalLauncherClose.ts')

assert.equal(
  packageJson.scripts?.['test:standalone-launcher-background-idle'],
  'node scripts/test-standalone-launcher-background-idle.mjs',
  'package.json must expose standalone launcher background-idle contract',
)

assert.match(
  lifecycle,
  // Renamed to STANDALONE_SURFACE_BACKGROUND_IDLE_MS (the old name survives as a
  // deprecated alias, so the literal is no longer on the old identifier).
  /STANDALONE_SURFACE_BACKGROUND_IDLE_MS\s*=\s*5\s*\*\s*60\s*\*\s*1000/,
  'background idle threshold must be 5 minutes',
)

assert.match(
  lifecycle,
  // Also renamed (…Launcher… → …Surface…); the old name is a re-export alias,
  // so `export function` no longer appears on it.
  /export function isStandaloneSurfaceBackgroundIdle/,
  'pure idle predicate must be exported for tests and reuse',
)

assert.match(
  lifecycle,
  /export function useAutoCloseStandaloneLauncherOnBackgroundIdle/,
  'lifecycle hook must auto-close standalone launcher after background idle',
)

assert.match(
  lifecycle,
  /onCurrentLauncherWindowFocusChanged/,
  'background idle must track native window focus',
)

assert.match(
  lifecycle,
  /isFocused\(\)/,
  'background idle must probe focus on attach so already-backgrounded windows arm the timer',
)

assert.match(
  host,
  /useAutoCloseStandaloneLauncherOnBackgroundIdle\(\{[\s\S]*open[\s\S]*standaloneLauncher[\s\S]*closeLauncher/,
  'GlobalLauncherHost must wire background-idle auto-close for standalone launcher',
)

assert.match(
  closeApi,
  /Esc\s*\/\s*idle close use `auto`/,
  'idle close must keep auto restoreForeground policy documented on the close path',
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
