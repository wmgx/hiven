import type { editor as MonacoEditor } from 'monaco-editor'

export interface EditorPosition {
  lineNumber: number
  column: number
}

export interface EditorScrollPosition {
  scrollTop: number
  scrollLeft: number
}

export interface EditorSelectionRange {
  startLineNumber: number
  startColumn: number
  endLineNumber: number
  endColumn: number
}

export interface EditorSelectionInfo {
  selection: EditorSelectionRange | null
  selectedCharCount: number
}

export interface EditorActionSpec {
  id: string
  label: string
  keybindings: number[]
  run: (editor: MonacoEditor.IStandaloneCodeEditor) => void
}

export interface LineDecorationSpec {
  lines: number[]
  className: string
  rulerColor: string
}

/** Character-range decoration (inline / multi-line block, not whole-line wash). */
export interface RangeDecorationSpec {
  ranges: EditorSelectionRange[]
  className: string
  rulerColor: string
}

export interface TextEditorCoreHandle {
  getEditor(): MonacoEditor.IStandaloneCodeEditor | null
  focus(): void
  setCursorPosition(position: EditorPosition): void
  setScrollPosition(position: EditorScrollPosition): void
  openFindReplace(): void
}

export interface TextEditorCoreProps {
  value: string
  language: string
  theme: string
  fontSize: number
  lineNumbers: boolean
  wordWrap: boolean
  stickyScroll?: boolean
  optionOverrides?: MonacoEditor.IStandaloneEditorConstructionOptions
  actions?: EditorActionSpec[]
  lineDecorations?: LineDecorationSpec[]
  rangeDecorations?: RangeDecorationSpec[]
  onChange?: (text: string) => void
  onFocus?: () => void
  onCursorChange?: (position: EditorPosition) => void
  onSelectionChange?: (info: EditorSelectionInfo) => void
  onScrollChange?: (position: EditorScrollPosition) => void
  onReady?: (editor: MonacoEditor.IStandaloneCodeEditor) => (() => void) | void
}
