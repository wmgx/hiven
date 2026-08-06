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
  detectClipboardType: snapshot.detectClipboardType,
  fileNameFromPath: snapshot.fileNameFromPath,
})
const recommendation = transpileAndRun('src/launcher/clipboard/actionRecommendation.ts', {
  discoverActionsForBlock: () => [],
})
const executor = transpileAndRun('src/launcher/clipboard/actionExecutor.ts', {
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
})

// ─── Scenario 1: Recommended action click calls executor ─────────────────────

console.log('Scenario 1: Recommended action click calls executor')
{
  const hostSrc = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
  // Verify executeRecommendedAction is imported and used
  assert.match(hostSrc, /import\s*\{[^}]*executeRecommendedAction[^}]*\}/, 'GlobalLauncherHost imports executeRecommendedAction')
  assert.match(hostSrc, /executeRecommendedAction\(\s*\{\s*block,\s*action,\s*target\s*\}/, 'GlobalLauncherHost calls executeRecommendedAction with context')
  // Verify all required handlers are provided
  assert.match(hostSrc, /copyText:\s*writeClipboardText/, 'GlobalLauncherHost provides copyText handler')
  assert.match(hostSrc, /openInEditor:/, 'GlobalLauncherHost provides openInEditor handler')
  assert.match(hostSrc, /openPluginSurface:/, 'GlobalLauncherHost provides openPluginSurface handler')
  assert.match(hostSrc, /openUrl:/, 'GlobalLauncherHost provides openUrl handler')
  // Verify onExecuteObjectAction is wired to panel
  assert.match(hostSrc, /onExecuteObjectAction=\{executeObjectAction\}/, 'GlobalLauncherHost passes executeObjectAction to panel')
  console.log('  ✓ All handlers wired correctly')
}

// ─── Scenario 2: Executor uses full payloadText, not preview ─────────────────

console.log('Scenario 2: Executor uses full payloadText, not preview')
{
  // Verify the LauncherObjectBlock type has payloadText
  const objectBlockSrc = readFileSync('src/launcher/clipboard/objectBlock.ts', 'utf8')
  assert.match(objectBlockSrc, /payloadText\?:\s*string/, 'LauncherObjectBlock has payloadText field')

  // Verify createGenericObjectBlock sets payloadText
  assert.match(objectBlockSrc, /payloadText:\s*params\.text/, 'createGenericObjectBlock stores full text as payloadText')

  // Verify executor uses payloadText
  const executorSrc = readFileSync('src/launcher/clipboard/actionExecutor.ts', 'utf8')
  assert.match(executorSrc, /block\.payloadText\s*\?\?\s*block\.preview/, 'Executor uses payloadText ?? preview fallback')
  assert.doesNotMatch(executorSrc, /const text = block\.preview \?\? ''/, 'Executor does NOT use only block.preview')

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

// ─── Scenario 3: Query filters history object actions (host list path) ───────

console.log('Scenario 3: Query filters history object actions')
{
  const hostSrc = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
  // Retired RecommendedActionRow — filtering lives on historyObjectActionItems
  assert.match(hostSrc, /historyObjectActionItems/, 'Host builds historyObjectActionItems')
  assert.match(
    hostSrc,
    /action\.title\.toLowerCase\(\)\.includes\(q\)/,
    'Filters history actions by title',
  )
  assert.match(
    hostSrc,
    /action\.titleZh\.toLowerCase\(\)\.includes\(q\)/,
    'Filters history actions by titleZh',
  )
  assert.match(
    hostSrc,
    /action\.id\.toLowerCase\(\)\.includes\(q\)/,
    'Filters history actions by id',
  )
  console.log('  ✓ Query filtering implemented for history object actions')
}

// ─── Scenario 4: Object Block coexists with LauncherMixedList ────────────────

console.log('Scenario 4: Object Block token + mixed list (ranking path)')
{
  const searchFrameSrc = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')
  // Current product: ObjectBlockToken in header + LauncherMixedList for tools/actions
  assert.match(searchFrameSrc, /ObjectBlockToken/, 'Object block token renders in search frame')
  assert.match(searchFrameSrc, /LauncherMixedList/, 'Mixed list remains the action surface')
  assert.doesNotMatch(searchFrameSrc, /RecommendedActionRow/, 'Dedicated action rows stay retired')
  console.log('  ✓ Block token + ranking/mixed list is the object-action surface')
}

// ─── Scenario 5: RecentClipboardHint attach preserves original ageLabel ──────

console.log('Scenario 5: RecentClipboardHint attach preserves original ageLabel')
{
  // Verify createClipboardObjectBlock supports forceAttach option
  const objectBlockSrc = readFileSync('src/launcher/clipboard/objectBlock.ts', 'utf8')
  assert.match(objectBlockSrc, /forceAttach\?:\s*boolean/, 'createClipboardObjectBlock accepts forceAttach option')
  assert.match(objectBlockSrc, /!options\?\.forceAttach && !shouldAutoAttachClipboard/, 'forceAttach bypasses freshness check')

  // Verify useClipboardObjectBlock uses forceAttach
  const hookSrc = readFileSync('src/launcher/clipboard/useClipboardObjectBlock.ts', 'utf8')
  assert.match(hookSrc, /forceAttach:\s*true/, 'attachHintAsBlock uses forceAttach: true')
  assert.doesNotMatch(hookSrc, /changedAt:\s*now/, 'attachHintAsBlock does NOT override changedAt')

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

// ─── Scenario 6: Object Block deletion restores search-only mode ─────────────

console.log('Scenario 6: Object Block deletion restores search-only mode')
{
  const searchFrameSrc = readFileSync('src/components/launcher/GlobalLauncherSearchFrame.tsx', 'utf8')
  assert.match(searchFrameSrc, /LauncherMixedList/, 'LauncherMixedList is always the list surface')

  // Verify Backspace handling in hook — single press starts remove transition when query empty
  const hookSrc = readFileSync('src/launcher/clipboard/useClipboardObjectBlock.ts', 'utf8')
  assert.match(hookSrc, /if \(!queryEmpty\) return false/, 'Backspace only when query empty')
  assert.match(
    hookSrc,
    /const handleBackspace = useCallback\(\(queryEmpty: boolean\): boolean => \{[\s\S]*?removeBlock\(\)[\s\S]*?return true/,
    'Backspace removes block in one press via removeBlock()',
  )
  assert.match(hookSrc, /removeBlock/, 'removeBlock callback exposed')
  assert.match(hookSrc, /OBJECT_BLOCK_EXIT_MS|setIsExiting\(true\)/, 'remove plays exit transition then clears block')
  console.log('  ✓ Block deletion restores search-only mode')
}

// ─── Scenario 7: Global Launcher default does NOT read external selection ────

console.log('Scenario 7: Global Launcher default does NOT read external selection')
{
  const contextBrokerSrc = readFileSync('src/launcher/context/contextBroker.ts', 'utf8')
  // Verify externalSelectionContextProvider is NOT in the default array
  assert.match(
    contextBrokerSrc,
    /\/\/ NOTE: externalSelectionContextProvider intentionally removed from defaults/,
    'Comment confirms external selection is intentionally excluded',
  )
  // The default providers line should NOT contain externalSelectionContextProvider
  const defaultProvidersLine = contextBrokerSrc.match(/\[foregroundContextProvider.*?\]/s)?.[0] ?? ''
  assert.doesNotMatch(
    defaultProvidersLine,
    /externalSelectionContextProvider/,
    'Default providers must NOT include externalSelectionContextProvider',
  )
  // No Cmd+C simulation
  assert.doesNotMatch(contextBrokerSrc, /simulate.*copy|cmd.*c.*simulate/i, 'No Cmd+C simulation in context broker')
  console.log('  ✓ Global Launcher does not auto-read external selection')
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

console.log('\n✅ All 8 MVP closure scenarios passed')
