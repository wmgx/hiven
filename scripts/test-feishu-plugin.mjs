#!/usr/bin/env node
/**
 * feishu first-party plugin contract:
 * manifest / provider / settings / locales / catalog / host SDK boundary.
 */

import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (p) => readFileSync(join(root, p), 'utf8')

const pluginDir = 'src/plugins/feishu'

// --- required package files ---
const requiredPaths = [
  `${pluginDir}/manifest.json`,
  `${pluginDir}/index.tsx`,
  `${pluginDir}/provider/docsTargetProvider.ts`,
]

for (const path of requiredPaths) {
  assert.ok(existsSync(join(root, path)), `${path} must exist`)
}

// settings/* must exist (at least one file under settings/)
const settingsDir = join(root, pluginDir, 'settings')
assert.ok(existsSync(settingsDir) && statSync(settingsDir).isDirectory(), `${pluginDir}/settings/* must exist`)
const settingsFiles = readdirSync(settingsDir).filter((n) => /\.(ts|tsx|js|jsx)$/.test(n))
assert.ok(settingsFiles.length > 0, `${pluginDir}/settings must contain at least one source file`)

// locales en/zh
assert.ok(existsSync(join(root, pluginDir, 'locales/en.json')), `${pluginDir}/locales/en.json must exist`)
assert.ok(existsSync(join(root, pluginDir, 'locales/zh.json')), `${pluginDir}/locales/zh.json must exist`)

const manifestRaw = read(`${pluginDir}/manifest.json`)
const manifest = JSON.parse(manifestRaw)
const pluginIndex = read(`${pluginDir}/index.tsx`)
const provider = read(`${pluginDir}/provider/docsTargetProvider.ts`)
const catalog = read('src/workspace/pluginProductCatalog.ts')
const localeEn = read(`${pluginDir}/locales/en.json`)
const localeZh = read(`${pluginDir}/locales/zh.json`)

// --- manifest ---
assert.equal(manifest.pluginId, 'feishu', 'manifest pluginId must be feishu')
assert.ok(Array.isArray(manifest.permissions), 'manifest must declare permissions array')
assert.ok(
  manifest.permissions.includes('shell.run'),
  'manifest permissions must include shell.run for lark-cli spawn',
)

// --- index: hooks.startup + settings ---
assert.match(pluginIndex, /hooks\s*:\s*\{[\s\S]*startup/, 'index must register hooks.startup')
assert.match(pluginIndex, /settings\s*:/, 'index must contribute settings')
assert.ok(
  /schema\s*:\s*\{|component\s*:/.test(pluginIndex),
  'index settings must expose schema and/or component',
)

// B2 calendar tools live in tools.ts (assembled by index)
const toolsSrc = existsSync(join(root, `${pluginDir}/tools.ts`))
  ? read(`${pluginDir}/tools.ts`)
  : pluginIndex
assert.match(toolsSrc, /feishu\.calendar-agenda|calendar-agenda/, 'must expose calendar agenda tool')
assert.match(toolsSrc, /feishu\.calendar-search|calendar-search|\+search-event|searchEvents/, 'must expose calendar search tool')
assert.match(toolsSrc, /agenda|今日议程|日程/, 'agenda tool should be searchable via 日程/agenda aliases')
assert.match(toolsSrc, /feishu\.chat-search|chat-search|searchChats/, 'must expose chat search tool')
assert.match(toolsSrc, /feishu\.contact-search|contact-search|searchUsers/, 'must expose contact search tool')
assert.match(toolsSrc, /找人|搜群|contact|chat/, 'B3 tools should be searchable via 找人/搜群 aliases')

// --- provider: feishu.docs DesktopTargetProvider ---
assert.match(provider, /feishu\.docs/, 'provider must use source id feishu.docs')
assert.ok(
  /if\s*\(!q\)\s*return\s*\[\]|if\s*\(\s*!.*query|query\.trim\(\)\s*\)\s*return\s*\[\]|if\s*\(\s*!ctx\.query|!q\s*\)\s*return\s*\[\]/.test(
    provider,
  ) || /if\s*\(!q\)\s*return\s*\[\]/.test(provider),
  'provider list must return [] for empty query',
)
// Explicit empty-query guard (same product rule as browser-tabs)
assert.match(provider, /if\s*\(!q\)\s*return\s*\[\]/, 'provider must short-circuit empty query with []')
assert.match(provider, /listTimeoutMs/, 'provider must declare listTimeoutMs')
assert.match(provider, /kind\s*:\s*['"]document['"]|['"]document['"]/, 'provider targets must use kind document')

// Prefer host SDK desktopTargets / @hiven/plugin (no workspace deep import)
assert.match(provider, /from\s+['"]@hiven\/plugin['"]/, 'provider must import from @hiven/plugin')
assert.doesNotMatch(provider, /from\s+['"]\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(provider, /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(pluginIndex, /from\s+['"]\.\.\/\.\.\/workspace\//)
assert.doesNotMatch(pluginIndex, /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//)

// settings sources also must not deep-import workspace
for (const name of settingsFiles) {
  const src = read(`${pluginDir}/settings/${name}`)
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\/workspace\//, `settings/${name} must not deep-import workspace`)
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//, `settings/${name} must not deep-import workspace`)
}

// Walk remaining plugin sources for workspace deep imports
function walkTsFiles(dir, out = []) {
  for (const name of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, name.name)
    if (name.isDirectory()) walkTsFiles(full, out)
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name.name)) out.push(full)
  }
  return out
}

for (const file of walkTsFiles(join(root, pluginDir))) {
  const src = readFileSync(file, 'utf8')
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\/workspace\//, `${file} must not deep-import ../../workspace/`)
  assert.doesNotMatch(src, /from\s+['"]\.\.\/\.\.\/\.\.\/workspace\//, `${file} must not deep-import ../../../workspace/`)
}

// --- product catalog ---
assert.match(catalog, /feishu/, 'pluginProductCatalog must include feishu')

// --- locales non-empty JSON ---
assert.ok(Object.keys(JSON.parse(localeEn)).length > 0, 'locales/en.json must have keys')
assert.ok(Object.keys(JSON.parse(localeZh)).length > 0, 'locales/zh.json must have keys')

// package.json scripts wiring
const packageJson = JSON.parse(read('package.json'))
assert.equal(
  packageJson.scripts?.['test:feishu-plugin'],
  'node scripts/test-feishu-plugin.mjs',
  'package.json must expose test:feishu-plugin',
)
assert.equal(
  packageJson.scripts?.['test:feishu-cli-logic'],
  'node scripts/test-feishu-cli-logic.mjs',
  'package.json must expose test:feishu-cli-logic',
)

console.log('feishu plugin contract checks passed')
