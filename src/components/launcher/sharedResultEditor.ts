/**
 * The launcher's single, resident Monaco editor for text results.
 *
 * Created once per launcher window (`preloadLauncherResultEditor`) and moved
 * between result wells by DOM reparenting, so showing a result never pays for
 * Monaco startup. Only the text and language change between results.
 */

import type { editor as MonacoEditor } from 'monaco-editor'
import { configureMonacoRuntime, monaco } from '../../kits/editor/monacoRuntime'

const LIGHT_THEME = 'hiven-launcher-result-light'
const DARK_THEME = 'hiven-launcher-result-dark'

type ResultEditor = {
  container: HTMLDivElement
  editor: MonacoEditor.IStandaloneCodeEditor
}

let shared: ResultEditor | null = null
let submitHandler: (() => void) | null = null

/** ⌘↵ target of whichever well currently hosts the editor. */
export function setLauncherResultEditorSubmit(handler: (() => void) | null): void {
  submitHandler = handler
}

function defineThemes() {
  const colors = { 'editor.background': '#00000000', 'editorGutter.background': '#00000000', 'focusBorder': '#00000000' }
  monaco.editor.defineTheme(LIGHT_THEME, { base: 'vs', inherit: true, rules: [], colors })
  monaco.editor.defineTheme(DARK_THEME, { base: 'vs-dark', inherit: true, rules: [], colors })
}

function monoFont(): string {
  return getComputedStyle(document.documentElement).getPropertyValue('--font-mono').trim() || 'monospace'
}

export function getLauncherResultEditor(): ResultEditor {
  if (shared) return shared
  configureMonacoRuntime()
  defineThemes()
  const container = document.createElement('div')
  container.className = 'launcher-result-editor'
  const editor = monaco.editor.create(container, {
    value: '',
    language: 'plaintext',
    theme: LIGHT_THEME,
    automaticLayout: true,
    fontFamily: monoFont(),
    fontSize: 13,
    lineHeight: 20,
    lineNumbers: 'off',
    glyphMargin: false,
    folding: false,
    lineDecorationsWidth: 0,
    lineNumbersMinChars: 0,
    minimap: { enabled: false },
    wordWrap: 'on',
    scrollBeyondLastLine: false,
    renderLineHighlight: 'none',
    overviewRulerLanes: 0,
    hideCursorInOverviewRuler: true,
    overviewRulerBorder: false,
    contextmenu: false,
    fixedOverflowWidgets: true,
    quickSuggestions: false,
    suggestOnTriggerCharacters: false,
    occurrencesHighlight: 'off',
    selectionHighlight: false,
    renderWhitespace: 'none',
    guides: { indentation: false },
    stickyScroll: { enabled: false },
    scrollbar: { alwaysConsumeMouseWheel: false, verticalScrollbarSize: 8, horizontalScrollbarSize: 8 },
  })
  // Monaco owns ⌘↵ (insert line below); take it over for "deliver".
  editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => submitHandler?.())
  shared = { container, editor }
  return shared
}

/** Build the editor ahead of the first result (call once when the launcher window mounts). */
export function preloadLauncherResultEditor(): void {
  getLauncherResultEditor()
}

export function launcherResultEditorTheme(theme: 'dark' | 'light'): string {
  return theme === 'dark' ? DARK_THEME : LIGHT_THEME
}

export function setLauncherResultEditorContent(text: string, language: string): void {
  const { editor } = getLauncherResultEditor()
  const model = editor.getModel()
  if (!model) return
  const known = monaco.languages.getLanguages().some((entry) => entry.id === language)
  const languageId = known ? language : 'plaintext'
  if (model.getLanguageId() !== languageId) monaco.editor.setModelLanguage(model, languageId)
  if (model.getValue() !== text) {
    model.setValue(text)
    editor.setScrollTop(0)
  }
}
