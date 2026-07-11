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

console.log('search ranking match checks passed')
