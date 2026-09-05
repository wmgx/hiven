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
assert.match(productSrc, /subtitleI18n:[\s\S]{0,160}en:\s*`From \$\{productProvider\}`[\s\S]{0,160}zh:\s*`来自 \$\{metadata\.providerZh \?\? productProvider\}`/, 'default plugin source subtitles should localize both language and provider name')
assert.doesNotMatch(productSrc, /subtitle:\s*item\.display\.subtitle\s*\?\?\s*`来自/, 'default launcher subtitles must not hardcode Chinese into the English fallback')
for (const providerZh of ['计算器', '日期时间助手', 'JSON 工具', '文本对比', '正则测试器', '剪贴板历史', '翻译', 'CSV 工具', '编解码工具', 'YAML 工具', '文本工具', '浏览器', '二维码', '大爆炸']) {
  assert.ok(productSrc.includes(providerZh), `missing Chinese product provider: ${providerZh}`)
}

console.log('plugin product convergence checks passed')
