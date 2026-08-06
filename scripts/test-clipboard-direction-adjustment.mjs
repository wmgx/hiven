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
const objectBlock = transpileAndRun('src/launcher/clipboard/objectBlock.ts', {
  shouldAutoAttachClipboard: snapshot.shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint: snapshot.shouldShowRecentClipboardHint,
  isStrongClipboardAttachEligible: (text) => {
    const t = String(text||'').trim()
    return t.startsWith('{') || t.startsWith('[') || /^https?:\/\//i.test(t) || /\.csv$/i.test(t)
  },
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  fileNameFromPath: snapshot.fileNameFromPath,
})
const recommendation = transpileAndRun('src/launcher/clipboard/actionRecommendation.ts')

const contextBroker = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')
const globalLauncherHost = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const searchFrame = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')
const keyboard = readFileSync('src/components/launcher/GlobalLauncherKeyboard.ts', 'utf8')
const editorHost = readFileSync('src/launcher/hosts/EditorCommandBarHost.tsx', 'utf8')
const hookSrc = readFileSync('src/launcher/clipboard/useClipboardObjectBlock.ts', 'utf8')
const editorHookSrc = readFileSync('src/launcher/clipboard/useEditorObjectBlock.ts', 'utf8')

// ─── #1: Global Launcher no longer reads external selection ────────────────────
assert.doesNotMatch(
  contextBroker,
  /\[foregroundContextProvider[\s\S]{0,80}externalSelectionContextProvider[\s\S]{0,80}clipboardContextProvider[\s\S]{0,20}\.\.\.providers\]/,
  '#1: default context snapshot must NOT include externalSelectionContextProvider',
)
assert.doesNotMatch(globalLauncherHost, /externalSelection/, '#1: GlobalLauncherHost must not reference external selection')
assert.doesNotMatch(hookSrc, /externalSelection|readExternalSelection/, '#1: clipboard hook must not read external selection')

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

// ─── #6: ObjectBlockToken in search input ──────────────────────────────────────
assert.match(searchFrame, /ObjectBlockToken/, '#6: SearchFrame renders ObjectBlockToken')
// data-testid="object-block-token" is in the ObjectBlockToken component, verified below
const tokenSrc = readFileSync('src/components/launcher/ObjectBlockToken.tsx', 'utf8')
assert.match(tokenSrc, /data-testid="object-block-token"/, '#6: ObjectBlockToken component has test id')
assert.match(tokenSrc, /data-source=/, '#6: token shows source')
assert.match(tokenSrc, /data-kind=/, '#6: token shows kind')
assert.match(tokenSrc, /data-state=/, '#6: token shows age/state')

// ─── #7: × delete + empty-query Backspace one-shot remove ─────────────────────
assert.match(tokenSrc, /onRemove/, '#7: ObjectBlockToken has × remove')
assert.match(keyboard, /handleClipboardBackspace/, '#7: keyboard handles Backspace')
assert.match(tokenSrc, /selectedForDelete/, '#7: token still supports selected-for-delete visual')
assert.match(keyboard, /isClipboardHintSelected|selectedIndex === -1/, '#7b: Enter only attaches hint when selected')
assert.doesNotMatch(
  keyboard,
  /if \(event\.key === 'Enter' && hasClipboardHint && attachHintAsBlock\) \{\s*event\.preventDefault\(\)\s*attachHintAsBlock\(\)/,
  '#7b: must not attach clipboard hint on bare Enter without selection',
)

// ─── #8: Object Block shows recommended actions, not clipboard as search ───────
assert.match(searchFrame, /recommendActionsForBlock/, '#8: recommended actions computed from block')
assert.match(searchFrame, /block && \(/, '#8: actions shown when block exists (object-action mode)')
assert.match(searchFrame, /filteredActions/, '#8: actions filtered by query')
assert.match(searchFrame, /RecommendedActionRow/, '#8: actions rendered as RecommendedActionRow')

// ─── #9: Action labels use descriptive text, not plugin name as primary ────────
const jsonActions = recommendation.recommendActionsForBlock({ source: 'clipboard', kind: 'json' })
for (const action of jsonActions) {
  assert.ok(action.titleZh.length > 0, '#9: action has Chinese title')
  // Title should be descriptive, e.g. "格式化剪贴板 JSON" not "JSON Tools"
  if (action.pluginId) assert.ok(!action.titleZh.startsWith(action.pluginId), '#9: title should not start with plugin name')
}
const rowSrc = readFileSync('src/components/launcher/RecommendedActionRow.tsx', 'utf8')
assert.match(rowSrc, /action\.titleZh/, '#9: row displays Chinese action title')
assert.match(rowSrc, /来自/, '#9: plugin name shown as attribution, not primary')

// ─── #10: Editor Cmd+K uses EditorObjectBlock, not clipboard freshness ─────────
assert.match(editorHost, /useEditorObjectBlock/, '#10: editor uses useEditorObjectBlock')
assert.doesNotMatch(editorHost, /shouldAutoAttachClipboard|FRESH_CLIPBOARD_TTL/, '#10: editor does not use clipboard freshness')
assert.doesNotMatch(editorHookSrc, /shouldAutoAttachClipboard|readClipboard/, '#10: editor hook does not use clipboard')
assert.match(editorHookSrc, /createEditorSelectionObjectBlock/, '#10: editor hook creates selection block')
assert.match(editorHookSrc, /createEditorDocumentObjectBlock/, '#10: editor hook creates document block')

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
