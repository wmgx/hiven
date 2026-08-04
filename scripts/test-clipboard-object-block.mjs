#!/usr/bin/env node
/**
 * Clipboard Object Block — Phase R0 + R1 behavior tests
 *
 * Covers:
 *  - ClipboardSnapshot freshness rules
 *  - ObjectBlock creation and deletion semantics
 *  - Action recommendation by detected type
 *  - Regression: no auto Cmd+C, no external selection, no stale attach
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function transpileAndRun(path, globals = {}) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2023,
      esModuleInterop: true,
    },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, Date, JSON, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

// ─── Load modules ──────────────────────────────────────────────────────────────
const snapshot = transpileAndRun('src/launcher/clipboard/clipboardSnapshot.ts')
const objectBlock = transpileAndRun('src/launcher/clipboard/objectBlock.ts', {
  shouldAutoAttachClipboard: snapshot.shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint: snapshot.shouldShowRecentClipboardHint,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  fileNameFromPath: snapshot.fileNameFromPath,
})
const recommendation = transpileAndRun('src/launcher/clipboard/actionRecommendation.ts')

// ─── §11.1 Clipboard freshness ────────────────────────────────────────────────

// New hash → changedAt = now
const s1 = snapshot.updateClipboardSnapshot('hello world')
assert.equal(s1.ageConfidence, 'known', 'new hash should have known age')
assert.ok(s1.changedAt !== undefined, 'new hash should set changedAt')
assert.equal(s1.hash, snapshot.hashClipboardText('hello world'))

// Same hash → changedAt preserved
const originalChangedAt = s1.changedAt
const s2 = snapshot.updateClipboardSnapshot('hello world')
assert.equal(s2.changedAt, originalChangedAt, 'same hash should preserve changedAt')
assert.ok(s2.lastSeenAt >= s1.lastSeenAt, 'same hash should update lastSeenAt')

// Unknown changedAt → not auto attach
const s3 = snapshot.createClipboardSnapshotFromUnknownAge('unknown content')
assert.equal(s3.ageConfidence, 'unknown')
assert.equal(snapshot.shouldAutoAttachClipboard(s3), false, 'unknown age should not auto attach')

// Fresh TTL is 30s
assert.equal(snapshot.FRESH_CLIPBOARD_TTL_MS, 30_000, 'fresh TTL should be 30s')

// <= 30s → auto attach
const freshSnapshot = { ...s1, changedAt: Date.now() - 10_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(freshSnapshot), true, '<= 30s should auto attach')
const atBoundary = { ...s1, changedAt: Date.now() - 30_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(atBoundary), true, 'exactly 30s should still auto attach')

// > 30s → not auto attach
const justStale = { ...s1, changedAt: Date.now() - 45_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(justStale), false, '>30s should not auto attach')

// 30s-2 min → weak hint
assert.equal(snapshot.RECENT_CLIPBOARD_HINT_TTL_MS, 2 * 60_000, 'hint TTL should be 2 min')
const recentSnapshot = { ...s1, changedAt: Date.now() - 60_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(recentSnapshot), false, '60s should not auto attach')
assert.equal(snapshot.shouldShowRecentClipboardHint(recentSnapshot), true, '60s should show hint')

// > 2 min → no hint
const oldSnapshot = { ...s1, changedAt: Date.now() - 3 * 60_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(oldSnapshot), false)
assert.equal(snapshot.shouldShowRecentClipboardHint(oldSnapshot), false, '>2 min should not hint')
assert.equal(snapshot.isClipboardExpired(oldSnapshot), true)

// observeClipboardText: first see = unknown baseline; change = known
snapshot.clearClipboardSnapshot()
const observed1 = snapshot.observeClipboardText('baseline content')
assert.equal(observed1.ageConfidence, 'unknown', 'first observe must be unknown age')
assert.equal(observed1.changedAt, undefined, 'first observe must not set changedAt')
assert.equal(snapshot.shouldAutoAttachClipboard(observed1), false, 'baseline must not auto-attach')
const observedSame = snapshot.observeClipboardText('baseline content')
assert.equal(observedSame.ageConfidence, 'unknown', 'same content keeps unknown')
assert.equal(observedSame.changedAt, undefined)
const observedChange = snapshot.observeClipboardText('new content after copy')
assert.equal(observedChange.ageConfidence, 'known', 'content change must be known age')
assert.ok(observedChange.changedAt !== undefined, 'content change must set changedAt')
assert.equal(snapshot.shouldAutoAttachClipboard(observedChange), true, 'fresh change should auto-attach')

// ─── Detection ─────────────────────────────────────────────────────────────────

assert.equal(snapshot.detectClipboardType('{"key": "value"}'), 'json')
assert.equal(snapshot.detectClipboardType('[1, 2, 3]'), 'json')
assert.equal(snapshot.detectClipboardType('https://example.com'), 'url')
assert.equal(snapshot.detectClipboardType('ssh user@host'), 'command')
assert.equal(snapshot.detectClipboardType('curl https://api.example.com'), 'command')
assert.equal(snapshot.detectClipboardType('sk-abc123 is a secret'), 'secret-like')
assert.equal(snapshot.detectClipboardType('Bearer token123'), 'secret-like')
assert.equal(snapshot.detectClipboardType('hello world plain text'), 'text')
assert.equal(snapshot.detectClipboardType('   '), 'unknown')

// File-path extension recommendations (clipboard holds a path, not contents)
assert.equal(snapshot.detectClipboardType('/Users/me/export.csv'), 'csv')
assert.equal(snapshot.detectClipboardType('/tmp/data.tsv'), 'csv')
assert.equal(snapshot.detectClipboardType('file:///Users/me/report.json'), 'json')
assert.equal(snapshot.detectClipboardType('C:\\Users\\me\\query.sql'), 'sql')
assert.equal(snapshot.detectClipboardType('~/notes/readme.md'), 'markdown')
// Bare filename (Finder often pastes only the name in the text flavor)
assert.equal(snapshot.detectClipboardType('export.csv'), 'csv', 'bare .csv filename should be detected as csv')
assert.equal(snapshot.detectClipboardType('status_3_pay_time_delay_over_30d.csv'), 'csv')
assert.ok(snapshot.detectClipboardFilePath('export.csv'), 'bare filename should still yield a file-path hit for kind mapping')
assert.ok(snapshot.detectClipboardFilePath('/Users/me/export.csv'))
assert.equal(snapshot.detectClipboardFilePath('/Users/me/export.csv')?.ext, 'csv')
assert.equal(snapshot.fileNameFromPath('/Users/me/export.csv'), 'export.csv')

// readLauncherClipboard prefers native file paths over plain text
const readClip = readFileSync('src/launcher/clipboard/readLauncherClipboard.ts', 'utf8')
assert.match(readClip, /read_clipboard_file_paths/, 'launcher clipboard read should prefer native file paths')

// ─── §11.2 Object Block ───────────────────────────────────────────────────────

// Auto-create from fresh clipboard
const freshSnap = { ...s1, changedAt: Date.now() - 10_000, ageConfidence: 'known', detectedType: 'json' }
const block = objectBlock.createClipboardObjectBlock(freshSnap)
assert.ok(block, 'fresh clipboard should create block')
assert.equal(block.source, 'clipboard')
assert.equal(block.kind, 'json')
assert.equal(block.removable, true)
assert.equal(block.selectedForDelete, false)

// Stale clipboard should not create block
const staleSnap = { ...s1, changedAt: Date.now() - 3 * 60_000, ageConfidence: 'known', detectedType: 'text' }
const noBlock = objectBlock.createClipboardObjectBlock(staleSnap)
assert.equal(noBlock, null, 'stale clipboard should not create block')

// Unknown age should not create block
const unknownSnap = { ...s1, changedAt: undefined, ageConfidence: 'unknown', detectedType: 'text' }
const noBlock2 = objectBlock.createClipboardObjectBlock(unknownSnap)
assert.equal(noBlock2, null, 'unknown age should not create block')

// Secret block should mask preview
const secretSnap = { ...s1, changedAt: Date.now() - 5_000, ageConfidence: 'known', detectedType: 'secret', text: 'sk-abc123' }
const secretBlock = objectBlock.createClipboardObjectBlock(secretSnap)
assert.ok(secretBlock, 'secret fresh clipboard should create block')
assert.equal(secretBlock.secretMasked, true)
assert.equal(secretBlock.preview, undefined, 'secret preview should be hidden')

// Recent clipboard hint (30s–2 min)
const recentSnap = { ...s1, changedAt: Date.now() - 90_000, ageConfidence: 'known', detectedType: 'url' }
const hint = objectBlock.buildRecentClipboardHint(recentSnap)
assert.ok(hint, 'recent clipboard should show hint')
assert.ok(hint.ageLabel.includes('分钟前') || hint.ageLabel.includes('秒前'))

// Expired clipboard hint (>2 min)
const expiredSnap = { ...s1, changedAt: Date.now() - 3 * 60_000, ageConfidence: 'known', detectedType: 'text' }
const noHint = objectBlock.buildRecentClipboardHint(expiredSnap)
assert.equal(noHint, null, 'expired clipboard should not show hint')

// Age labels
assert.ok(objectBlock.formatAgeLabel(500).includes('刚刚'))
assert.ok(objectBlock.formatAgeLabel(15_000).includes('秒前'))
assert.ok(objectBlock.formatAgeLabel(3 * 60_000).includes('分钟前'))

// Editor selection block
const editorBlock = objectBlock.createEditorSelectionObjectBlock({ text: '{"a":1}', kind: 'json', lineCount: 12 })
assert.equal(editorBlock.source, 'editor-selection')
assert.ok(editorBlock.subtitle.includes('12 行'))

// ─── §11.3 Recommendation ─────────────────────────────────────────────────────

// JSON clipboard recommends JSON actions
const jsonBlock = { ...block, kind: 'json', source: 'clipboard' }
const jsonActions = recommendation.recommendActionsForBlock(jsonBlock)
assert.ok(jsonActions.length > 0, 'JSON clipboard should have recommendations')
assert.ok(jsonActions.some(a => a.id === 'format-clipboard-json'), 'should recommend format JSON')
assert.ok(jsonActions.some(a => a.id === 'open-clipboard-editor'), 'should recommend open editor')

// URL clipboard recommends URL actions
const urlBlock = { ...block, kind: 'url', source: 'clipboard' }
const urlActions = recommendation.recommendActionsForBlock(urlBlock)
assert.ok(urlActions.length > 0, 'URL clipboard should have recommendations')

// Secret clipboard masks preview and suppresses network actions
const secretBlockR = { ...block, kind: 'secret', source: 'clipboard' }
const secretActions = recommendation.recommendActionsForBlock(secretBlockR)
assert.ok(!secretActions.some(a => a.id === 'translate-clipboard'), 'secret should suppress translate')
assert.ok(!secretActions.some(a => a.id === 'summarize-clipboard'), 'secret should suppress summarize')

// Editor selection recommends editor-local actions only
const editorJsonBlock = { ...block, kind: 'json', source: 'editor-selection' }
const editorActions = recommendation.recommendActionsForBlock(editorJsonBlock)
assert.ok(editorActions.some(a => a.id === 'format-selection'), 'editor json should recommend format')
assert.ok(!editorActions.some(a => a.id === 'translate-clipboard'), 'editor should not recommend clipboard translate')

// search-only mode actions
const searchActions = recommendation.getSearchOnlyActions()
assert.ok(searchActions.some(a => a.id === 'open-editor'))
assert.ok(searchActions.some(a => a.id === 'open-clipboard-history'))

// ─── §11.4 Regression ─────────────────────────────────────────────────────────

// Global Launcher should NOT auto-simulate Cmd+C
const globalLauncherHost = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
assert.doesNotMatch(globalLauncherHost, /simulateCopy|simulate_copy|Cmd\+C|⌘C/, 'GlobalLauncher must not auto-simulate Cmd+C')

// Global Launcher should NOT read external selection
assert.doesNotMatch(globalLauncherHost, /readExternalSelection|getExternalSelection/, 'GlobalLauncher must not read external selection directly')

// CSV path should recommend open CSV tools surface
const csvPathBlock = {
  ...block,
  kind: 'csv',
  source: 'clipboard',
  payloadText: '/Users/me/export.csv',
  subtitle: 'CSV · export.csv',
}
const csvActions = recommendation.recommendActionsForBlock(csvPathBlock)
assert.ok(csvActions.some((a) => a.id === 'open-csv-tools-surface'), 'csv path clipboard should recommend CSV Tools')

console.log('clipboard object block behavior checks passed')
