import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  const absolute = join(root, path)
  return existsSync(absolute) ? readFileSync(absolute, 'utf8') : ''
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

function assertTracksAll(source, label, snippets) {
  for (const snippet of snippets) {
    assert(
      source.includes(`disposables.add(${snippet}`),
      `${label} should add ${snippet} to the Monaco disposable bucket`,
    )
  }
}

const helper = read('src/utils/monacoDisposables.ts')
const paneEditor = read('src/components/workspace/PaneEditor.tsx')
const dualEditorView = read('src/kits/ui/DualEditorView.tsx')
const jsFilter = read('src/plugins/jsFilter/index.tsx')

assert(/createMonacoDisposableBucket/.test(helper), 'shared Monaco disposable bucket helper should exist')
assert(/disposeAllMonacoDisposables/.test(helper), 'shared Monaco disposable helper should expose safe bulk disposal')
assert(/disposable\.dispose\(\)/.test(helper), 'shared Monaco disposable helper should dispose tracked subscriptions')

assert(/monacoDisposablesRef/.test(paneEditor), 'PaneEditor should keep a per-mount Monaco disposable bucket')
assert(/monacoDisposablesRef\.current\?\.dispose\(\)/.test(paneEditor), 'PaneEditor should dispose the previous/current bucket')
assert(/editorRef\.current\s*=\s*null/.test(paneEditor), 'PaneEditor should clear the Monaco editor ref during disposal')
assertTracksAll(paneEditor, 'PaneEditor', [
  'editor.onDidFocusEditorText',
  'editor.onDidChangeCursorPosition',
  'editor.onDidChangeCursorSelection',
  'editor.onDidPaste',
  'editor.addAction',
  'editor.addAction',
  'editor.addAction',
])
assert(/disposables\.add\(\{\s*dispose\(\)\s*\{\s*window\.removeEventListener\('paste'/s.test(paneEditor), 'PaneEditor should release paste capture listener through the bucket')
assert(/window\.removeEventListener\('keydown', handlePasteKeydownCapture, true\)/.test(paneEditor), 'PaneEditor should release paste keydown listener')

assert(/leftDisposablesRef/.test(dualEditorView), 'DualEditorView should keep a left editor disposable bucket')
assert(/rightDisposablesRef/.test(dualEditorView), 'DualEditorView should keep a right editor disposable bucket')
assertTracksAll(dualEditorView, 'DualEditorView', [
  'editor.onDidFocusEditorText',
  'editor.onDidChangeModelContent',
  'editor.onDidScrollChange',
])
assert(/disposeAllMonacoDisposables\(leftDisposablesRef\.current\)/.test(dualEditorView), 'DualEditorView should dispose left editor subscriptions on unmount')
assert(/disposeAllMonacoDisposables\(rightDisposablesRef\.current\)/.test(dualEditorView), 'DualEditorView should dispose right editor subscriptions on unmount')
assert(/leftRef\.current\s*=\s*null/.test(dualEditorView), 'DualEditorView should clear the left editor ref during disposal')
assert(/rightRef\.current\s*=\s*null/.test(dualEditorView), 'DualEditorView should clear the right editor ref during disposal')
assert(/leftDecIds\.current\s*=\s*\[\]/.test(dualEditorView), 'DualEditorView should clear left decoration ids during disposal')
assert(/rightDecIds\.current\s*=\s*\[\]/.test(dualEditorView), 'DualEditorView should clear right decoration ids during disposal')

assert(/editorDisposablesRef/.test(jsFilter), 'jsFilter panel should keep an editor disposable bucket')
assertTracksAll(jsFilter, 'jsFilter panel', [
  'editor.onKeyDown',
  'editor.onDidContentSizeChange',
])
assert(/disposeAllMonacoDisposables\(editorDisposablesRef\.current\)/.test(jsFilter), 'jsFilter panel should dispose editor subscriptions on unmount')
assert(/editorRef\.current\s*=\s*null/.test(jsFilter), 'jsFilter panel should clear the Monaco editor ref during disposal')

console.log('Monaco disposable lifecycle checks passed')
