#!/usr/bin/env node
/**
 * Clipboard Object Block — Phase R0 + R1 behavior tests
 *
 * Covers:
 *  - ClipboardSnapshot freshness rules (12s hard-attach window)
 *  - Strong-content attach policy (not plain text)
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
// attachPolicy needs isSoft + detectClipboardFilePath + detectContent stub
function detectContentStub(text) {
  const t = String(text).trim()
  if (t.startsWith('{') || t.startsWith('[')) return [{ kind: 'json', confidence: 0.95, normalized: t }]
  if (/^https?:\/\//i.test(t)) return [{ kind: 'url', confidence: 0.95, normalized: t }]
  if (/^\d{10}$|^\d{13}$/.test(t)) return [{ kind: 'timestamp', confidence: 0.95, normalized: t }]
  if (/^[A-Za-z0-9+/]+=*$/.test(t) && t.length >= 16) return [{ kind: 'base64', confidence: 0.92, normalized: t }]
  return [{ kind: 'text', confidence: 0.5, normalized: t }]
}
const attachPolicy = transpileAndRun('src/launcher/clipboard/attachPolicy.ts', {
  detectContent: detectContentStub,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
})
const objectBlock = transpileAndRun('src/launcher/clipboard/objectBlock.ts', {
  shouldAutoAttachClipboard: snapshot.shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint: snapshot.shouldShowRecentClipboardHint,
  isStrongClipboardAttachEligible: attachPolicy.isStrongClipboardAttachEligible,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  fileNameFromPath: snapshot.fileNameFromPath,
  detectClipboardType: snapshot.detectClipboardType,
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

// Fresh TTL is 12s
assert.equal(snapshot.FRESH_CLIPBOARD_TTL_MS, 12_000, 'fresh TTL should be 12s')

// <= 12s → age-eligible
const freshSnapshot = { ...s1, changedAt: Date.now() - 5_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(freshSnapshot), true, '<= 12s should be age-eligible')
const atBoundary = { ...s1, changedAt: Date.now() - 12_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(atBoundary), true, 'exactly 12s should still be age-eligible')

// > 12s → not age-eligible
const justStale = { ...s1, changedAt: Date.now() - 15_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(justStale), false, '>12s should not be age-eligible')

// 12s-2 min → weak hint window (age only)
assert.equal(snapshot.RECENT_CLIPBOARD_HINT_TTL_MS, 2 * 60_000, 'hint TTL should be 2 min')
const recentSnapshot = { ...s1, changedAt: Date.now() - 60_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(recentSnapshot), false, '60s should not auto attach')
assert.equal(snapshot.shouldShowRecentClipboardHint(recentSnapshot), true, '60s should show age-hint window')

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
assert.equal(snapshot.shouldAutoAttachClipboard(observedChange), true, 'fresh change should be age-eligible')

// ─── Strong attach policy ─────────────────────────────────────────────────────

assert.equal(attachPolicy.isStrongClipboardAttachEligible('{"a":1}'), true, 'json is strong')
assert.equal(attachPolicy.isStrongClipboardAttachEligible('https://example.com'), true, 'url is strong')
assert.equal(attachPolicy.isStrongClipboardAttachEligible('1710000000'), true, 'timestamp is strong')
assert.equal(attachPolicy.isStrongClipboardAttachEligible('hello world plain text'), false, 'plain text is not strong')
assert.equal(attachPolicy.isStrongClipboardAttachEligible('42'), false, 'short number not strong')
assert.equal(attachPolicy.isStrongClipboardAttachEligible('/Users/me/export.csv'), true, 'file path strong via ext')

// Soft operands
assert.equal(snapshot.isSoftClipboardOperand('42'), true, 'integer is soft operand')
assert.equal(snapshot.isSoftClipboardOperand('1710000000'), false, 'unix ts is not soft')
assert.equal(snapshot.isSoftClipboardOperand('{"a":1}'), false, 'json is not soft')

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
assert.match(readClip, /readNativeClipboardText/, 'launcher clipboard text must go through the Tauri-safe reader')
assert.doesNotMatch(readClip, /await navigator\.clipboard\.readText/, 'launcher clipboard must not fall back to the web Paste chip API')

// ─── §11.2 Object Block ───────────────────────────────────────────────────────

// Soft operands (short numbers) must not hard-attach even when fresh
const numberSnap = {
  text: '42',
  hash: snapshot.hashClipboardText('42'),
  detectedType: 'text',
  firstSeenAt: Date.now(),
  lastSeenAt: Date.now(),
  changedAt: Date.now() - 5_000,
  ageConfidence: 'known',
}
assert.equal(snapshot.shouldAutoAttachClipboard(numberSnap), true, 'fresh number still age-eligible')
assert.equal(
  objectBlock.createClipboardObjectBlock(numberSnap),
  null,
  'fresh short number must not hard-attach as object block',
)
const forcedNumber = objectBlock.createClipboardObjectBlock(numberSnap, Date.now(), { forceAttach: true })
assert.ok(forcedNumber, 'forceAttach still allows number block')

// Plain text must not hard-attach even when fresh
const plainSnap = {
  text: 'hello world plain text',
  hash: snapshot.hashClipboardText('hello world plain text'),
  detectedType: 'text',
  firstSeenAt: Date.now(),
  lastSeenAt: Date.now(),
  changedAt: Date.now() - 3_000,
  ageConfidence: 'known',
}
assert.equal(objectBlock.createClipboardObjectBlock(plainSnap), null, 'plain text must not hard-attach')

// suppressAutoAttach (sticky / typing)
assert.equal(
  objectBlock.createClipboardObjectBlock(
    { text: '{"a":1}', hash: 'x', detectedType: 'json', firstSeenAt: Date.now(), lastSeenAt: Date.now(), changedAt: Date.now(), ageConfidence: 'known' },
    Date.now(),
    { suppressAutoAttach: true },
  ),
  null,
  'suppressAutoAttach blocks even strong content',
)

// Auto-create from fresh strong clipboard (json)
const freshSnap = {
  text: '{"key": "value"}',
  hash: snapshot.hashClipboardText('{"key": "value"}'),
  detectedType: 'json',
  firstSeenAt: Date.now(),
  lastSeenAt: Date.now(),
  changedAt: Date.now() - 5_000,
  ageConfidence: 'known',
}
const block = objectBlock.createClipboardObjectBlock(freshSnap)
assert.ok(block, 'fresh strong clipboard should create block')
assert.equal(block.source, 'clipboard')
assert.equal(block.kind, 'json')
assert.equal(block.removable, true)
assert.equal(block.selectedForDelete, false)

// Stale clipboard should not create block
const staleSnap = { ...freshSnap, changedAt: Date.now() - 3 * 60_000, ageConfidence: 'known', detectedType: 'json' }
const noBlock = objectBlock.createClipboardObjectBlock(staleSnap)
assert.equal(noBlock, null, 'stale clipboard should not create block')

// Unknown age should not create block
const unknownSnap = { ...freshSnap, changedAt: undefined, ageConfidence: 'unknown', detectedType: 'json' }
const noBlock2 = objectBlock.createClipboardObjectBlock(unknownSnap)
assert.equal(noBlock2, null, 'unknown age should not create block')

// Secret block should mask preview
const secretSnap = {
  text: 'sk-abc123',
  hash: snapshot.hashClipboardText('sk-abc123'),
  detectedType: 'secret',
  firstSeenAt: Date.now(),
  lastSeenAt: Date.now(),
  changedAt: Date.now() - 5_000,
  ageConfidence: 'known',
}
// secret-like may or may not be strong depending on detectContent stub; forceAttach for mask test
const secretBlock = objectBlock.createClipboardObjectBlock(secretSnap, Date.now(), { forceAttach: true })
assert.ok(secretBlock, 'secret force-attach should create block')
assert.equal(secretBlock.secretMasked, true)
assert.equal(secretBlock.preview, undefined, 'secret preview should be hidden')
assert.equal(
  objectBlock.getObjectBlockRecommendationText(secretBlock),
  undefined,
  'secret payload must not enter the generic recommendation pipeline',
)
assert.equal(
  objectBlock.getObjectBlockRecommendationText(block),
  block.payloadText,
  'non-secret payload remains available to content recommendations',
)

// Recent clipboard hint only for strong content
const recentJson = {
  text: '{"a":1}',
  hash: 'h',
  detectedType: 'json',
  firstSeenAt: Date.now(),
  lastSeenAt: Date.now(),
  changedAt: Date.now() - 90_000,
  ageConfidence: 'known',
}
const hint = objectBlock.buildRecentClipboardHint(recentJson)
assert.ok(hint, 'recent strong clipboard should show hint')

const recentPlain = {
  text: 'hello world plain text',
  hash: 'h2',
  detectedType: 'text',
  firstSeenAt: Date.now(),
  lastSeenAt: Date.now(),
  changedAt: Date.now() - 90_000,
  ageConfidence: 'known',
}
assert.equal(objectBlock.buildRecentClipboardHint(recentPlain), null, 'recent plain text should not hint')

// Expired clipboard hint (>2 min)
const expiredSnap = { ...recentJson, changedAt: Date.now() - 3 * 60_000 }
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
const jsonActions = recommendation.recommendActionsForBlock(block)
assert.ok(jsonActions.length > 0, 'json block should have recommendations')

console.log('clipboard object block behavior checks passed')
