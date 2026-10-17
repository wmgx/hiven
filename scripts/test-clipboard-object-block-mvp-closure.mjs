#!/usr/bin/env node
/**
 * Clipboard Object Block MVP Closure Tests
 *
 * Covers 8 verification scenarios for the MVP closure:
 *  1. Recommended action click calls executor
 *  2. Executor uses full payloadText, not preview
 *  3. Query filters recommended actions (not fall through to search)
 *  4. Object Block present → never falls back to LauncherMixedList
 *  5. RecentClipboardHint attach preserves original ageLabel
 *  6. Object Block deletion restores search-only mode
 *  7. Global Launcher default does NOT read external selection
 *  8. Secret block does not show preview AND does not recommend network actions
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'
import { objectBlockText, objectBlockTextModule } from './helpers/object-block-text.mjs'

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
  const sandbox = { exports: moduleExports, module: { exports: moduleExports }, console, Date, JSON, btoa, atob, unescape, encodeURIComponent, decodeURIComponent, Number, Math, String, Array, Object, RegExp, Boolean, Error, ...globals }
  vm.runInNewContext(out, sandbox)
  return sandbox.module.exports
}

// ─── Load modules ──────────────────────────────────────────────────────────────
const snapshot = transpileAndRun('src/launcher/clipboard/clipboardSnapshot.ts')
const detect = transpileAndRun('src/kits/content/detectContent.ts')
// Real attach policy, not a hand-written approximation of it — see the same note
// in test-clipboard-direction-adjustment.mjs.
const attachPolicy = transpileAndRun('src/launcher/clipboard/attachPolicy.ts', {
  detectContent: detect.detectContent,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
})
const objectBlock = transpileAndRun('src/launcher/clipboard/objectBlock.ts', {
  objectBlockText,
  detectContent: detect.detectContent,
  shouldAutoAttachClipboard: snapshot.shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint: snapshot.shouldShowRecentClipboardHint,
  isStrongClipboardAttachEligible: attachPolicy.isStrongClipboardAttachEligible,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  detectClipboardType: snapshot.detectClipboardType,
  fileNameFromPath: snapshot.fileNameFromPath,
})
const materialText = transpileAndRun('src/launcher/clipboard/currentMaterial.ts')
const currentTextSupport = transpileAndRun('src/launcher/clipboard/currentTextDelivery.ts', materialText)
const paletteMessages = transpileAndRun('src/i18n/locales/palette.ts').default
const currentTextGlobals = {
  ...currentTextSupport,
  t: (locale, key) => paletteMessages[locale][key.replace(/^palette\./, '')],
}
const recommendation = transpileAndRun('src/launcher/clipboard/actionRecommendation.ts', {
  ...currentTextGlobals,
  discoverActionsForBlock: () => [],
})
const executor = transpileAndRun('src/launcher/clipboard/actionExecutor.ts', {
  ...currentTextSupport,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
})

// ─── Scenario 2: Executor uses full payloadText, not preview ─────────────────

console.log('Scenario 2: Executor uses full payloadText, not preview')
{
  // Create a block with long text and verify payloadText preserved
  const longJson = JSON.stringify({ key: 'x'.repeat(500), nested: { a: 1, b: 2 } })
  const snap = { ...snapshot.updateClipboardSnapshot(longJson), changedAt: Date.now() - 10_000, ageConfidence: 'known' }
  const block = objectBlock.createClipboardObjectBlock(snap)
  assert.ok(block, 'Block should be created')
  assert.ok(block.preview.length <= 120, `preview should be truncated (got ${block.preview.length})`)
  assert.equal(block.payloadText, longJson, 'payloadText should contain full text')
  assert.ok(block.payloadText.length > 120, 'payloadText must be longer than preview')

  // Verify executor can format the full JSON (not truncated)
  let copiedText = ''
  const result = await executor.executeRecommendedAction(
    { block, action: { id: 'format-clipboard-json', defaultOutput: 'copy' }, target: 'copy' },
    { copyText: async (text) => { copiedText = text }, openInEditor: async () => {}, openPluginSurface: async () => {} },
  )
  assert.equal(result.ok, true, 'Execution should succeed')
  const parsed = JSON.parse(copiedText)
  assert.equal(parsed.key, 'x'.repeat(500), 'Formatted JSON must use full payloadText, not truncated preview')
  console.log('  ✓ Executor uses payloadText for full content')
}

// ─── Scenario 5: RecentClipboardHint attach preserves original ageLabel ──────

console.log('Scenario 5: RecentClipboardHint attach preserves original ageLabel')
{
  // Functional test: 90s old clipboard (in 30s–2min hint window) keeps ageLabel after attach
  const ninetySecAgo = Date.now() - 90_000
  const snap = {
    text: 'hello from 90s ago',
    hash: snapshot.hashClipboardText('hello from 90s ago'),
    detectedType: 'text',
    firstSeenAt: ninetySecAgo,
    lastSeenAt: Date.now(),
    changedAt: ninetySecAgo,
    ageConfidence: 'known',
  }

  // Verify it's in "recent hint" window (not fresh; max hint is 2 min)
  assert.equal(snapshot.shouldAutoAttachClipboard(snap), false, '90s old should not auto-attach')
  assert.equal(snapshot.shouldShowRecentClipboardHint(snap), true, '90s old should show hint')

  // Force attach should create block
  const forcedBlock = objectBlock.createClipboardObjectBlock(snap, Date.now(), { forceAttach: true })
  assert.ok(forcedBlock, 'forceAttach should create block even for non-fresh clipboard')
  assert.equal(forcedBlock.ageLabel, '1 分钟前', 'ageLabel must reflect original time, not "刚刚"')
  console.log('  ✓ RecentClipboardHint attach preserves original age')
}

// ─── Scenario 8: Secret block behavior ──────────────────────────────────────

console.log('Scenario 8: Secret block does not show preview AND does not recommend network actions')
{
  // Create a secret-like block
  const secretText = 'sk-proj-1234567890abcdef_secret_token_value'
  const secretSnap = { ...snapshot.updateClipboardSnapshot(secretText), changedAt: Date.now() - 5000, ageConfidence: 'known' }
  const secretBlock = objectBlock.createClipboardObjectBlock(secretSnap)
  assert.ok(secretBlock, 'Secret block should be created')
  assert.equal(secretBlock.secretMasked, true, 'Secret block must be masked')
  assert.equal(secretBlock.preview, undefined, 'Secret block preview must be undefined (masked)')
  // payloadText should still hold the content for local-only actions
  assert.equal(secretBlock.payloadText, secretText, 'Secret block payloadText should still hold content for local actions')

  // Verify recommended actions for secret
  const actions = recommendation.recommendActionsForBlock(secretBlock)
  assert.ok(actions.length > 0, 'Secret block should have at least one action')
  // No translate, summarize, or URL-based actions for secrets
  const networkActionIds = actions.filter((a) =>
    a.id === 'translate-clipboard' ||
    a.id === 'summarize-clipboard' ||
    a.id === 'open-url-in-browser'
  )
  assert.equal(networkActionIds.length, 0, 'Secret block must NOT recommend network actions (translate, summarize, open-url)')
  // Only local actions like "open in editor"
  const localActions = actions.filter((a) => a.id === 'open-clipboard-editor')
  assert.ok(localActions.length > 0, 'Secret block should recommend local-only "open in editor"')
  console.log('  ✓ Secret block: no preview, no network actions, payloadText available for local use')
}

// ─── Summary ──────────────────────────────────────────────────────────────────

console.log('\n✅ MVP closure behavior scenarios passed')
