import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

/**
 * Deliberately strict: the previous version returned '' for a missing file, which
 * made every "must NOT contain" assertion below pass vacuously. PaneEditor was
 * deleted in the workbench retirement and this file kept reporting green on it.
 */
function read(path) {
  const absolute = join(root, path)
  if (!existsSync(absolute)) throw new Error(`${path} no longer exists — repoint or drop the assertions that read it`)
  return readFileSync(absolute, 'utf8')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const coreTypes = read('src/kits/editor/types.ts')
const core = read('src/kits/editor/TextEditorCore.tsx')
const surface = read('src/components/editor/EditorSurface.tsx')
const statusBar = read('src/components/editor/EditorStatusBar.tsx')
const quickPanel = read('src/components/quickEditor/QuickEditorPanel.tsx')
const dualEditor = read('src/kits/ui/DualEditorView.tsx')

// 1. kit primitive exists and does not depend on framework.
assert(coreTypes.length > 0, 'kits/editor/types.ts should exist')
assert(core.length > 0, 'kits/editor/TextEditorCore.tsx should exist')
for (const [label, text] of [['types', coreTypes], ['TextEditorCore', core]]) {
  assert(!/from '.*\/(workspace|components|store|i18n|plugins)\//.test(text) &&
    !/from '\.\.\/\.\.\/(workspace|components|store|i18n|plugins)'/.test(text),
    `kits/editor ${label} must not import framework modules`)
}

// 2. core owns the unified baseline.
assert(/tabSize:\s*2/.test(core), 'TextEditorCore should own the unified tabSize baseline')
assert(/automaticLayout:\s*true/.test(core), 'TextEditorCore should own automaticLayout baseline')
// `left` left the padding object: horizontal room is now derived from
// lineDecorationsWidth so the gutter stays consistent with and without folding.
assert(/padding:\s*\{\s*top:\s*12,\s*bottom:\s*12\s*\}/.test(core),
  'TextEditorCore should own the unified padding baseline')
assert(/const\s+lineDecorationsWidth\s*=\s*foldingEnabled\s*\?\s*8\s*:\s*24/.test(core),
  'TextEditorCore should own the unified gutter width baseline')
assert(/executeEdits\('external'/.test(core), 'TextEditorCore should own the external value sync')
assert(/startFindReplaceAction/.test(core), 'TextEditorCore should own the find-replace override')

// 3. EditorSurface = core + status bar + shared behavior.
assert(/<TextEditorCore/.test(surface), 'EditorSurface should render TextEditorCore')
assert(/<EditorStatusBar/.test(surface), 'EditorSurface should render EditorStatusBar')
assert(/detectEditorLanguage/.test(surface), 'EditorSurface should own shared paste language detection')
assert(/useT\('editor'\)/.test(statusBar), 'EditorStatusBar should use editor i18n namespace')

// 4. Hosts no longer mount Monaco directly.
for (const [label, text] of [
  ['QuickEditorPanel', quickPanel],
  ['DualEditorView', dualEditor],
]) {
  assert(!text.includes('@monaco-editor/react'),
    `${label} must not mount @monaco-editor/react directly anymore`)
  assert(!/executeEdits\('external'/.test(text),
    `${label} must not re-implement external text sync`)
}
assert(/<EditorSurface/.test(quickPanel), 'QuickEditorPanel should render EditorSurface')
assert(/<TextEditorCore/.test(dualEditor), 'DualEditorView should compose TextEditorCore')

console.log('editor primitive boundary checks passed')
