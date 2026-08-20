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

/**
 * Selected-character-count reporting in the editor status bar.
 *
 * The WorkspaceShell active-pane assertion and the two-pane input-resolver one
 * went away with the main workbench; what remains — Monaco selection
 * subscription, the count itself, its status-bar rendering and i18n label — is
 * live behavior in EditorSurface.
 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

const textEditorCore = read('src/kits/editor/TextEditorCore.tsx')
const editorStatusBar = read('src/components/editor/EditorStatusBar.tsx')
const i18n = readI18n()


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


console.log('pane active selection status checks passed')
