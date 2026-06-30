#!/usr/bin/env node
/**
 * Design language migration contract — Step 5 spec.
 *
 * RED first: verifies the product rules from pasted Step 5 before implementation:
 * - ordinary Global Launcher object actions never expose paste-to-current-app;
 * - Web Open uses open-url, not paste;
 * - Translate is not recommended inside Editor Cmd+K;
 * - merged product providers are shown as product names (JSON Tools, Encode / Decode Tools);
 * - Action Row subtitle language is provider + default output, not raw plugin ids.
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

const recommendation = transpileAndRun('src/launcher/clipboard/actionRecommendation.ts')
const executor = transpileAndRun('src/launcher/clipboard/actionExecutor.ts')

function allTargets(action) {
  return [action.defaultOutput, ...(action.alternativeOutputs ?? [])]
}

const clipboardJsonActions = recommendation.recommendActionsForBlock({
  source: 'clipboard',
  kind: 'json',
  preview: '{"a":1}',
})
assert.ok(clipboardJsonActions.some((action) => action.titleZh === '格式化剪贴板 JSON'), 'JSON clipboard should recommend object/action wording')
for (const action of clipboardJsonActions) {
  assert.ok(!allTargets(action).includes('paste-to-foreground'), `Global clipboard action ${action.id} must not paste to current app`)
}
assert.ok(clipboardJsonActions.some((action) => action.provider === 'JSON Tools'), 'json actions should expose merged provider label JSON Tools')
assert.ok(!clipboardJsonActions.some((action) => action.pluginId === 'sort-json' || action.pluginId === 'js-filter'), 'sort-json/js-filter should be folded into JSON Tools product identity')

const clipboardTextActions = recommendation.recommendActionsForBlock({
  source: 'clipboard',
  kind: 'text',
  preview: 'hello world',
})
for (const action of clipboardTextActions) {
  assert.ok(!allTargets(action).includes('paste-to-foreground'), `Global text action ${action.id} must not paste to current app`)
}
assert.ok(clipboardTextActions.some((action) => action.id === 'translate-clipboard'), 'Global Launcher may translate clipboard text')
assert.ok(clipboardTextActions.some((action) => action.provider === 'Encode / Decode Tools'), 'Global text object should expose merged Encode / Decode Tools actions')
assert.ok(clipboardTextActions.some((action) => action.id === 'base64-encode'), 'Encode / Decode Tools should include Base64 encode action')
assert.ok(clipboardTextActions.some((action) => action.id === 'html-decode'), 'Encode / Decode Tools should include HTML decode action')

const urlActions = recommendation.recommendActionsForBlock({
  source: 'clipboard',
  kind: 'url',
  preview: 'https://example.com',
})
const openUrl = urlActions.find((action) => action.id === 'open-url-in-browser')
assert.ok(openUrl, 'URL clipboard should recommend Web Open')
assert.equal(openUrl.defaultOutput, 'open-url', 'Web Open default output is open URL, not paste')
assert.ok(!allTargets(openUrl).includes('paste-to-foreground'), 'Web Open must not use paste target')

const editorTextActions = recommendation.recommendActionsForBlock({
  source: 'editor-selection',
  kind: 'text',
  preview: 'hello from editor',
})
assert.ok(!editorTextActions.some((action) => action.id === 'translate-selection'), 'Editor Cmd+K must not recommend Translate')
assert.ok(editorTextActions.every((action) => action.defaultOutput !== 'paste-to-foreground'), 'Editor actions must not paste to current app')
assert.ok(editorTextActions.some((action) => action.provider === 'Encode / Decode Tools' && action.defaultOutput === 'replace-selection'), 'Editor text should offer Encode / Decode with replace-selection default')

assert.equal(executor.getOutputTargetLabel('copy', 'zh'), '复制结果')
assert.equal(executor.getOutputTargetLabel('open-editor', 'zh'), '打开到 Editor')
assert.equal(executor.getOutputTargetLabel('open-plugin-surface', 'zh'), '打开工具窗口')
assert.equal(executor.getOutputTargetLabel('open-url', 'zh'), '打开 URL')


const globalHostSrc = readFileSync('src/launcher/hosts/GlobalLauncherHost.tsx', 'utf8')
const globalPanelSrc = readFileSync('src/components/launcher/GlobalLauncherPanel.tsx', 'utf8')
const globalFramesSrc = readFileSync('src/components/launcher/GlobalLauncherFrames.tsx', 'utf8')
assert.match(globalHostSrc, /executeRecommendedAction/, 'Global object actions should be wired to the executor')
assert.match(globalHostSrc, /writeClipboardText/, 'copy output should write clipboard')
assert.match(globalHostSrc, /createEditorPane/, 'open-editor output should create an editor pane')
assert.match(globalHostSrc, /openPluginSurface/, 'open-plugin-surface output should open a plugin surface')
assert.match(globalHostSrc, /openUrl/, 'Web Open should route through shell open')
assert.doesNotMatch(globalHostSrc, /pasteToForeground/, 'ordinary Global Launcher object actions must not wire paste-to-foreground')
assert.match(globalPanelSrc, /onExecuteObjectAction/, 'GlobalLauncherPanel should pass object action execution down')
assert.match(globalFramesSrc, /onExecuteAction=\{onExecuteAction\}/, 'GlobalLauncherFrameSwitch should wire SearchFrame action execution')

const editorCmdBarSrc = readFileSync('src/launcher/hosts/EditorCommandBarHost.tsx', 'utf8')
assert.match(editorCmdBarSrc, /executeRecommendedAction/, 'Editor object actions should be wired to the shared executor')
assert.match(editorCmdBarSrc, /replaceEditorSelection/, 'Editor object transforms should default to in-editor replacement')
assert.match(editorCmdBarSrc, /js-filter\.panel/, 'JSON Expression should open JSON Tools expression bottom panel')
assert.match(editorCmdBarSrc, /OutputTargetExpansion/, 'Editor object actions should expose output target expansion')
const jsFilterSrc = readFileSync('src/plugins/jsFilter/index.tsx', 'utf8')
assert.match(jsFilterSrc, /JSON Tools · Expression/, 'js-filter plugin UI should be reframed under JSON Tools · Expression')
assert.doesNotMatch(jsFilterSrc, /title:\s*['"]JS Filter['"]/, 'JS Filter should no longer be the user-facing panel title')
const keyboardSrc = readFileSync('src/components/launcher/GlobalLauncherKeyboard.ts', 'utf8')
assert.match(keyboardSrc, /setSelectedObjectActionIndex/, 'Global object action keyboard navigation should not reuse normal list selectedIndex')
assert.match(keyboardSrc, /objectActionCount/, 'Global object action keyboard navigation should clamp by object action count')

const rowSrc = readFileSync('src/components/launcher/RecommendedActionRow.tsx', 'utf8')
assert.match(rowSrc, /provider/, 'Action Row should render provider label')
assert.doesNotMatch(rowSrc, /来自 \{action\.pluginId\}/, 'Action Row must not show raw plugin id as provider')
assert.match(rowSrc, /Enter/, 'Action Row should show default key hint language')

console.log('design language migration contract checks passed')
