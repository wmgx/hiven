import type { ReactNode } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import type {
  EditorActionSpec,
  EditorPosition,
  EditorScrollPosition,
  EditorSelectionRange,
} from '../../kits/editor/types'

export interface EditorTextBinding {
  text: string
  language: string
  languageSource?: 'manual' | 'auto'
  onTextChange: (text: string) => void
  onSelectionChange?: (selection: EditorSelectionRange | null) => void
  onDetectedLanguage?: (language: string) => void
  initialCursor?: EditorPosition
  initialScroll?: EditorScrollPosition
  onCursorChange?: (position: EditorPosition) => void
  onScrollChange?: (position: EditorScrollPosition) => void
}

export interface EditorSurfaceProps {
  binding: EditorTextBinding
  statusBarLeading?: ReactNode
  statusBarTrailing?: ReactNode
  actions?: EditorActionSpec[]
  overlay?: ReactNode
  bottomPanels?: ReactNode
  autoFocus?: boolean
  stickyScroll?: boolean
  onFocus?: () => void
  onReady?: (editor: MonacoEditor.IStandaloneCodeEditor) => (() => void) | void
}
