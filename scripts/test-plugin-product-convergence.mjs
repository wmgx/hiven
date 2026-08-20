#!/usr/bin/env node
/**
 * Plugin product convergence contract — Step 5 §18.
 *
 * Verifies first-party plugin ids are grouped into user-facing product
 * capabilities rather than shown as a flat plugin list.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const productSrc = readFileSync('src/workspace/pluginProductCatalog.ts', 'utf8')

const requiredProducts = [
  'Calculator',
  'Date Time Assistant',
  'JSON Tools',
  'Text Diff',
  'Regex Tester',
  'Clipboard History',
  'Translate',
  'CSV Tools',
  'Encode / Decode Tools',
  'YAML Tools',
  'Query String Tools',
  'SQL Tools',
  'CSS Formatter',
  'XML Formatter',
  'Text Tools',
  'JWT Tools',
  'Hash Tools',
  'Count',
  'Browser',
]
for (const product of requiredProducts) {
  assert.ok(productSrc.includes(product), `missing product capability: ${product}`)
}

const requiredMerges = [
  ['json', 'js-filter', 'sort-json', 'JSON Tools'],
  ['base64', 'url', 'html', 'slashes', 'Encode / Decode Tools'],
  ['sql', 'sqlin', 'SQL Tools'],
  ['case', 'line-tools', 'line-affix', 'mdquote', 'Text Tools'],
]
for (const group of requiredMerges) {
  for (const token of group) assert.ok(productSrc.includes(token), `missing merge token: ${token}`)
}

const deletedCapabilities = ['scripts', 'custom-actions', 'plugin-editor', 'pinned']
for (const removed of deletedCapabilities) {
  assert.match(productSrc, new RegExp(`${removed}[\\s\\S]*removed|removed[\\s\\S]*${removed}`, 'i'), `removed capability should be explicit: ${removed}`)
}

const bundledLoader = readFileSync('src/workspace/bundledPluginLoader.ts', 'utf8')
const launcherRegistry = readFileSync('src/workspace/launcher/registry.ts', 'utf8')
assert.match(bundledLoader, /applyPluginProductMetadata/, 'bundled plugin loader should apply product metadata')
assert.match(launcherRegistry, /resolvePluginProductMetadata/, 'launcher registry should use product metadata for display')
assert.match(launcherRegistry, /productProvider/, 'launcher item should carry product provider')

console.log('plugin product convergence checks passed')
