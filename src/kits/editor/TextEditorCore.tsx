/**
 * Monaco assembly primitive. Owns editor mounting, theme registration, hover
 * overlay, disposable lifecycle, external value sync, and the harmonized
 * baseline options. Pure UI kit: no framework imports, no global state.
 * Hosts own all product semantics (stores, hotkey products, status bars).
 */

import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import type { editor as MonacoEditor } from 'monaco-editor'
import { createMonacoDisposableBucket } from '../../utils/monacoDisposables'
import { registerFluxMonacoThemes } from '../../utils/monacoTheme'
import { installMonacoHoverOverlay } from '../../utils/monacoHoverOverlay'
import type { TextEditorCoreHandle, TextEditorCoreProps } from './types'

export const TextEditorCore = forwardRef<TextEditorCoreHandle, TextEditorCoreProps>(
  function TextEditorCore(props, ref) {
    const {
      value,
      language,
      theme,
      fontSize,
      lineNumbers,
      wordWrap,
      stickyScroll = false,
      optionOverrides,
      lineDecorations,
      rangeDecorations,
    } = props

    const editorRef = useRef<MonacoEditor.IStandaloneCodeEditor | null>(null)
    const disposablesRef = useRef<ReturnType<typeof createMonacoDisposableBucket> | null>(null)
    const onReadyCleanupRef = useRef<(() => void) | null>(null)
    const decorationIdsRef = useRef<string[]>([])
    const isLocalChange = useRef(false)
    const propsRef = useRef(props)
    propsRef.current = props

    const foldingEnabled = language !== 'plaintext'
    // Monaco adds 16px for folding controls, so plaintext editors reserve it manually.
    const lineDecorationsWidth = foldingEnabled ? 8 : 24

    useImperativeHandle(ref, () => ({
      getEditor: () => editorRef.current,
      focus: () => editorRef.current?.focus(),
      setCursorPosition: (position) => editorRef.current?.setPosition(position),
      setScrollPosition: (position) => editorRef.current?.setScrollPosition(position),
      openFindReplace: () => {
        editorRef.current?.getAction('editor.action.startFindReplaceAction')?.run()
      },
    }), [])

    const applyDecorationsTo = (editor: MonacoEditor.IStandaloneCodeEditor) => {
      const lineSpecs = propsRef.current.lineDecorations
      const rangeSpecs = propsRef.current.rangeDecorations
      const lineDecorations = (lineSpecs ?? []).flatMap((spec) => spec.lines.map((line) => ({
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: {
          isWholeLine: true,
          className: spec.className,
          overviewRuler: { color: spec.rulerColor, position: 7 },
        },
      })))
      const rangeDecorations = (rangeSpecs ?? []).flatMap((spec) => spec.ranges.map((range) => ({
        range: {
          startLineNumber: range.startLineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.endLineNumber,
          endColumn: range.endColumn,
        },
        options: {
          isWholeLine: false,
          className: spec.className,
          overviewRuler: { color: spec.rulerColor, position: 7 },
        },
      })))
      decorationIdsRef.current = editor.deltaDecorations(
        decorationIdsRef.current,
        [...lineDecorations, ...rangeDecorations],
      )
    }

    // Sync external value changes without resetting cursor. Local edits are
    // only swallowed when the model already matches the incoming value.
    useEffect(() => {
      const editor = editorRef.current
      if (!editor) return
      const model = editor.getModel()
      if (isLocalChange.current) {
        isLocalChange.current = false
        if (model?.getValue() === value) return
      }
      if (model && model.getValue() !== value) {
        const fullRange = model.getFullModelRange()
        editor.executeEdits('external', [{
          range: fullRange,
          text: value,
          forceMoveMarkers: false,
        }])
      }
    }, [value])

    useEffect(() => {
      const editor = editorRef.current
      const model = editor?.getModel()
      if (!editor || !model) return
      if (model.getLanguageId() !== language) {
        monaco.editor.setModelLanguage(model, language)
      }
      editor.updateOptions({
        folding: foldingEnabled,
        foldingStrategy: foldingEnabled ? 'auto' : undefined,
        showFoldingControls: foldingEnabled ? 'mouseover' : 'never',
        lineDecorationsWidth,
        stickyScroll: { enabled: stickyScroll },
      })
    }, [language, foldingEnabled, lineDecorationsWidth, stickyScroll])

    useEffect(() => {
      const editor = editorRef.current
      if (!editor) return
      applyDecorationsTo(editor)
    }, [lineDecorations, rangeDecorations])

    useEffect(() => {
      return () => {
        const editor = editorRef.current
        if (editor && decorationIdsRef.current.length > 0) {
          try {
            editor.deltaDecorations(decorationIdsRef.current, [])
          } catch {
            // Editor may already be disposed during teardown.
          }
        }
        decorationIdsRef.current = []
        onReadyCleanupRef.current?.()
        onReadyCleanupRef.current = null
        disposablesRef.current?.dispose()
        disposablesRef.current = null
        editorRef.current = null
      }
    }, [])

    return (
      <Editor
        height="100%"
        defaultValue={value}
        defaultLanguage={language}
        language={language}
        beforeMount={registerFluxMonacoThemes}
        onChange={(v) => {
          isLocalChange.current = true
          propsRef.current.onChange?.(v ?? '')
        }}
        onMount={(editor) => {
          registerFluxMonacoThemes(monaco)
          onReadyCleanupRef.current?.()
          onReadyCleanupRef.current = null
          disposablesRef.current?.dispose()
          const disposables = createMonacoDisposableBucket()
          disposablesRef.current = disposables
          installMonacoHoverOverlay(editor)
          editorRef.current = editor
          decorationIdsRef.current = []

          disposables.add(editor.onDidFocusEditorText(() => {
            propsRef.current.onFocus?.()
          }))
          disposables.add(editor.onDidChangeCursorPosition((e) => {
            propsRef.current.onCursorChange?.({
              lineNumber: e.position.lineNumber,
              column: e.position.column,
            })
          }))
          disposables.add(editor.onDidChangeCursorSelection(() => {
            const model = editor.getModel()
            const selections = editor.getSelections() ?? []
            const selectedCharCount = model
              ? selections.reduce((total, selection) => (
                selection.isEmpty() ? total : total + model.getValueLengthInRange(selection)
              ), 0)
              : 0
            const selection = editor.getSelection()
            propsRef.current.onSelectionChange?.({
              selection: selection && !selection.isEmpty()
                ? {
                    startLineNumber: selection.startLineNumber,
                    startColumn: selection.startColumn,
                    endLineNumber: selection.endLineNumber,
                    endColumn: selection.endColumn,
                  }
                : null,
              selectedCharCount,
            })
          }))
          disposables.add(editor.onDidScrollChange((e) => {
            propsRef.current.onScrollChange?.({
              scrollTop: e.scrollTop,
              scrollLeft: e.scrollLeft,
            })
          }))
          disposables.add(editor.addAction({
            id: 'find-and-replace',
            label: 'Find and Replace',
            keybindings: [
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyF,
              monaco.KeyMod.CtrlCmd | monaco.KeyMod.Alt | monaco.KeyCode.KeyF,
              monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyH,
            ],
            run: (ed) => {
              ed.getAction('editor.action.startFindReplaceAction')?.run()
            },
          }))
          // Host actions are registered once at mount; `run` stays fresh via
          // propsRef lookup, keybindings/ids are fixed for the editor lifetime.
          for (const action of propsRef.current.actions ?? []) {
            disposables.add(editor.addAction({
              id: action.id,
              label: action.label,
              keybindings: action.keybindings,
              run: (ed) => {
                const current = (propsRef.current.actions ?? [])
                  .find((candidate) => candidate.id === action.id)
                current?.run(ed as MonacoEditor.IStandaloneCodeEditor)
              },
            }))
          }
          applyDecorationsTo(editor)
          const cleanup = propsRef.current.onReady?.(editor)
          if (typeof cleanup === 'function') {
            onReadyCleanupRef.current = cleanup
          }
          disposables.add(editor.onDidDispose(() => {
            onReadyCleanupRef.current?.()
            onReadyCleanupRef.current = null
            if (editorRef.current === editor) editorRef.current = null
            if (disposablesRef.current === disposables) disposablesRef.current = null
            disposables.dispose()
          }))
        }}
        options={{
          fontSize,
          lineNumbers: lineNumbers ? 'on' : 'off',
          wordWrap: wordWrap ? 'on' : 'off',
          minimap: { enabled: false },
          find: { addExtraSpaceOnTop: false },
          scrollBeyondLastLine: false,
          renderLineHighlight: 'line',
          overviewRulerLanes: 0,
          hideCursorInOverviewRuler: true,
          folding: foldingEnabled,
          foldingStrategy: foldingEnabled ? 'auto' : undefined,
          showFoldingControls: foldingEnabled ? 'mouseover' : 'never',
          stickyScroll: { enabled: stickyScroll },
          glyphMargin: false,
          lineDecorationsWidth,
          lineNumbersMinChars: 3,
          padding: { top: 12, bottom: 12, left: 8 },
          fontFamily: 'var(--font-mono)',
          automaticLayout: true,
          tabSize: 2,
          ...optionOverrides,
        }}
        theme={theme}
      />
    )
  },
)
