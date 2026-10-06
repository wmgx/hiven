import { Suspense, useMemo, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, Checkbox, IconButton, SegmentedControl, TextEditor, TextInput, getEditorTheme, useImeKeyboard } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { operationRoutes } from './routes'
import {
  isQueryString,
  processJson,
  type JsonOperation,
  type JsonProcessResult,
} from './jsonCore'

type OperationOption = {
  value: JsonOperation
  title: string
  group: string
}

type ExpressionRun = {
  signature: string
  result: JsonProcessResult
}

export function JsonSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const initialText = props.initialText ?? ''
  const [inputText, setInputText] = useState(initialText)
  const [operation, setOperation] = useState<JsonOperation>(() => operationRoutes.find((route) => route.id === props.surfaceId)?.id
    ?? (isQueryString(initialText) ? 'query-to-json' : 'format'))
  const [indent, setIndent] = useState(2)
  const [shouldSort, setShouldSort] = useState(false)
  const [expression, setExpression] = useState('')
  const [expressionRun, setExpressionRun] = useState<ExpressionRun | null>(null)
  const expressionIme = useImeKeyboard()

  const operations = useMemo<OperationOption[]>(() => [
    { value: 'format', title: t('operation.format'), group: 'json' },
    { value: 'compact', title: t('operation.compact'), group: 'json' },
    { value: 'sort', title: t('operation.sort'), group: 'json' },
    { value: 'expression', title: t('operation.expression'), group: 'json' },
    { value: 'yaml-to-json', title: t('operation.yamlToJson'), group: 'yaml' },
    { value: 'json-to-yaml', title: t('operation.jsonToYaml'), group: 'yaml' },
    { value: 'query-to-json', title: t('operation.queryToJson'), group: 'query' },
    { value: 'json-to-query', title: t('operation.jsonToQuery'), group: 'query' },
    { value: 'escape', title: t('operation.escape'), group: 'string' },
    { value: 'unescape', title: t('operation.unescape'), group: 'string' },
  ], [t])
  const activeGroup = operations.find((item) => item.value === operation)!.group
  const expressionSignature = `${inputText}\u0000${expression}`
  const liveResult = useMemo(() => operation === 'expression'
    ? null
    : processJson(inputText, { operation, indent, sortKeys: shouldSort }), [indent, inputText, operation, shouldSort])
  const result = operation === 'expression'
    ? expressionRun?.signature === expressionSignature ? expressionRun.result : null
    : liveResult
  const outputText = result?.ok ? result.output : ''
  const hasOutput = Boolean(result?.ok && inputText.length > 0)
  const outputLanguage = useMemo(() => {
    if (operation === 'json-to-yaml') return 'yaml'
    try {
      JSON.parse(outputText)
      return 'json'
    } catch {
      return 'plaintext'
    }
  }, [operation, outputText])
  const editorAppearance = {
    theme: getEditorTheme(props.appearance.theme),
    fontSize: props.appearance.fontSize,
    lineNumbers: props.appearance.lineNumbers,
    wordWrap: props.appearance.wordWrap,
  }
  const editorLoading = <div className="jt-editor-loading" role="status">{t('surface.editorLoading')}</div>

  const useOutputAsInput = () => {
    const reverse: Partial<Record<JsonOperation, JsonOperation>> = {
      'yaml-to-json': 'json-to-yaml', 'json-to-yaml': 'yaml-to-json',
      'query-to-json': 'json-to-query', 'json-to-query': 'query-to-json',
      escape: 'unescape', unescape: 'escape',
    }
    setInputText(outputText)
    setOperation(reverse[operation] ?? operation)
  }

  const runExpression = () => {
    if (!inputText.trim() || !expression.trim()) return
    setExpressionRun({
      signature: expressionSignature,
      result: processJson(inputText, { operation: 'expression', expression }),
    })
  }

  const copyOutput = async () => {
    if (!hasOutput) return
    try {
      await host.clipboard.writeText(outputText)
      host.showMessage(t('toast.copied'), 'success')
      host.complete()
    } catch {
      host.showMessage(t('toast.copyFailed'), 'error')
    }
  }

  return (
    <section className="jt-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="jt-header">
        <IconButton type="button" label={t('action.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong className="jt-title">{t('surface.title')}</strong>
        <nav className="jt-groups" aria-label={t('group.label')}>
          {['json', 'yaml', 'query', 'string'].map((group) => (
            <button
              key={group}
              type="button"
              className={`jt-operation ${group === activeGroup ? 'is-active' : ''}`}
              aria-pressed={group === activeGroup}
              onClick={() => setOperation(operations.find((item) => item.group === group)!.value)}
            >
              {t(`group.${group}`)}
            </button>
          ))}
        </nav>
        <IconButton type="button" label={t('action.close')} onClick={() => host.close()}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>
      <nav className="jt-operations" aria-label={t('operation.label')}>
        {operations.filter((item) => item.group === activeGroup).map((item) => (
          <button
            key={item.value}
            type="button"
            className={`jt-operation ${item.value === operation ? 'is-active' : ''}`}
            aria-pressed={item.value === operation}
            onClick={() => setOperation(item.value)}
          >
            {item.title}
          </button>
        ))}
      </nav>

      <main className="jt-main">
        {operation === 'expression' ? (
          <div className="jt-expression">
            <span className="jt-expression-prefix" aria-hidden="true">this</span>
            <TextInput
              value={expression}
              aria-label={t('expression.label')}
              placeholder={t('expression.placeholder')}
              spellCheck={false}
              onCompositionStart={expressionIme.onCompositionStart}
              onCompositionEnd={expressionIme.onCompositionEnd}
              onChange={(event) => setExpression(event.currentTarget.value)}
              onKeyDown={(event) => {
                if (expressionIme.shouldIgnoreKeyDown(event)) return
                if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) runExpression()
              }}
            />
            <Button
              type="button"
              variant="primary"
              disabled={!inputText.trim() || !expression.trim()}
              onClick={runExpression}
            >
              {t('action.run')}
            </Button>
            <kbd>{t('expression.shortcut')}</kbd>
          </div>
        ) : null}

        <div className="jt-editors">
          <section className="jt-pane">
            <div className="jt-pane-header">
              <strong>{t('pane.input')}</strong>
              <Button type="button" variant="ghost" onClick={() => setInputText('')} disabled={!inputText}>
                {t('action.clear')}
              </Button>
            </div>
            <div className="jt-editor" data-launcher-scrollable>
              <Suspense fallback={editorLoading}>
                <TextEditor
                  {...editorAppearance}
                  value={inputText}
                  language={operation === 'yaml-to-json' ? 'yaml' : operation === 'query-to-json' || operation === 'escape' ? 'plaintext' : 'json'}
                  onChange={setInputText}
                  optionOverrides={{
                    ariaLabel: t('pane.input'),
                    placeholder: operation === 'yaml-to-json' ? t('surface.yamlPlaceholder')
                      : operation === 'query-to-json' ? t('surface.queryPlaceholder') : t('surface.inputPlaceholder'),
                    tabSize: indent,
                  }}
                  onReady={(editor) => {
                    editor.getDomNode()?.querySelector('[role="textbox"]')?.setAttribute('data-plugin-surface-autofocus', '')
                    editor.focus()
                  }}
                />
              </Suspense>
            </div>
          </section>

          <section className="jt-pane jt-pane-output">
            <div className="jt-pane-header">
              <strong>{t('pane.output')}</strong>
              <div className="jt-pane-actions">
                <Button type="button" variant="ghost" disabled={!hasOutput} onClick={useOutputAsInput}>
                  {t('action.useAsInput')}
                </Button>
                <Button type="button" onClick={() => void copyOutput()} disabled={!hasOutput}>
                  {t('action.copy')}
                </Button>
              </div>
            </div>
            <div className="jt-editor jt-editor-output" data-launcher-scrollable>
              <Suspense fallback={editorLoading}>
                <TextEditor
                  {...editorAppearance}
                  value={outputText}
                  language={outputLanguage}
                  optionOverrides={{
                    ariaLabel: t('pane.output'),
                    readOnly: true,
                    domReadOnly: true,
                    tabSize: indent,
                    placeholder: result && !result.ok ? '' : operation === 'expression' && !result
                      ? t('expression.emptyOutput') : t('surface.emptyOutput'),
                  }}
                />
              </Suspense>
              {result && !result.ok ? (
                <div className="jt-error" role="alert">
                  <strong>{t('surface.invalidTitle')}</strong>
                  <span>{result.code ? t(`error.${result.code}`) : t('error.convert', { message: result.message })}</span>
                </div>
              ) : null}
            </div>
          </section>
        </div>

        <footer className="jt-status" aria-live="polite">
          <div className="jt-status-input">
            <span>{t('meta.characters', { count: inputText.length })}</span>
            <span className={result && !result.ok ? 'jt-status-error' : ''}>
              {result && !result.ok ? t('status.error') : hasOutput ? t('status.ready') : t('status.waiting')}
            </span>
          </div>
          <div className="jt-status-output">
            {operation === 'format' || operation === 'yaml-to-json' || operation === 'json-to-yaml' ? (
              <div className="jt-format-options">
                <span>{t('option.indent')}</span>
                <SegmentedControl
                  aria-label={t('option.indent')}
                  value={String(indent)}
                  options={[{ value: '2', label: '2' }, { value: '4', label: '4' }]}
                  onChange={(value) => setIndent(Number(value))}
                />
                {operation === 'format' && <Checkbox checked={shouldSort} onChange={(event) => setShouldSort((event.target as HTMLInputElement).checked)}>
                  {t('option.sortKeys')}
                </Checkbox>}
              </div>
            ) : null}
            <span className="jt-status-count">{t('meta.characters', { count: outputText.length })}</span>
          </div>
        </footer>
      </main>
    </section>
  )
}
