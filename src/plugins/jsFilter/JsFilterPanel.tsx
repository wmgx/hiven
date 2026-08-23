import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { getPluginHostSdk, type MonacoDisposable, type PanelPropsV2 } from '@hiven/plugin'
import { buildCompletionItems, getCompletionContext, parseJson, toMonacoSuggestions } from './completionHelpers'

const PLUGIN_ID = 'js-filter'
const EDITOR_LINE_HEIGHT = 20
const EDITOR_VERTICAL_PADDING = 10
const EDITOR_MIN_HEIGHT = 32
const EDITOR_MAX_HEIGHT = EDITOR_LINE_HEIGHT * 4 + EDITOR_VERTICAL_PADDING

export default function JsFilterPanel({ host, paneId }: PanelPropsV2) {
  const { hooks, effects, kits } = getPluginHostSdk()
  const t = hooks.useT(PLUGIN_ID)
  const settings = hooks.useSettings()
  const [expression, setExpression] = useState('')
  const [editorHeight, setEditorHeight] = useState(EDITOR_MIN_HEIGHT)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const editorDisposablesRef = useRef<MonacoDisposable[]>([])
  const parsedJsonRef = useRef<unknown | null>(null)
  const executeRef = useRef<() => void>(() => {})
  const completionDisposableRef = useRef<ReturnType<typeof monaco.languages.registerCompletionItemProvider> | null>(null)

  const paneText = hooks.usePaneText(paneId ?? '') ?? ''
  const parsedJson = useMemo(() => parseJson(paneText), [paneText])

  useEffect(() => {
    parsedJsonRef.current = parsedJson
  }, [parsedJson])

  useEffect(() => () => {
    kits.monacoDisposables.disposeAll(editorDisposablesRef.current)
    editorRef.current = null
    completionDisposableRef.current?.dispose()
    completionDisposableRef.current = null
  }, [kits.monacoDisposables])

  const handleExecute = useCallback(() => {
    const expr = expression.trim()
    if (!expr) return

    let data: unknown
    try {
      data = JSON.parse(paneText || '')
    } catch {
      host.dispatch([effects.status(t('panel.error.notJson'), 'error')])
      return
    }

    try {
      const body = `"use strict"; return (this)${expr}`
      const fn = new Function(body)
      const result = fn.call(data)
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      host.dispatch([effects.replaceActiveText(output)])
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error)
      host.dispatch([effects.status(t('panel.error.expression').replace('{0}', message), 'error')])
    }
  }, [effects, expression, host, paneText, t])

  useEffect(() => {
    executeRef.current = handleExecute
  }, [handleExecute])

  return (
    <div
      className="flex items-center px-2 gap-2"
      style={{ background: 'var(--color-background-secondary)', minHeight: editorHeight }}
    >
      <span
        className="shrink-0 select-none"
        style={{ color: 'var(--color-text-tertiary)', fontSize: 12, fontFamily: 'var(--font-mono)' }}
      >
        this
      </span>
      <div style={{ width: 1, height: 16, background: 'var(--color-border-secondary)', flexShrink: 0 }} />
      <div className="flex-1 min-w-0" style={{ position: 'relative', height: editorHeight }}>
        {expression.length === 0 && (
          <span
            style={{
              position: 'absolute',
              left: 8,
              top: 7,
              zIndex: 1,
              pointerEvents: 'none',
              color: 'var(--color-text-tertiary)',
              fontSize: 12,
              fontFamily: 'var(--font-mono)',
            }}
          >
            {t('panel.placeholder')}
          </span>
        )}
        <Editor
          height={editorHeight}
          defaultLanguage="javascript"
          defaultValue={expression}
          path="js-filter://expression.js"
          onChange={(value) => setExpression(value ?? '')}
          onMount={(editor) => {
            kits.monacoDisposables.disposeAll(editorDisposablesRef.current)
            const disposables = kits.monacoDisposables.createBucket()
            editorDisposablesRef.current = [disposables]
            editorRef.current = editor
            completionDisposableRef.current?.dispose()
            completionDisposableRef.current = monaco.languages.registerCompletionItemProvider('javascript', {
              triggerCharacters: ['.'],
              provideCompletionItems(model, position) {
                if (!model.uri.toString().startsWith('js-filter://')) {
                  return { suggestions: [] }
                }
                const beforeCursor = model.getValueInRange({
                  startLineNumber: 1,
                  startColumn: 1,
                  endLineNumber: position.lineNumber,
                  endColumn: position.column,
                })
                const context = getCompletionContext(beforeCursor)
                const items = buildCompletionItems(parsedJsonRef.current, context)
                return { suggestions: toMonacoSuggestions(model, position, items) }
              },
            })
            disposables.add(editor.onKeyDown((event) => {
              if (event.keyCode !== monaco.KeyCode.Enter || (!event.ctrlKey && !event.metaKey)) return
              event.preventDefault()
              event.stopPropagation()
              executeRef.current()
            }))
            disposables.add(editor.onDidContentSizeChange((event) => {
              setEditorHeight(Math.max(
                EDITOR_MIN_HEIGHT,
                Math.min(EDITOR_MAX_HEIGHT, event.contentHeight),
              ))
            }))
            disposables.add(editor.onDidDispose(() => {
              if (editorRef.current === editor) editorRef.current = null
              disposables.dispose()
            }))
          }}
          options={{
            fontSize: 12,
            lineHeight: EDITOR_LINE_HEIGHT,
            fontFamily: 'var(--font-mono)',
            lineNumbers: 'off',
            minimap: { enabled: false },
            folding: false,
            glyphMargin: false,
            lineDecorationsWidth: 0,
            lineNumbersMinChars: 0,
            overviewRulerLanes: 0,
            overviewRulerBorder: false,
            renderLineHighlight: 'none',
            scrollBeyondLastLine: false,
            scrollbar: { vertical: 'auto', horizontal: 'hidden' },
            padding: { top: 5 },
            wordWrap: 'on',
            automaticLayout: true,
            fixedOverflowWidgets: true,
            quickSuggestions: true,
            suggestOnTriggerCharacters: true,
            snippetSuggestions: 'top',
            wordBasedSuggestions: 'off',
            tabCompletion: 'on',
            contextmenu: false,
          }}
          theme={settings.theme === 'dark' ? 'vs-dark' : 'vs'}
        />
      </div>
      <button
        onClick={handleExecute}
        className="shrink-0"
        style={{
          padding: '2px 10px',
          fontSize: 11,
          borderRadius: 4,
          border: '1px solid var(--color-border-secondary)',
          background: 'var(--color-background-primary)',
          color: 'var(--color-text-secondary)',
          cursor: 'pointer',
        }}
      >
        {t('panel.execute')}
      </button>
      <button
        onClick={() => host.close()}
        className="shrink-0 flex items-center justify-center"
        style={{
          width: 18,
          height: 18,
          borderRadius: 3,
          border: 'none',
          background: 'transparent',
          color: 'var(--color-text-tertiary)',
          cursor: 'pointer',
          fontSize: 14,
          lineHeight: 1,
        }}
        title="Close"
      >
        ×
      </button>
    </div>
  )
}
