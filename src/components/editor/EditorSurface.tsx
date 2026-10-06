import { useCallback, useEffect, useRef, useState } from 'react'
import type { editor as MonacoEditor } from 'monaco-editor'
import { useAppStore } from '../../store'
import { useT } from '../../i18n'
import { TextEditorCore } from '../../kits/editor/TextEditorCore'
import type { TextEditorCoreHandle } from '../../kits/editor/types'
import { getFluxMonacoTheme } from '../../utils/monacoTheme'
import { detectEditorLanguage } from '../../workspace/languageDetector'
import { getLanguageOptionLabel } from '../../workspace/languageOptions'
import { EditorStatusBar } from './EditorStatusBar'
import type { EditorSurfaceProps } from './editorSurfaceTypes'

export function EditorSurface({
  binding,
  statusBarLeading,
  statusBarTrailing,
  actions,
  overlay,
  bottomPanels,
  autoFocus = false,
  stickyScroll = false,
  onFocus,
  onReady,
}: EditorSurfaceProps) {
  const settings = useAppStore((s) => s.settings)
  const locale = useAppStore((s) => s.locale)
  const t = useT('editor')
  const coreRef = useRef<TextEditorCoreHandle | null>(null)
  const [cursorInfo, setCursorInfo] = useState({ line: 1, col: 1 })
  const [selectedCharCount, setSelectedCharCount] = useState(0)
  const [editorReady, setEditorReady] = useState(false)
  const pasteDetectionRef = useRef<{ shouldDetect: boolean } | null>(null)
  const bindingRef = useRef(binding)
  bindingRef.current = binding
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  const languageLabel = getLanguageOptionLabel(binding.language, locale)
  const languageStatus = (binding.languageSource ?? 'auto') === 'manual'
    ? languageLabel
    : `${languageLabel} · ${t('autoLanguage')}`

  const rememberPasteDetection = useCallback(() => {
    const editor = coreRef.current?.getEditor()
    if (!editor || !editor.hasTextFocus()) return
    const model = editor.getModel()
    if (!model) {
      pasteDetectionRef.current = null
      return
    }
    const text = model.getValue()
    const fullRange = model.getFullModelRange()
    const selections = editor.getSelections() ?? []
    const hasFullSelection = selections.some((selection) => (
      selection.startLineNumber === fullRange.startLineNumber &&
      selection.startColumn === fullRange.startColumn &&
      selection.endLineNumber === fullRange.endLineNumber &&
      selection.endColumn === fullRange.endColumn
    ))
    pasteDetectionRef.current = {
      shouldDetect: text.trim().length === 0 || hasFullSelection,
    }
  }, [])

  useEffect(() => {
    const handlePasteCapture = () => rememberPasteDetection()
    const handlePasteKeydownCapture = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'v') {
        rememberPasteDetection()
      }
    }
    window.addEventListener('paste', handlePasteCapture, true)
    window.addEventListener('keydown', handlePasteKeydownCapture, true)
    return () => {
      window.removeEventListener('paste', handlePasteCapture, true)
      window.removeEventListener('keydown', handlePasteKeydownCapture, true)
    }
  }, [rememberPasteDetection])

  const handleReady = useCallback((editor: MonacoEditor.IStandaloneCodeEditor) => {
    setEditorReady(true)
    const initial = bindingRef.current
    if (initial.initialCursor) editor.setPosition(initial.initialCursor)
    if (initial.initialScroll) editor.setScrollPosition(initial.initialScroll)
    if (autoFocus) editor.focus()
    const pasteSubscription = editor.onDidPaste(() => {
      const detection = pasteDetectionRef.current
      pasteDetectionRef.current = null
      if (!detection?.shouldDetect) return
      window.setTimeout(() => {
        const model = editor.getModel()
        const text = model?.getValue() ?? ''
        const current = bindingRef.current
        if ((current.languageSource ?? 'auto') === 'manual' || text.trim().length === 0) return
        current.onDetectedLanguage?.(
          detectEditorLanguage(text, { allowShortStrongSignals: true }),
        )
      }, 0)
    })
    const hostCleanup = onReadyRef.current?.(editor)
    return () => {
      pasteSubscription.dispose()
      if (typeof hostCleanup === 'function') hostCleanup()
    }
  }, [autoFocus])

  return (
    <div className="relative flex flex-col h-full overflow-hidden">
      <div className="relative flex-1 min-h-0" aria-busy={!editorReady}>
        <TextEditorCore
          ref={coreRef}
          value={binding.text}
          language={binding.language}
          theme={getFluxMonacoTheme(settings.theme)}
          fontSize={settings.fontSize}
          lineNumbers={settings.lineNumbers}
          wordWrap={settings.wordWrap}
          stickyScroll={stickyScroll}
          actions={actions}
          onChange={(text) => bindingRef.current.onTextChange(text)}
          onFocus={onFocus}
          onCursorChange={(position) => {
            setCursorInfo({ line: position.lineNumber, col: position.column })
            bindingRef.current.onCursorChange?.(position)
          }}
          onSelectionChange={(info) => {
            setSelectedCharCount(info.selectedCharCount)
            bindingRef.current.onSelectionChange?.(info.selection)
          }}
          onScrollChange={(position) => bindingRef.current.onScrollChange?.(position)}
          onReady={handleReady}
        />
        {!editorReady && (
          <div className="absolute inset-0 z-10 flex items-center justify-center gap-2 text-[12px]" role="status" style={{ background: 'var(--color-background-primary)', color: 'var(--color-text-secondary)' }}>
            <div className="plugin-surface-window-message__indicator" />
            {t('loading')}
          </div>
        )}
      </div>
      {bottomPanels}
      <EditorStatusBar
        cursor={cursorInfo}
        lineCount={binding.text.split('\n').length}
        charCount={binding.text.length}
        selectedCharCount={selectedCharCount}
        languageStatus={languageStatus}
        leading={statusBarLeading}
        trailing={statusBarTrailing}
      />
      {overlay}
    </div>
  )
}
