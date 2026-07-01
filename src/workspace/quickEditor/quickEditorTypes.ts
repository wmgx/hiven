export interface QuickEditorState {
  /** 编辑器文本内容 */
  text: string
  /** Monaco 语言标识 */
  language: string
  /** 光标位置 */
  cursorPosition: { lineNumber: number; column: number }
  /** 滚动位置 */
  scrollPosition: { scrollTop: number; scrollLeft: number }
}

export interface QuickEditorActions {
  setText: (text: string) => void
  setLanguage: (language: string) => void
  setCursorPosition: (position: { lineNumber: number; column: number }) => void
  setScrollPosition: (position: { scrollTop: number; scrollLeft: number }) => void
  reset: () => void
}

export type QuickEditorStore = QuickEditorState & QuickEditorActions
