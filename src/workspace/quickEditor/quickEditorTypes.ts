export type QuickEditorPaneId = string

export interface QuickEditorPaneState {
  id: QuickEditorPaneId
  text: string
  language: string
  languageSource: 'manual' | 'auto'
  cursorPosition: { lineNumber: number; column: number }
  scrollPosition: { scrollTop: number; scrollLeft: number }
}

export interface QuickEditorState {
  panes: Record<QuickEditorPaneId, QuickEditorPaneState>
  paneOrder: QuickEditorPaneId[]
  activePaneId: QuickEditorPaneId
  splitDirection: 'horizontal' | 'vertical'
  /** 编辑器文本内容 */
  text: string
  /** Monaco 语言标识 */
  language: string
  /** 语言来源：manual = 用户/命令显式设置，auto = 检测或默认 */
  languageSource: 'manual' | 'auto'
  /** 光标位置 */
  cursorPosition: { lineNumber: number; column: number }
  /** 滚动位置 */
  scrollPosition: { scrollTop: number; scrollLeft: number }
}

export interface QuickEditorActions {
  setText: (text: string) => void
  /** Update a specific pane's text; keeps active mirror fields in sync when needed. */
  setPaneText: (paneId: QuickEditorPaneId, text: string) => boolean
  setLanguage: (language: string) => void
  setDetectedLanguage: (language: string) => void
  setCursorPosition: (position: { lineNumber: number; column: number }) => void
  setScrollPosition: (position: { scrollTop: number; scrollLeft: number }) => void
  setActivePaneId: (paneId: QuickEditorPaneId) => void
  createPane: (options?: { direction?: 'right' | 'bottom'; text?: string; language?: string }) => QuickEditorPaneId
  closePane: (paneId: QuickEditorPaneId) => boolean
  closeActivePane: () => boolean
  focusNextPane: () => void
  focusPreviousPane: () => void
  reset: () => void
}

export type QuickEditorStore = QuickEditorState & QuickEditorActions
