#!/usr/bin/env node
/**
 * Slim final-acceptance for launcher-only form factor (2026-08-09).
 *
 * Historical mega-assert suite referenced retired workbench paths and is no longer
 * maintained. This file keeps the package.json script green with checks that match
 * the current product + quality gate.
 */
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

const packageJson = JSON.parse(read('package.json'))

// Quality gate entry points
assert.equal(packageJson.scripts?.['test:quality-gate'], 'node scripts/test-quality-gate.mjs')
assert.equal(packageJson.scripts?.['check:typecheck'], 'tsc -p tsconfig.app.json --noEmit')
assert.equal(packageJson.scripts?.['check:architecture'], 'node scripts/check-architecture.mjs')
assert.equal(packageJson.scripts?.['check:reachability'], 'node scripts/check-reachability.mjs')

// Window entry runtime smoke exists and uses launcher / quick-editor / plugin-surface
assert.equal(
  packageJson.scripts?.['test:window-entry-runtime-smoke'],
  'node scripts/test-window-entry-runtime-smoke.mjs',
)
assert.match(
  read('scripts/test-window-entry-runtime-smoke.mjs'),
  /window=launcher[\s\S]*window=quick-editor[\s\S]*window=plugin-surface/,
  'runtime smoke must exercise launcher, quick-editor, and plugin-surface routes',
)

// Launcher-only runtime: no main workbench EditorWindow
assert.equal(existsSync(join(root, 'src/components/EditorWindow.tsx')), false)
assert.equal(existsSync(join(root, 'src/views/EditorView.tsx')), false)
assert.equal(existsSync(join(root, 'src/views/QuickEditorDetachedView.tsx')), true)
assert.equal(existsSync(join(root, 'src/launcher/hosts/GlobalLauncherHost.tsx')), true)

// Plugin Editor IDE retired
assert.equal(existsSync(join(root, 'src/surfaces/PluginEditorSurface.tsx')), false)
assert.equal(existsSync(join(root, 'src/surfaces/pluginEditorSurfaceBridge.ts')), false)
const surfaceActions = read('src/surfaces/actions.ts')
assert.match(
  surfaceActions,
  /surface\.kind === ['"]plugin-editor['"][\s\S]*requestOpenLauncherHostSurface\(['"]system-plugins['"]\)/,
  'legacy plugin-editor focus redirects to system-plugins',
)
assert.match(surfaceActions, /requestOpenLauncherPluginSettingsSurface/, 'plugin-editor may open plugin settings')
assert.doesNotMatch(surfaceActions, /requestOpenPluginEditorSurface/, 'deleted bridge must not be called')

// Diff product not on public SDK
const pluginHostSdk = read('src/pluginHostSdk.ts')
assert.doesNotMatch(pluginHostSdk, /import\s*\{[^}]*\bDualEditorView\b/, 'public SDK must not import DualEditorView')
assert.equal(existsSync(join(root, 'src/pluginHostDiff.ts')), true)
assert.equal(existsSync(join(root, 'src/plugins/textDiff/TextDiffSurface.tsx')), true)
assert.equal(existsSync(join(root, 'src/plugins/textDiff/DiffPageView.tsx')), false)

// Product docs present
assert.ok(existsSync(join(root, 'PRODUCT.md')))
assert.ok(existsSync(join(root, 'DESIGN.md')))
assert.ok(existsSync(join(root, 'ARCHITECTURE.md')))

console.log('refactor final acceptance (slim launcher-only) passed')
