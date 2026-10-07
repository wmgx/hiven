#!/usr/bin/env node
/**
 * Tight launcher match rules: short queries must not mid-token match base/session/clause.
 */
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const nodeRequire = createRequire(import.meta.url)

function loadSearchRanking() {
  let src = readFileSync('src/workspace/searchRanking.ts', 'utf8')
  src = src.replace(/import\s+type\s*\{[^}]*\}\s*from\s*'[^']*'\s*;?\s*\n?/, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  // Real pinyin-pro for Chinese cases
  const requireShim = (id) => {
    if (id === 'pinyin-pro') return nodeRequire('pinyin-pro')
    throw new Error('unexpected require: ' + id)
  }
  const sandbox = {
    exports: moduleExports,
    module: { exports: moduleExports },
    console,
    require: requireShim,
  }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const {
  searchableFieldsMatch,
  scoreSearchableFields,
  tokenPrefixMatch,
  computeTitleMatchRanges,
} = loadSearchRanking()

function fields(partial) {
  return {
    id: partial.id ?? 'plugin:example:tool:x',
    title: partial.title ?? '',
    titleI18n: partial.titleI18n,
    description: partial.description,
    descriptionI18n: partial.descriptionI18n,
    aliases: partial.aliases,
    usageKey: partial.usageKey,
  }
}

// --- short query "se" must not false-positive ---
assert.equal(
  searchableFieldsMatch(fields({
    id: 'host:view:settings',
    title: 'Settings',
    titleI18n: { zh: '设置' },
    aliases: ['setting', 'settings', '设置'],
    description: 'Open app settings',
  }), 'se', 'zh'),
  true,
  '设置 should match se via alias settings prefix',
)

assert.equal(
  searchableFieldsMatch(fields({
    title: 'System Settings',
  }), 'se', 'en'),
  true,
  'System Settings should match se via Settings token prefix',
)

assert.equal(
  searchableFieldsMatch(fields({
    id: 'plugin:encode-decode:tool:base64.encode',
    title: 'Base64 Encode',
    titleI18n: { zh: 'Base64 编码' },
    aliases: ['base64 encode', 'base64编码', 'b64 encode'],
    description: 'Encode text to Base64',
  }), 'se', 'zh'),
  false,
  'Base64 must not match se via mid-token base/Base64',
)

assert.equal(
  searchableFieldsMatch(fields({
    id: 'host:system:lock-screen',
    title: 'Lock Screen',
    titleI18n: { zh: '锁屏' },
    aliases: ['lock', 'lock screen', '锁屏'],
    description: 'Lock the current session',
  }), 'se', 'zh'),
  false,
  '锁屏 must not match se via hidden English subtitle session',
)

assert.equal(
  searchableFieldsMatch(fields({
    title: 'SQL IN (String)',
    titleI18n: { zh: '生成 IN (字符串)' },
    description: 'Convert lines to SQL IN clause (string mode)',
  }), 'se', 'zh'),
  false,
  '生成 IN must not match se via description clause',
)

assert.equal(
  searchableFieldsMatch(fields({
    title: 'Number Base Converter',
    titleI18n: { zh: '进制转换' },
    aliases: ['decimal', 'binary', 'hex'],
  }), 'se', 'zh'),
  false,
  '进制转换 must not match se via English Base',
)

assert.equal(
  searchableFieldsMatch(fields({
    id: 'host:app-launcher:app:macos:path:3e9d62fe57f412e8',
    title: 'Microsoft Excel',
  }), '12', 'en'),
  false,
  'must not match internal path-hash system ids',
)

// --- intentional matches still work ---
assert.equal(
  searchableFieldsMatch(fields({
    title: 'Base64 Encode',
    aliases: ['base64 encode'],
  }), 'base', 'en'),
  true,
  'base should still prefix-match Base64',
)

assert.equal(
  searchableFieldsMatch(fields({
    title: 'Base64 Encode',
  }), 'base64', 'en'),
  true,
  'base64 should match title',
)

assert.equal(
  searchableFieldsMatch(fields({
    title: 'Settings',
    titleI18n: { zh: '设置' },
    aliases: ['settings', '设置'],
  }), 'settings', 'zh'),
  true,
  'full alias settings should match in zh UI',
)

assert.equal(
  tokenPrefixMatch('System Settings', 'se'),
  true,
  'tokenPrefixMatch finds Settings',
)
assert.equal(
  tokenPrefixMatch('Base64 Encode', 'se'),
  false,
  'tokenPrefixMatch rejects mid-token se in Base64',
)

const highlight = computeTitleMatchRanges('Base64 Encode', 'se', 'en')
assert.equal(highlight.type, 'none', 'short se must not highlight mid-token in Base64')

const settingsHighlight = computeTitleMatchRanges('System Settings', 'se', 'en')
assert.equal(settingsHighlight.type, 'substring', 'se should highlight Settings token')
assert.equal(settingsHighlight.ranges?.length, 1)
assert.equal(settingsHighlight.ranges[0].start, 7)
assert.equal(settingsHighlight.ranges[0].end, 9)

// Two-character Chinese words can occur within unsegmented titles and aliases.
for (const [title, query] of [
  ['剪贴板历史', '历史'],
  ['随机密码', '密码'],
  ['随机整数', '整数'],
  ['随机颜色', '颜色'],
]) {
  const candidate = fields({ title })
  assert.ok(searchableFieldsMatch(candidate, query, 'zh'), `${query} should find ${title}`)
  assert.equal(scoreSearchableFields(candidate, query, 'zh'), 1000, 'Chinese substring keeps the existing tier')
  assert.ok(searchableFieldsMatch(fields({ title: 'Other', aliases: [title] }), query, 'en'), 'intentional aliases share the rule')
  const { type, ranges } = computeTitleMatchRanges(title, query, 'zh')
  assert.equal(type, 'substring')
  assert.equal(ranges.length, 1)
  assert.equal(title.slice(ranges[0].start, ranges[0].end), query, 'highlight slices the displayed title')
}

for (const [title, query] of [
  ['随机密码', '密'],
  ['随机𠮷色', '𠮷'],
  ['随机密a', '密a'],
  ['abéécd', 'éé'],
  ['abかなcd', 'かな'],
]) {
  assert.equal(searchableFieldsMatch(fields({ title }), query, 'zh'), false, 'no broad relaxation for other short queries')
  assert.equal(scoreSearchableFields(fields({ title }), query, 'zh'), 0)
  assert.equal(computeTitleMatchRanges(title, query, 'zh').type, 'none')
}
assert.ok(searchableFieldsMatch(fields({ title: '密码' }), '密', 'zh'), 'single-character prefixes still work')
assert.equal(scoreSearchableFields(fields({ title: '密码' }), '密码', 'zh'), 6000, 'exact tier is unchanged')
assert.equal(scoreSearchableFields(fields({ title: '密码生成器' }), '密码', 'zh'), 4000, 'prefix tier is unchanged')
assert.equal(searchableFieldsMatch(fields({ title: 'History', titleI18n: { zh: '剪贴板历史' } }), '历史', 'en'), false, 'inactive locale titles remain excluded')

// The Han rule counts characters; highlighting must retain JavaScript string offsets.
for (const [title, query] of [['🧰随机密码', '密码'], ['🧰随机𠮷色', '𠮷色']]) {
  assert.ok(searchableFieldsMatch(fields({ title }), query, 'zh'))
  const { ranges } = computeTitleMatchRanges(title, query, 'zh')
  assert.equal(ranges.length, 1)
  assert.equal(ranges[0].start, 4)
  assert.equal(ranges[0].end, 4 + query.length)
  assert.equal(title.slice(ranges[0].start, ranges[0].end), query)
}

// Filtering and scoring must use the same match classification.
for (const candidate of [
  fields({ title: 'Settings' }),
  fields({ title: 'Other', aliases: ['格式化'] }),
  fields({ title: 'Other', titleI18n: { zh: '设置' } }),
]) {
  for (const query of ['set', 'gsh', 'sz', 'missing']) {
    assert.equal(
      scoreSearchableFields(candidate, query, 'en') > 0,
      searchableFieldsMatch(candidate, query, 'en'),
      `score/filter disagreement for query=${query}`,
    )
  }
}

const encodedRoute = fields({ title: 'Base64 解码' })
assert.ok(searchableFieldsMatch(encodedRoute, 'base64 jiema', 'zh'))
assert.ok(searchableFieldsMatch(encodedRoute, 'base64 jm', 'zh'))
assert.ok(searchableFieldsMatch(fields({ title: 'JSON 格式化' }), 'json gsh', 'zh'))
assert.ok(scoreSearchableFields(encodedRoute, 'base64 jiema', 'zh') > 0)
assert.equal(computeTitleMatchRanges(encodedRoute.title, 'base64 jiema', 'zh').type, 'pinyin')

console.log('search ranking match checks passed')
