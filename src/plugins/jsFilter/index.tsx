/**
 * First-party JS Filter plugin.
 * Provides a compact pane-bottom bar for evaluating JS expressions against JSON content.
 * The bar is per-pane and toggled via the command.
 */
/* eslint-disable react-refresh/only-export-components */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from '@monaco-editor/react'
import * as monaco from 'monaco-editor'
import { definePlugin, getPluginHostSdk, type PanelPropsV2, type PaneInput } from '@fluxtext/plugin'
import { useWorkspaceStore } from '../../workspace/workspaceStore'

const PLUGIN_ID = 'js-filter'
const PANEL_ID = 'js-filter.panel'
const EDITOR_LINE_HEIGHT = 20
const EDITOR_VERTICAL_PADDING = 10
const EDITOR_MIN_HEIGHT = 32
const EDITOR_MAX_HEIGHT = EDITOR_LINE_HEIGHT * 4 + EDITOR_VERTICAL_PADDING

type CompletionKind = 'field' | 'method'

type CompletionItem = {
  label: string
  insertText: string
  detail: string
  kind: CompletionKind
  snippet?: boolean
  replaceStart?: number
}

type CompletionContext = {
  basePath: string
  partial: string
  replaceStart: number
  dotStart: number
}

const METHOD_COMPLETIONS: CompletionItem[] = [
  { label: '.map()', insertText: '.map(${1:x} => ${2:x})', detail: 'Transform array items', kind: 'method', snippet: true },
  { label: '.filter()', insertText: '.filter(${1:x} => ${2:x})', detail: 'Keep matching array items', kind: 'method', snippet: true },
  { label: '.find()', insertText: '.find(${1:x} => ${2:x})', detail: 'Find first matching item', kind: 'method', snippet: true },
  { label: '.some()', insertText: '.some(${1:x} => ${2:x})', detail: 'Check any item matches', kind: 'method', snippet: true },
  { label: '.every()', insertText: '.every(${1:x} => ${2:x})', detail: 'Check all items match', kind: 'method', snippet: true },
  { label: '.slice()', insertText: '.slice(${1:0})', detail: 'Take a range', kind: 'method', snippet: true },
  { label: '.length', insertText: '.length', detail: 'Read length', kind: 'method' },
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isIdentifier(key: string) {
  return /^[A-Za-z_$][\w$]*$/.test(key)
}

function parseJson(text: string): unknown | null {
  try {
    return JSON.parse(text || '')
  } catch {
    return null
  }
}

function getCompletionContext(beforeCursor: string): CompletionContext | null {
  const partialMatch = beforeCursor.match(/[A-Za-z_$][\w$]*$/)
  const partial = partialMatch?.[0] ?? ''
  const partialStart = partial ? beforeCursor.length - partial.length : beforeCursor.length
  const dotStart = beforeCursor[partialStart - 1] === '.'
    ? partialStart - 1
    : beforeCursor.endsWith('.')
      ? beforeCursor.length - 1
      : -1

  if (dotStart < 0) return null

  return {
    basePath: beforeCursor.slice(0, dotStart),
    partial,
    replaceStart: partialStart,
    dotStart,
  }
}

function readPath(root: unknown, path: string): unknown {
  if (!path) return root

  let current = root
  let index = 0

  while (index < path.length) {
    if (path[index] === '.') {
      index += 1
      const keyMatch = path.slice(index).match(/^[A-Za-z_$][\w$]*/)
      if (!keyMatch) return undefined
      current = readProperty(current, keyMatch[0])
      index += keyMatch[0].length
      continue
    }

    if (path[index] === '[') {
      const end = path.indexOf(']', index)
      if (end < 0) return undefined
      const token = path.slice(index + 1, end).trim()
      const key = parseBracketKey(token)
      if (key === null) return undefined
      current = readProperty(current, key)
      index = end + 1
      continue
    }

    return undefined
  }

  return current
}

function readProperty(value: unknown, key: string | number): unknown {
  if (Array.isArray(value) && typeof key === 'number') return value[key]
  if (isRecord(value) && typeof key === 'string') return value[key]
  return undefined
}

function parseBracketKey(token: string): string | number | null {
  if (/^\d+$/.test(token)) return Number(token)
  if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith("'") && token.endsWith("'"))) {
    try {
      return JSON.parse(token.startsWith("'") ? `"${token.slice(1, -1).replace(/"/g, '\\"')}"` : token)
    } catch {
      return null
    }
  }
  return null
}

function describeValue(value: unknown) {
  if (Array.isArray(value)) return `array(${value.length})`
  if (value === null) return 'null'
  return typeof value
}

function buildCompletionItems(root: unknown | null, context: CompletionContext | null): CompletionItem[] {
  if (!context) return []

  const normalizedPartial = context.partial.toLowerCase()
  const target = root === null ? undefined : readPath(root, context.basePath)
  const fields = isRecord(target)
    ? Object.keys(target)
      .filter((key) => !normalizedPartial || key.toLowerCase().startsWith(normalizedPartial))
      .slice(0, 30)
      .map((key): CompletionItem => ({
        label: key,
        insertText: isIdentifier(key) ? key : `[${JSON.stringify(key)}]`,
        detail: describeValue(target[key]),
        kind: 'field',
        replaceStart: isIdentifier(key) ? context.replaceStart : context.dotStart,
      }))
    : []

  const methods = METHOD_COMPLETIONS
    .filter((item) => {
      const methodName = item.label.slice(1).replace(/\(\)$/, '')
      return !normalizedPartial || methodName.startsWith(normalizedPartial)
    })
    .map((item) => ({ ...item, replaceStart: context.dotStart }))

  return [...fields, ...methods].slice(0, 40)
}

function toMonacoSuggestions(
  model: monaco.editor.ITextModel,
  position: monaco.Position,
  items: CompletionItem[],
): monaco.languages.CompletionItem[] {
  const cursorOffset = model.getOffsetAt(position)

  return items.map((item) => {
    const start = model.getPositionAt(item.replaceStart ?? cursorOffset)
    const range = {
      startLineNumber: start.lineNumber,
      startColumn: start.column,
      endLineNumber: position.lineNumber,
      endColumn: position.column,
    }

    return {
      label: item.label,
      kind: item.kind === 'field'
        ? monaco.languages.CompletionItemKind.Field
        : monaco.languages.CompletionItemKind.Method,
      insertText: item.insertText,
      insertTextRules: item.snippet
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
      detail: item.detail,
      range,
    }
  })
}

function JsFilterPanel({ host }: PanelPropsV2) {
  const { hooks, effects } = getPluginHostSdk()
  const t = hooks.useT(PLUGIN_ID)
  const [expression, setExpression] = useState('')
  const [editorHeight, setEditorHeight] = useState(EDITOR_MIN_HEIGHT)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const parsedJsonRef = useRef<unknown | null>(null)
  const executeRef = useRef<() => void>(() => {})
  const completionDisposableRef = useRef<ReturnType<typeof monaco.languages.registerCompletionItemProvider> | null>(null)

  const activePaneId = useWorkspaceStore((s) => s.activePaneId)
  const paneText = hooks.usePaneText(activePaneId)
  const parsedJson = useMemo(() => parseJson(paneText), [paneText])

  useEffect(() => {
    parsedJsonRef.current = parsedJson
  }, [parsedJson])

  useEffect(() => {
    return () => {
      completionDisposableRef.current?.dispose()
      completionDisposableRef.current = null
    }
  }, [])

  const handleExecute = useCallback(() => {
    const expr = expression.trim()
    if (!expr) return

    // 解析 JSON
    let data: unknown
    try {
      data = JSON.parse(paneText || '')
    } catch {
      host.dispatch([effects.status(t('panel.error.notJson'), 'error')])
      return
    }

    // 执行表达式
    try {
      const fn = new Function(`"use strict"; return (this)${expr}`)
      const result = fn.call(data)
      const output = typeof result === 'string' ? result : JSON.stringify(result, null, 2)
      host.dispatch([effects.replaceActiveText(output)])
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e)
      host.dispatch([effects.status(t('panel.error.expression').replace('{0}', msg), 'error')])
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
            editor.onKeyDown((event) => {
              if (event.keyCode !== monaco.KeyCode.Enter || (!event.ctrlKey && !event.metaKey)) return
              event.preventDefault()
              event.stopPropagation()
              executeRef.current()
            })
            editor.onDidContentSizeChange((event) => {
              setEditorHeight(Math.max(
                EDITOR_MIN_HEIGHT,
                Math.min(EDITOR_MAX_HEIGHT, event.contentHeight),
              ))
            })
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
          theme="vs"
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

export const jsFilterPlugin = definePlugin({
  commands: [
    {
      id: 'js-filter.toggle',
      title: 'command.open.title',
      description: 'command.open.description',
      icon: 'Code2',
      aliases: ['js-filter', 'jq', 'json-filter', 'expression'],
      inputs: [{ key: 'input', label: 'Input', kind: 'pane' as const, required: true }],
      inputResolution: { strategy: 'use-active', fallback: 'fail' },
      run(ctx) {
        const paneId = (ctx.inputs.input as PaneInput).paneId
        // 检查当前 pane 是否已有该面板打开（通过 workspace store 判断）
        const ws = useWorkspaceStore.getState()
        const existing = ws.panelInstancesV2[PANEL_ID]
        if (existing && existing.scope?.type === 'pane' && existing.scope.paneId === paneId) {
          // 已打开，关闭它
          return { effects: [{ type: 'panel.closeV2' as const, panelId: PANEL_ID }] }
        }
        // 未打开或是其他 pane 的，打开给当前 pane
        return {
          effects: [{
            type: 'panel.openV2' as const,
            panelId: PANEL_ID,
            placement: 'pane-bottom' as const,
            scope: { type: 'pane' as const, paneId },
          }],
        }
      },
    },
  ],

  panels: [
    {
      id: PANEL_ID,
      title: 'JS Filter',
      titleI18n: { zh: 'JS 过滤器', en: 'JS Filter' },
      defaultPlacement: 'pane-bottom',
      height: 'auto',
      component: JsFilterPanel,
    },
  ],
})

export default jsFilterPlugin
