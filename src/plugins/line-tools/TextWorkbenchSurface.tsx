import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import { getPluginHostSdk, type PluginSurfaceProps } from '@hiven/plugin'
import { Button, Checkbox, IconButton, SegmentedControl, Select, TextArea } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { Check, ClipboardPaste, Copy, CornerDownLeft, TriangleAlert } from 'lucide-react'
import { dedupLines, removeBlankLines, trimLineWhitespace } from './core'
import './workbench.css'

type Category = 'text' | 'json' | 'url'
type Operation = 'trim' | 'remove-blank' | 'dedup' | 'json-format' | 'json-compact' | 'url-encode' | 'url-decode'
type Result = { status: 'idle' } | { status: 'ready'; text: string } | { status: 'error'; messageKey: string }
type OutputAction = 'copy' | 'paste' | 'return'

const operations: { value: Operation; category: Category; label: string }[] = [
  { value: 'trim', category: 'text', label: 'trimWhitespace.title' },
  { value: 'remove-blank', category: 'text', label: 'removeBlankLines.title' },
  { value: 'dedup', category: 'text', label: 'dedup.title' },
  { value: 'json-format', category: 'json', label: 'workbench.operation.jsonFormat' },
  { value: 'json-compact', category: 'json', label: 'workbench.operation.jsonCompact' },
  { value: 'url-encode', category: 'url', label: 'workbench.operation.urlEncode' },
  { value: 'url-decode', category: 'url', label: 'workbench.operation.urlDecode' },
]

export function TextWorkbenchSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const { compactJson, formatJson, urlDecode, urlEncode } = getPluginHostSdk().kits.textTransforms
  const [inputText, setInputText] = useState(props.initialText ?? '')
  const baseline = useRef(props.initialText ?? '')
  const [operation, setOperation] = useState<Operation>('trim')
  const [indent, setIndent] = useState(2)
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(0)
  const [busy, setBusy] = useState<OutputAction | null>(null)
  const pendingRef = useRef<{ action: OutputAction; controller: AbortController } | null>(null)
  const activeRef = useRef(false)
  const currentResultRef = useRef<Result | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const selected = operations.find((item) => item.value === operation)!
  const category = selected.category

  const result = useMemo<Result>(() => {
    if (inputText.length === 0) return { status: 'idle' }
    try {
      let text: string
      switch (operation) {
        case 'trim': text = trimLineWhitespace(inputText); break
        case 'remove-blank': text = removeBlankLines(inputText); break
        case 'dedup': text = dedupLines(inputText, ignoreCase); break
        case 'json-format': text = inputText.trim() ? formatJson(inputText, indent) : ''; break
        case 'json-compact': text = inputText.trim() ? compactJson(inputText) : ''; break
        case 'url-encode': text = urlEncode(inputText); break
        case 'url-decode': text = urlDecode(inputText); break
      }
      return { status: 'ready', text }
    } catch {
      return { status: 'error', messageKey: category === 'json' ? 'workbench.error.json' : 'workbench.error.url' }
    }
    // A revision gives identical-looking results a fresh identity after any edit or exit.
  }, [inputText, operation, indent, ignoreCase, category, revision, compactJson, formatJson, urlDecode, urlEncode])

  useLayoutEffect(() => {
    activeRef.current = true
    return () => {
      activeRef.current = false
      currentResultRef.current = null
      pendingRef.current?.controller.abort()
      pendingRef.current = null
    }
  }, [])

  useLayoutEffect(() => {
    currentResultRef.current = result
  }, [result])

  const hasUnsavedChanges = inputText !== baseline.current
  const reportUnsavedChanges = host.setUnsavedChanges
  useLayoutEffect(() => {
    reportUnsavedChanges?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, reportUnsavedChanges])

  // Revoke pending callbacks before React commits the next input or operation.
  const update = (change: () => void) => {
    currentResultRef.current = null
    revisionRef.current += 1
    pendingRef.current?.controller.abort()
    // Clipboard/paste cannot be cancelled. Keep their lock until settlement so a
    // newer action cannot race an already-issued write; their old callbacks expire.
    if (pendingRef.current?.action === 'return') {
      pendingRef.current = null
      setBusy(null)
    }
    setRevision(revisionRef.current)
    change()
  }

  // The host is rebuilt on ordinary parent renders; it guards its own target lifetime.
  const isCurrentResult = () => activeRef.current
    && currentResultRef.current === result
    && revisionRef.current === revision

  const useResult = () => {
    if (!isCurrentResult() || result.status !== 'ready' || pendingRef.current) return
    update(() => setInputText(result.text))
    inputRef.current?.focus()
  }

  const deliver = async (action: OutputAction) => {
    if (!isCurrentResult() || result.status !== 'ready' || pendingRef.current) return
    const submission = { action, controller: new AbortController() }
    pendingRef.current = submission
    setBusy(action)
    const isCurrent = () => pendingRef.current === submission
      && !submission.controller.signal.aborted && isCurrentResult()
    const release = () => {
      if (pendingRef.current !== submission) return
      pendingRef.current = null
      setBusy(null)
    }
    try {
      if (action === 'return') {
        const accepted = await host.returnToLauncherWithObject(
          { kind: 'text', text: result.text, source: 'tool-result' },
          { signal: submission.controller.signal },
        )
        if (!isCurrent()) return
        // The host owns successful navigation and reports a rejected handoff.
        if (accepted === false) release()
        return
      }
      if (action === 'copy') {
        await host.clipboard.writeText(result.text)
        if (!isCurrent()) return
        host.showMessage(t('toast.copied'), 'success')
        host.complete()
      } else {
        const delivered = await host.paste.pasteText(result.text)
        if (!isCurrent()) return
        if (delivered.ok) host.complete()
        else if (delivered.fallback === 'copied') host.showMessage(delivered.message, 'info')
        else if (delivered.message) host.showMessage(delivered.message, 'error')
      }
    } catch {
      if (isCurrent()) {
        host.showMessage(t(action === 'copy' ? 'toast.copyFailed' : action === 'paste' ? 'toast.pasteFailed' : 'workbench.returnFailed'), 'error')
        release()
      }
    } finally {
      if (action !== 'return') release()
    }
  }

  const outputText = result.status === 'ready' ? result.text : ''
  const outputDisabled = result.status !== 'ready' || busy !== null
  const resultStatus = result.status === 'ready'
    ? t(outputText.length === 0 ? 'workbench.status.empty' : 'workbench.status.ready')
    : t(result.status === 'error' ? 'workbench.status.error' : 'workbench.status.waiting')

  return (
    <section className="text-workbench" aria-label={t('workbench.title')} data-no-drag>
      <header className="text-workbench-header">
        <IconButton type="button" label={t('action.back')} onClick={() => update(() => host.requestBack())}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <div className="text-workbench-heading">
          <strong>{t('workbench.title')}</strong>
          <span>{t('workbench.material', { count: inputText.length })}</span>
        </div>
        <IconButton type="button" label={t('action.close')} onClick={() => update(() => host.close())}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <div className="text-workbench-controls">
        <SegmentedControl
          aria-label={t('workbench.category')}
          value={category}
          options={(['text', 'json', 'url'] as const).map((value) => ({ value, label: t(`workbench.category.${value}`) }))}
          onChange={(value) => {
            if (value !== category) update(() => setOperation(operations.find((item) => item.category === value)!.value))
          }}
        />
        <label className="text-workbench-operation">
          <span>{t('workbench.operation')}</span>
          <Select
            aria-label={t('workbench.operation')}
            value={operation}
            options={operations.filter((item) => item.category === category).map((item) => ({ value: item.value, label: t(item.label) }))}
            onChange={(event) => {
              const next = event.currentTarget.value as Operation
              if (next !== operation) update(() => setOperation(next))
            }}
          />
        </label>
        <div className="text-workbench-options">
          {operation === 'json-format' ? (
            <SegmentedControl
              aria-label={t('workbench.indent')}
              value={String(indent)}
              options={[2, 4].map((count) => ({ value: String(count), label: t('workbench.spaces', { count }) }))}
              onChange={(value) => update(() => setIndent(Number(value)))}
            />
          ) : operation === 'dedup' ? (
            <Checkbox checked={ignoreCase} onChange={(event) => update(() => setIgnoreCase((event.target as HTMLInputElement).checked))}>
              {t('param.ignoreCase')}
            </Checkbox>
          ) : <span>{t('option.livePreview')}</span>}
        </div>
      </div>

      <main className="text-workbench-panes">
        <section className="text-workbench-pane">
          <div className="text-workbench-pane-heading">
            <strong>{t('pane.input')}</strong>
            <span>{t('meta.characters', { count: inputText.length })}</span>
          </div>
          <TextArea
            ref={inputRef}
            data-plugin-surface-autofocus
            data-launcher-scrollable
            value={inputText}
            aria-label={t('pane.input')}
            placeholder={t('workbench.inputPlaceholder')}
            spellCheck={false}
            onChange={(event) => update(() => setInputText(event.currentTarget.value))}
          />
        </section>
        <section className={`text-workbench-pane text-workbench-result${result.status === 'error' ? ' is-error' : ''}`}>
          <div className="text-workbench-pane-heading">
            <strong>{t('workbench.result')}</strong>
            <span className={`text-workbench-result-status is-${result.status}`} role="status" aria-live="polite">
              {result.status === 'ready' ? <Check size={12} aria-hidden="true" /> : result.status === 'error' ? <TriangleAlert size={12} aria-hidden="true" /> : null}
              {resultStatus}
            </span>
          </div>
          <TextArea
            data-launcher-scrollable
            value={result.status === 'error' ? t(result.messageKey) : outputText}
            aria-label={t('workbench.result')}
            aria-invalid={result.status === 'error'}
            placeholder={t(result.status === 'ready' ? 'workbench.emptyResult' : 'workbench.outputPlaceholder')}
            readOnly
            spellCheck={false}
          />
          <div className="text-workbench-result-meta">
            <span>{t(selected.label)}</span>
            {result.status === 'ready' ? <span>{t('meta.characters', { count: outputText.length })}</span> : null}
          </div>
        </section>
      </main>

      <footer className="text-workbench-footer">
        <Button type="button" variant="secondary" disabled={outputDisabled} title={t('workbench.useResultDescription')} onClick={useResult}>
          {t('workbench.useResult')}
        </Button>
        <div className="text-workbench-output-actions">
          <Button type="button" variant="ghost" disabled={outputDisabled} title={t('workbench.returnDescription')} onClick={() => void deliver('return')}>
            <CornerDownLeft size={14} aria-hidden="true" />
            {t(busy === 'return' ? 'workbench.returning' : 'workbench.return')}
          </Button>
          <Button type="button" variant="ghost" disabled={outputDisabled} title={t('action.pasteBackDescription')} onClick={() => void deliver('paste')}>
            <ClipboardPaste size={14} aria-hidden="true" />
            {t(busy === 'paste' ? 'workbench.pasting' : 'action.pasteBack')}
          </Button>
          <Button type="button" variant="primary" disabled={outputDisabled} title={t('action.copyDescription')} onClick={() => void deliver('copy')}>
            <Copy size={14} aria-hidden="true" />
            {t(busy === 'copy' ? 'workbench.copying' : 'action.copy')}
          </Button>
        </div>
      </footer>
    </section>
  )
}
