#!/usr/bin/env node
/**
 * B3: Diff product stays off public SDK; only text-diff uses @hiven/plugin-diff.
 */
import assert from 'node:assert/strict'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

const sdk = read('src/plugin-sdk.ts')
const host = read('src/pluginHostSdk.ts')
const diffHost = read('src/pluginHostDiff.ts')

assert.match(sdk, /DiffSourcePayload/, 'public SDK may export structural DiffSourcePayload only')
assert.doesNotMatch(
  sdk,
  /export type \{[^}]*\bDiffSource\b[^}]*\} from '\.\/workspace\/workspaceStore'/,
  'public SDK must not re-export DiffSource from workspaceStore',
)
assert.doesNotMatch(sdk, /DiffSourceBinding/, 'public SDK must not export DiffSourceBinding')

assert.doesNotMatch(host, /import\s*\{[^}]*\bDualEditorView\b/, 'PluginHostSdk must not import DualEditorView')
assert.doesNotMatch(host, /buildJsonDiffViewModel|computeTextLineDiff/, 'PluginHostSdk must not expose kits.diff symbols')
assert.doesNotMatch(host, /useWorkspaceActions\s*:|useBoundSourceText\s*:|useActiveFullscreenView\s*:/, 'PluginHostSdk must not expose Diff workspace hooks')

assert.match(diffHost, /getPluginDiffHost/, 'plugin-diff host must export getPluginDiffHost')
assert.match(diffHost, /DualEditorView/, 'plugin-diff host provides DualEditorView')
assert.match(diffHost, /setBoundSourceText|useBoundSourceText/, 'plugin-diff host provides bound text write-back')

// Only textDiff may import plugin-diff
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.(ts|tsx)$/.test(name)) out.push(full)
  }
  return out
}

const pluginsRoot = join(root, 'src/plugins')
for (const file of walk(pluginsRoot)) {
  const rel = file.slice(root.length + 1)
  if (rel.startsWith('src/plugins/textDiff/')) continue
  const text = readFileSync(file, 'utf8')
  assert.doesNotMatch(
    text,
    /@hiven\/plugin-diff/,
    `only text-diff may import @hiven/plugin-diff: ${rel}`,
  )
}

const textDiffSurface = read('src/plugins/textDiff/TextDiffSurface.tsx')
assert.match(textDiffSurface, /@hiven\/plugin-diff/, 'text-diff surface must use plugin-diff')
assert.doesNotMatch(textDiffSurface, /kits\.diff|DualEditorView.*getPluginHostSdk/, 'text-diff must not take Diff from public SDK kits')

const packageJson = JSON.parse(read('package.json'))
assert.equal(
  packageJson.scripts?.['test:plugin-diff-boundary'],
  'node scripts/test-plugin-diff-boundary.mjs',
)

console.log('test-plugin-diff-boundary: ok')
