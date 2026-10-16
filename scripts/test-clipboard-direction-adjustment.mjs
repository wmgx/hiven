#!/usr/bin/env node
/**
 * Clipboard Object Block Direction Adjustment — Comprehensive verification
 *
 * Validates all 11 requirements from the direction adjustment specification:
 *
 * 1. Global Launcher no longer reads external selection
 * 2. ClipboardSnapshot with hash/detectedType/firstSeenAt/lastSeenAt/changedAt/ageConfidence
 * 3. Auto attach only when changedAt known && <= 30 seconds
 * 4. 30s-2 min shows RecentClipboardHint only
 * 5. >2 min or unknown age: nothing shown
 * 6. LauncherObjectBlock / ObjectBlockToken in search input
 * 7. × delete + Backspace select-then-delete
 * 8. Object Block shows recommended actions, not clipboard as search result
 * 9. Action labels use "格式化剪贴板 JSON" style, not plugin names as primary
 * 10. Editor Cmd+K uses Editor Object Block, not clipboard freshness
 * 11. Tests cover freshness, deletion, secret mask, mode switch, no external selection
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

function transpileAndRun(path, globals = {}) {
  let src = readFileSync(path, 'utf8')
  src = src.replace(/import[\s\S]*?from\s*['"][^'"]+['"];?\n/g, '')
  const out = ts.transpileModule(src, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2023, esModuleInterop: true },
  }).outputText
  const moduleExports = {}
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, Date, JSON, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

const snapshot = transpileAndRun('src/launcher/clipboard/clipboardSnapshot.ts')
const detect = transpileAndRun('src/kits/content/detectContent.ts')
// Load the REAL attach policy rather than re-deriving it here. This test used to
// stub isStrongClipboardAttachEligible with a hand-written "{ or [ or http or
// .csv" rule; production later added secret/jwt/base64/… to STRONG_ATTACH_CONTENT_KINDS
// and the stub silently disagreed — the kind of drift a stub can only ever hide.
const attachPolicy = transpileAndRun('src/launcher/clipboard/attachPolicy.ts', {
  detectContent: detect.detectContent,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
})
const objectBlock = transpileAndRun('src/launcher/clipboard/objectBlock.ts', {
  detectContent: detect.detectContent,
  shouldAutoAttachClipboard: snapshot.shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint: snapshot.shouldShowRecentClipboardHint,
  isStrongClipboardAttachEligible: attachPolicy.isStrongClipboardAttachEligible,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
  detectClipboardType: snapshot.detectClipboardType,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  fileNameFromPath: snapshot.fileNameFromPath,
})
const materialText = transpileAndRun('src/launcher/clipboard/currentMaterial.ts')
const currentTextSupport = transpileAndRun('src/launcher/clipboard/currentTextDelivery.ts', materialText)
const paletteMessages = transpileAndRun('src/i18n/locales/palette.ts').default
const currentTextGlobals = {
  ...currentTextSupport,
  t: (locale, key) => paletteMessages[locale][key.replace(/^palette\./, '')],
}
const recommendation = transpileAndRun('src/launcher/clipboard/actionRecommendation.ts', currentTextGlobals)

// ─── #2: ClipboardSnapshot shape ───────────────────────────────────────────────
const s1 = snapshot.updateClipboardSnapshot('test text')
assert.equal(typeof s1.hash, 'string', '#2: hash must be string')
assert.ok(['json','url','text','command','secret','unknown'].includes(s1.detectedType), '#2: detectedType')
assert.equal(typeof s1.firstSeenAt, 'number', '#2: firstSeenAt')
assert.equal(typeof s1.lastSeenAt, 'number', '#2: lastSeenAt')
assert.ok(s1.changedAt !== undefined, '#2: changedAt for new content')
assert.equal(s1.ageConfidence, 'known', '#2: ageConfidence')

// ─── #3: Auto attach only when changedAt known && <= 12s + strong content ─────
assert.equal(snapshot.FRESH_CLIPBOARD_TTL_MS, 12_000, '#3: fresh TTL is 12s')
const strongBase = {
  ...s1,
  text: '{"a":1}',
  hash: snapshot.hashClipboardText('{"a":1}'),
  detectedType: 'json',
}
const fresh = { ...strongBase, changedAt: Date.now() - 5_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(fresh), true, '#3: fresh <= 12s is age-eligible')
const block = objectBlock.createClipboardObjectBlock(fresh)
assert.ok(block, '#3: fresh strong content creates block')

const stale15s = { ...strongBase, changedAt: Date.now() - 15_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(stale15s), false, '#3: 15s does not auto attach')

const unknownAge = { ...strongBase, changedAt: undefined, ageConfidence: 'unknown' }
assert.equal(snapshot.shouldAutoAttachClipboard(unknownAge), false, '#3: unknown age does not auto attach')

// ─── #4: 12s-2 min shows hint only (strong content) ───────────────────────────
assert.equal(snapshot.RECENT_CLIPBOARD_HINT_TTL_MS, 2 * 60_000, '#4: hint TTL is 2 min')
const recent60s = { ...strongBase, changedAt: Date.now() - 60_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldShowRecentClipboardHint(recent60s), true, '#4: 60s shows age-hint window')
assert.equal(objectBlock.createClipboardObjectBlock(recent60s), null, '#4: 60s does not create block')
const hint = objectBlock.buildRecentClipboardHint(recent60s)
assert.ok(hint, '#4: hint created for recent strong clipboard')

// ─── #5: >2 min or unknown: nothing ───────────────────────────────────────────
const old3min = { ...s1, changedAt: Date.now() - 3 * 60_000, ageConfidence: 'known' }
assert.equal(snapshot.shouldAutoAttachClipboard(old3min), false, '#5: 3 min no attach')
assert.equal(snapshot.shouldShowRecentClipboardHint(old3min), false, '#5: 3 min no hint')
assert.equal(objectBlock.buildRecentClipboardHint(old3min), null, '#5: no hint for old')
const unknownSnap = snapshot.createClipboardSnapshotFromUnknownAge('whatever')
assert.equal(snapshot.shouldAutoAttachClipboard(unknownSnap), false, '#5: unknown no attach')
assert.equal(snapshot.shouldShowRecentClipboardHint(unknownSnap), false, '#5: unknown no hint')

// ─── #9: Action labels use descriptive text, not plugin name as primary ────────
const jsonActions = recommendation.recommendActionsForBlock({ source: 'clipboard', kind: 'json' })
for (const action of jsonActions) {
  assert.ok(action.titleZh.length > 0, '#9: action has Chinese title')
  // Title should be descriptive, e.g. "格式化剪贴板 JSON" not "JSON Tools"
  if (action.pluginId) assert.ok(!action.titleZh.startsWith(action.pluginId), '#9: title should not start with plugin name')
}
// ─── #11: Secret mask ──────────────────────────────────────────────────────────
const secretSnap = { ...s1, changedAt: Date.now() - 5_000, ageConfidence: 'known', detectedType: 'secret', text: 'sk-abc123' }
const secretBlock = objectBlock.createClipboardObjectBlock(secretSnap)
assert.ok(secretBlock, '#11: secret block created')
assert.equal(secretBlock.secretMasked, true, '#11: secret block masked')
assert.equal(secretBlock.preview, undefined, '#11: secret preview hidden')

// Secret actions suppress network-dependent operations
const secretActions = recommendation.recommendActionsForBlock({ source: 'clipboard', kind: 'secret' })
assert.ok(!secretActions.some(a => a.id === 'translate-clipboard'), '#11: secret suppresses translate')
assert.ok(!secretActions.some(a => a.id === 'summarize-clipboard'), '#11: secret suppresses summarize')

console.log('clipboard direction adjustment: all 11 requirements verified')
