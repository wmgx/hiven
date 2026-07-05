import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()

function read(path) {
  return readFileSync(join(root, path), 'utf8')
}

function readI18n() {
  const dir = join(root, 'src/i18n/locales')
  return readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => readFileSync(join(dir, f), 'utf8')).join('\n')
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const workspaceShell = read('src/components/workspace/WorkspaceShell.tsx')
const textEditorCore = read('src/kits/editor/TextEditorCore.tsx')
const editorStatusBar = read('src/components/editor/EditorStatusBar.tsx')
const pluginInputResolver = read('src/workspace/pluginInputResolver.ts')
const i18n = readI18n()

assert(
  /onPointerDownCapture=\{\(\)\s*=>\s*setActivePaneId\(paneId\)\}/.test(workspaceShell),
  'WorkspaceShell should mark the clicked pane active before pane-local controls run',
)

assert(
  /onDidChangeCursorSelection/.test(textEditorCore),
  'Editor primitive should subscribe to Monaco selection changes',
)

assert(
  /getValueLengthInRange/.test(textEditorCore),
  'Editor primitive should compute selected character count from the current Monaco model selection',
)

assert(
  /selectedCharCount\s*>\s*0/.test(editorStatusBar) &&
  /t\(['"`]selectedChars['"`]\)/.test(editorStatusBar),
  'Editor status bar should render selected character count when a selection exists',
)

assert(
  /['"`]selectedChars['"`]\s*:/.test(i18n),
  'i18n should include a selected character count label',
)

assert(
  /activePaneIndex[\s\S]*otherPaneId[\s\S]*paneSlots\[0\]\.key[\s\S]*firstPaneId[\s\S]*paneSlots\[1\]\.key[\s\S]*otherPaneId/.test(pluginInputResolver),
  'Plugin input resolver should use active pane plus the other pane when exactly two panes are open',
)

console.log('pane active selection status checks passed')
