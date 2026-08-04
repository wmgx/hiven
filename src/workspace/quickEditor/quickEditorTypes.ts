export type QuickEditorPaneId = string

export interface QuickEditorPaneState {
  id: QuickEditorPaneId
  text: string
  language: string
  languageSource: 'manual' | 'auto'
  cursorPosition: { lineNumber: number; column: number }
  scrollPosition: { scrollTop: number; scrollLeft: number }
}

/**
 * One archived pane state created only by external overwrite
 * (Object Block / tool result → Quick Editor). User typing never appends entries.
 */
export type QuickEditorExternalVersion = {
  id: string
  paneId: QuickEditorPaneId
  text: string
  language: string
  languageSource: 'manual' | 'auto'
  at: number
  /**
   * What triggered the overwrite that archived this content
   * (e.g. clipboard, tool-result, history-item).
   */
  source?: string
  /** Short list preview (first line / truncated). */
  preview: string
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
  /**
   * External-overwrite version history (newest first).
   * Only written by overwriteActiveText — never by setText / setPaneText.
   */
  externalVersionHistory: QuickEditorExternalVersion[]
}

export type QuickEditorOverwriteOptions = {
  language?: string
  source?: string
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
  /**
   * Replace active pane via external source: archive current content into
   * externalVersionHistory (if non-empty), then write the new text.
   * Does not record user typing paths (setText / setPaneText).
   */
  overwriteActiveText: (text: string, options?: QuickEditorOverwriteOptions) => QuickEditorPaneId
  /** Load an archived external version into the active pane (no new history entry). */
  restoreExternalVersion: (versionId: string) => boolean
  clearExternalVersionHistory: () => void
  /** Apply a remote overwrite (detached window sync) including history. */
  applyOverwriteFromRemote: (input: {
    paneId: QuickEditorPaneId
    text: string
    language?: string
    languageSource?: 'manual' | 'auto'
    externalVersionHistory?: QuickEditorExternalVersion[]
  }) => boolean
  reset: () => void
}

export type QuickEditorStore = QuickEditorState & QuickEditorActions
