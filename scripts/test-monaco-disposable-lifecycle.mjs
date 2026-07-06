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
const textEditorCore = read('src/kits/editor/TextEditorCore.tsx')
const jsFilter = read('src/plugins/jsFilter/index.tsx')

assert(/createMonacoDisposableBucket/.test(helper), 'shared Monaco disposable bucket helper should exist')
assert(/disposeAllMonacoDisposables/.test(helper), 'shared Monaco disposable helper should expose safe bulk disposal')
assert(/disposable\.dispose\(\)/.test(helper), 'shared Monaco disposable helper should dispose tracked subscriptions')

assert(/disposablesRef/.test(textEditorCore), 'TextEditorCore should keep a per-mount Monaco disposable bucket')
assert(/disposablesRef\.current\?\.dispose\(\)/.test(textEditorCore), 'TextEditorCore should dispose the previous/current bucket')
assert(/editorRef\.current\s*=\s*null/.test(textEditorCore), 'TextEditorCore should clear the Monaco editor ref during disposal')
assert(/decorationIdsRef\.current\s*=\s*\[\]/.test(textEditorCore), 'TextEditorCore should clear decoration ids during disposal')
assertTracksAll(textEditorCore, 'TextEditorCore', [
  'editor.onDidFocusEditorText',
  'editor.onDidChangeCursorPosition',
  'editor.onDidChangeCursorSelection',
  'editor.onDidScrollChange',
  'editor.addAction',
  'editor.addAction',
])

const editorSurface = read('src/components/editor/EditorSurface.tsx')

assert(/window\.removeEventListener\('paste', handlePasteCapture, true\)/.test(editorSurface), 'EditorSurface should release paste capture listener')
assert(/window\.removeEventListener\('keydown', handlePasteKeydownCapture, true\)/.test(editorSurface), 'EditorSurface should release paste keydown listener')
assert(/pasteSubscription\.dispose\(\)/.test(editorSurface), 'EditorSurface should dispose the onDidPaste subscription via onReady cleanup')

assert(/editorDisposablesRef/.test(jsFilter), 'jsFilter panel should keep an editor disposable bucket')
assertTracksAll(jsFilter, 'jsFilter panel', [
  'editor.onKeyDown',
  'editor.onDidContentSizeChange',
])
assert(/(?:disposeAllMonacoDisposables|kits\.monacoDisposables\.disposeAll)\(editorDisposablesRef\.current\)/.test(jsFilter), 'jsFilter panel should dispose editor subscriptions on unmount')
assert(/editorRef\.current\s*=\s*null/.test(jsFilter), 'jsFilter panel should clear the Monaco editor ref during disposal')

console.log('Monaco disposable lifecycle checks passed')
