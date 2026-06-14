#!/usr/bin/env node

/**
 * Clipboard History Plugin — Architecture Boundary Tests
 *
 * Verifies:
 * 1. clipboard-history directory structure exists
 * 2. index.tsx only does definePlugin assembly (no large JSX)
 * 3. No forbidden imports (host deep paths, @tauri-apps/*)
 * 4. SDK types export required plugin surface/background/storage/clipboard/paste types
 * 5. PluginDefinition includes ui.surfaces and background
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

// ─── 1. Directory structure ─────────────────────────────────────────────────

const requiredDirs = [
  'src/plugins/clipboard-history/surfaces',
  'src/plugins/clipboard-history/settings',
  'src/plugins/clipboard-history/background',
  'src/plugins/clipboard-history/storage',
]

for (const dir of requiredDirs) {
  assert.ok(existsSync(join(root, dir)), `Required directory missing: ${dir}`)
}

// ─── 2. index.tsx must only do assembly ─────────────────────────────────────

const indexPath = 'src/plugins/clipboard-history/index.tsx'
if (existsSync(join(root, indexPath))) {
  const indexContent = read(indexPath)
  // Should not contain large JSX blocks (more than 5 JSX return statements)
  const jsxReturns = (indexContent.match(/return\s*\(/g) || []).length
  assert.ok(jsxReturns <= 2, `index.tsx should only do assembly, found ${jsxReturns} return statements with JSX`)

  // Should not contain CSS strings
  assert.doesNotMatch(indexContent, /`[^`]{200,}`/, 'index.tsx should not contain large template strings (CSS/HTML)')

  // Should import from local modules
  assert.match(indexContent, /from\s+['"]\.\//, 'index.tsx should import from local modules')
  assert.match(indexContent, /definePlugin/, 'index.tsx should use definePlugin')
}

// ─── 3. Forbidden imports ────────────────────────────────────────────────────

const pluginDir = join(root, 'src/plugins/clipboard-history')
const importRe = /\b(?:import|export)\s+(?:[^'"]*?\s+from\s+)?['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g

function walkFiles(dir) {
  if (!existsSync(dir)) return []
  const out = []
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name)
    if (name.isDirectory()) {
      out.push(...walkFiles(full))
    } else if (/\.(ts|tsx|js|jsx)$/.test(name.name)) {
      out.push(full)
    }
  }
  return out
}

const forbiddenImportPatterns = [
  { pattern: /^\.\.\/\.\.\/store/, label: 'must not import host store' },
  { pattern: /^\.\.\/\.\.\/workspace/, label: 'must not import host workspace' },
  { pattern: /^\.\.\/\.\.\/components/, label: 'must not import host components' },
  { pattern: /^\.\.\/\.\.\/i18n/, label: 'must not import host i18n deep path' },
  { pattern: /^\.\.\/\.\.\/kits/, label: 'must not import host kits' },
  { pattern: /@tauri-apps\//, label: 'must not import @tauri-apps directly' },
]

for (const file of walkFiles(pluginDir)) {
  const text = readFileSync(file, 'utf8')
  let match
  importRe.lastIndex = 0
  while ((match = importRe.exec(text))) {
    const spec = match[1] ?? match[2]
    for (const { pattern, label } of forbiddenImportPatterns) {
      assert.ok(!pattern.test(spec), `${file.replace(root + '/', '')} ${label}: imports "${spec}"`)
    }
  }
}

// ─── 4. SDK types include surface/background/storage/clipboard/paste ────────

const pluginTypes = read('src/workspace/pluginTypes.ts')

// PluginDefinition must include ui field
assert.match(pluginTypes, /ui\?.*PluginUiContribution|ui\?\s*:\s*\{/, 'PluginDefinition must include ui field')

// PluginDefinition must include background field
assert.match(pluginTypes, /background\?.*PluginBackgroundContribution/, 'PluginDefinition must include background field')

// Must export surface-related types
assert.match(pluginTypes, /PluginUiSurfaceContribution/, 'Must define PluginUiSurfaceContribution type')
assert.match(pluginTypes, /PluginSurfaceProps/, 'Must define PluginSurfaceProps type')
assert.match(pluginTypes, /PluginSurfaceHostApi/, 'Must define PluginSurfaceHostApi type')

// Must export background-related types
assert.match(pluginTypes, /PluginBackgroundContribution/, 'Must define PluginBackgroundContribution type')
assert.match(pluginTypes, /PluginBackgroundContext/, 'Must define PluginBackgroundContext type')

// Must export storage-related types
assert.match(pluginTypes, /PluginPrivateStorageApi/, 'Must define PluginPrivateStorageApi type')

// Must export clipboard-related types
assert.match(pluginTypes, /PluginClipboardApi/, 'Must define PluginClipboardApi type')
assert.match(pluginTypes, /ClipboardChange/, 'Must define ClipboardChange type')

// Must export paste-related types
assert.match(pluginTypes, /PluginPasteApi/, 'Must define PluginPasteApi type')
assert.match(pluginTypes, /PluginPasteResult/, 'Must define PluginPasteResult type')

// Must export permission-related types
assert.match(pluginTypes, /PluginPermission/, 'Must define PluginPermission type')
assert.match(pluginTypes, /PluginPermissionSnapshot|PluginPermissionGrant/, 'Must define permission state type')

// ─── 5. PluginManifest must support permissions ─────────────────────────────

assert.match(pluginTypes, /permissions\?\s*:\s*(?:string\[\]|PluginPermission\[\])/, 'PluginManifest must include permissions field')

// ─── 6. plugin-sdk.ts must re-export new types ──────────────────────────────

const sdkExports = read('src/plugin-sdk.ts')
assert.match(sdkExports, /PluginSurfaceProps/, 'plugin-sdk.ts must export PluginSurfaceProps')
assert.match(sdkExports, /PluginBackgroundContribution/, 'plugin-sdk.ts must export PluginBackgroundContribution')
assert.match(sdkExports, /PluginBackgroundContext/, 'plugin-sdk.ts must export PluginBackgroundContext')
assert.match(sdkExports, /PluginPrivateStorageApi/, 'plugin-sdk.ts must export PluginPrivateStorageApi')
assert.match(sdkExports, /PluginClipboardApi/, 'plugin-sdk.ts must export PluginClipboardApi')
assert.match(sdkExports, /PluginPasteApi/, 'plugin-sdk.ts must export PluginPasteApi')
assert.match(sdkExports, /PluginSurfaceHostApi/, 'plugin-sdk.ts must export PluginSurfaceHostApi')

console.log('clipboard-history boundary checks passed')
