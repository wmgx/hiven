#!/usr/bin/env node
/**
 * Editor Object Block — Phase R2 behavior tests
 *
 * Verifies:
 *  - useEditorObjectBlock creates selection/document blocks correctly
 *  - EditorCommandBarHost integrates useEditorObjectBlock
 *  - Editor Cmd+K does NOT use clipboard freshness rules
 *  - Editor object block recommends editor-local actions
 *  - Backspace deletion works in editor command bar
 *  - Regression: no clipboard freshness in editor
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

// ─── Load models ───────────────────────────────────────────────────────────────
const snapshot = transpileAndRun('src/launcher/clipboard/clipboardSnapshot.ts')
const objectBlock = transpileAndRun('src/launcher/clipboard/objectBlock.ts', {
  shouldAutoAttachClipboard: snapshot.shouldAutoAttachClipboard,
  shouldShowRecentClipboardHint: snapshot.shouldShowRecentClipboardHint,
  isSoftClipboardOperand: snapshot.isSoftClipboardOperand,
  detectClipboardFilePath: snapshot.detectClipboardFilePath,
  fileNameFromPath: snapshot.fileNameFromPath,
})
const recommendation = transpileAndRun('src/launcher/clipboard/actionRecommendation.ts')

// ─── Editor selection block creation ───────────────────────────────────────────
const jsonSelection = '{"users": [{"name": "Alice"}]}'
const editorBlock = objectBlock.createEditorSelectionObjectBlock({
  text: jsonSelection,
  kind: 'json',
  lineCount: 1,
})
assert.equal(editorBlock.source, 'editor-selection', 'editor selection block source')
assert.equal(editorBlock.kind, 'json', 'editor selection block kind')
assert.ok(editorBlock.subtitle.includes('1 行'), 'editor selection block subtitle')
assert.equal(editorBlock.removable, true)

// ─── Editor document block creation ────────────────────────────────────────────
const docBlock = objectBlock.createEditorDocumentObjectBlock({
  text: '# Hello\n\nWorld',
  kind: 'markdown',
  charCount: 14,
})
assert.equal(docBlock.source, 'editor-document')
assert.ok(docBlock.subtitle.includes('14 字'))

// ─── Editor-local recommendations ─────────────────────────────────────────────
const editorJsonActions = recommendation.recommendActionsForBlock({ ...editorBlock, source: 'editor-selection', kind: 'json' })
assert.ok(editorJsonActions.length > 0, 'editor json should have recommendations')
assert.ok(editorJsonActions.some(a => a.id === 'format-selection'), 'should recommend format selection')
assert.ok(!editorJsonActions.some(a => a.id === 'translate-clipboard'), 'should NOT recommend clipboard translate')
assert.ok(!editorJsonActions.some(a => a.id === 'format-clipboard-json'), 'should NOT recommend clipboard format')

const editorTextActions = recommendation.recommendActionsForBlock({ ...editorBlock, source: 'editor-selection', kind: 'text' })
assert.ok(!editorTextActions.some(a => a.id === 'translate-selection'), 'editor text should NOT recommend translate selection')

// ─── Static contract: EditorCommandBarHost ─────────────────────────────────────
const editorCmdBarHost = readFileSync('src/launcher/hosts/EditorCommandBarHost.tsx', 'utf8')
assert.match(editorCmdBarHost, /useEditorObjectBlock/, 'Editor Cmd+K must use useEditorObjectBlock hook')
assert.match(editorCmdBarHost, /ObjectBlockToken/, 'Editor Cmd+K must render ObjectBlockToken')
assert.match(editorCmdBarHost, /RecommendedActionRow/, 'Editor Cmd+K must render RecommendedActionRow')
assert.match(editorCmdBarHost, /recommendActionsForBlock/, 'Editor Cmd+K must call recommendActionsForBlock')
assert.match(editorCmdBarHost, /editorBlock\.handleBackspace/, 'Editor Cmd+K must handle Backspace for block deletion')
assert.match(editorCmdBarHost, /data-testid="editor-recommended-actions"/, 'Editor Cmd+K must expose recommended actions test id')
assert.match(editorCmdBarHost, /executeRecommendedAction/, 'Editor Cmd+K object actions must execute through the shared action executor')
assert.match(editorCmdBarHost, /replaceEditorSelection/, 'Editor Cmd+K default transform output should replace editor selection or pane')
assert.match(editorCmdBarHost, /js-filter\.panel/, 'JSON expression action should open the JSON Tools expression bottom panel')
assert.match(editorCmdBarHost, /OutputTargetExpansion/, 'Editor Cmd+K should support output target expansion')
assert.match(editorCmdBarHost, /setSelectedObjectActionIndex/, 'Editor Cmd+K should maintain object-action selection separately from normal launcher items')

// ─── Regression: no clipboard freshness in editor ──────────────────────────────
assert.doesNotMatch(editorCmdBarHost, /shouldAutoAttachClipboard|FRESH_CLIPBOARD_TTL/, 'Editor Cmd+K must not use clipboard freshness rules')
assert.doesNotMatch(editorCmdBarHost, /readLauncherClipboard/, 'Editor Cmd+K must not read system clipboard for object block')

// ─── useEditorObjectBlock static contract ──────────────────────────────────────
const hookSrc = readFileSync('src/launcher/clipboard/useEditorObjectBlock.ts', 'utf8')
assert.match(hookSrc, /getSelectionText/, 'hook must read editor selection')
assert.match(hookSrc, /getActiveText/, 'hook must read editor active text')
assert.match(hookSrc, /createEditorSelectionObjectBlock/, 'hook must create selection block')
assert.match(hookSrc, /createEditorDocumentObjectBlock/, 'hook must create document block')
assert.doesNotMatch(hookSrc, /shouldAutoAttachClipboard|FRESH_CLIPBOARD_TTL/, 'hook must not use clipboard freshness')
assert.doesNotMatch(hookSrc, /readClipboard|readText.*clipboard/, 'hook must not read system clipboard')

console.log('editor object block Phase R2 checks passed')
