import { useLayoutEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'
import { getPluginHostSdk, type PluginSurfaceProps } from '@hiven/plugin'
import { Button, Checkbox, IconButton, SegmentedControl, Select, TextArea, TextInput, useToolDeliveryFeedback } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { Check, ClipboardPaste, Copy, CornerDownLeft, TriangleAlert } from 'lucide-react'
import {
  DEFAULT_WORKBENCH_OPTIONS,
  WORKBENCH_OPERATIONS,
  evaluateWorkbench,
  getWorkbenchOperation,
  type WorkbenchOperation,
  type WorkbenchOptions,
  type WorkbenchResult,
} from './workbenchModel'
import './workbench.css'

type OutputAction = 'copy' | 'paste' | 'return'

export type WorkbenchSelection = {
  operation: WorkbenchOperation
  options: WorkbenchOptions
}

type TextWorkbenchProps = PluginSurfaceProps & {
  embedded?: {
    inputText: string
    onInputChange(text: string): void
    selection: WorkbenchSelection
    onSelectionChange: Dispatch<SetStateAction<WorkbenchSelection>>
    onBusyChange(busy: boolean): void
    invalidateRef: { current: (() => void) | null }
  }
}

export function TextWorkbenchSurface(props: TextWorkbenchProps) {
  const { host, t } = props
  const { compactJson, formatJson, urlDecode, urlEncode } = getPluginHostSdk().kits.textTransforms
  const [localInputText, setLocalInputText] = useState(props.initialText ?? '')
  const inputText = props.embedded?.inputText ?? localInputText
  const setInputText = props.embedded?.onInputChange ?? setLocalInputText
  const baseline = useRef(props.initialText ?? '')
  const [localSelection, setLocalSelection] = useState<WorkbenchSelection>(() => ({
    operation: getWorkbenchOperation(props.surfaceId),
    options: { ...DEFAULT_WORKBENCH_OPTIONS },
  }))
  const { operation, options } = props.embedded?.selection ?? localSelection
  const setSelection = props.embedded?.onSelectionChange ?? setLocalSelection
  const [revision, setRevision] = useState(0)
  const revisionRef = useRef(0)
  const [busy, setBusyState] = useState<OutputAction | null>(null)
  const reportBusy = props.embedded?.onBusyChange
  const setBusy = (action: OutputAction | null) => {
    setBusyState(action)
    reportBusy?.(action !== null)
  }
  const pendingRef = useRef<{ action: OutputAction; controller: AbortController } | null>(null)
  const activeRef = useRef(false)
  const currentResultRef = useRef<WorkbenchResult | null>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const selected = WORKBENCH_OPERATIONS.find((item) => item.value === operation)!
  const category = selected.category

  const result = useMemo<WorkbenchResult>(() => {
    return evaluateWorkbench(inputText, operation, options, { compactJson, formatJson, urlDecode, urlEncode })
    // A revision gives identical-looking results a fresh identity after any edit or exit.
  }, [inputText, operation, options, revision, compactJson, formatJson, urlDecode, urlEncode])
  const delivery = useToolDeliveryFeedback(result, host.deliveryFeedbackOwner)

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
  // The existing naming/statistics shell owns its shared draft and dirty report.
  const reportUnsavedChanges = props.embedded ? undefined : host.setUnsavedChanges
  useLayoutEffect(() => {
    reportUnsavedChanges?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, reportUnsavedChanges])

  useLayoutEffect(() => () => reportBusy?.(false), [reportBusy])

  // Revoke pending callbacks before React commits the next input or operation.
  const update = (change: () => void) => {
    delivery.invalidate()
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

  // The containing shell must revoke this result before Back/Close can show an
  // exit confirmation, even when that confirmation leaves the workbench mounted.
  const exitInvalidationRef = props.embedded?.invalidateRef
  useLayoutEffect(() => {
    if (!exitInvalidationRef) return
    const invalidate = () => update(() => {})
    exitInvalidationRef.current = invalidate
    return () => {
      if (exitInvalidationRef.current === invalidate) exitInvalidationRef.current = null
    }
  })

  const changeOption = <Key extends keyof WorkbenchOptions>(key: Key, value: WorkbenchOptions[Key]) => {
    update(() => setSelection((current) => ({ ...current, options: { ...current.options, [key]: value } })))
  }

  const changeOperation = (next: WorkbenchOperation) => {
    if (next !== operation) update(() => setSelection((current) => ({ ...current, operation: next })))
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
    const attempt = delivery.beginAttempt()
    if (!attempt.isCurrent()) return
    const submission = { action, controller: new AbortController() }
    pendingRef.current = submission
    setBusy(action)
    const isCurrent = () => pendingRef.current === submission
      && !submission.controller.signal.aborted && isCurrentResult() && attempt.isCurrent()
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
        delivery.invalidate()
        host.showMessage(t('toast.copied'), 'success')
        host.complete()
      } else {
        const delivered = await host.paste.pasteText(result.text)
        if (!isCurrent()) return
        attempt.reportPaste(delivered)
        if (delivered.ok) host.complete()
      }
    } catch {
      if (isCurrent()) {
        attempt.reportError(t(action === 'copy' ? 'toast.copyFailed' : action === 'paste' ? 'toast.pasteFailed' : 'workbench.returnFailed'))
        release()
      }
    } finally {
      release()
    }
  }

  const outputText = result.status === 'ready' ? result.text : ''
  const outputDisabled = result.status !== 'ready' || busy !== null
  const resultStatus = result.status === 'ready'
    ? t(outputText.length === 0 ? 'workbench.status.empty' : 'workbench.status.ready')
    : t(result.status === 'error' ? 'workbench.status.error' : 'workbench.status.waiting')

  return (
    <section className={`text-workbench${props.embedded ? ' text-workbench--embedded' : ''}`} aria-label={t('workbench.title')} data-no-drag>
      {!props.embedded ? <header className="text-workbench-header">
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
      </header> : null}

      <div className="text-workbench-controls">
        <SegmentedControl
          aria-label={t('workbench.category')}
          value={category}
          options={(['text', 'json', 'url'] as const).map((value) => ({ value, label: t(`workbench.category.${value}`) }))}
          onChange={(value) => {
            if (value !== category) changeOperation(WORKBENCH_OPERATIONS.find((item) => item.category === value)!.value)
          }}
        />
        <label className="text-workbench-operation">
          <span>{t('workbench.operation')}</span>
          <Select
            aria-label={t('workbench.operation')}
            value={operation}
            options={WORKBENCH_OPERATIONS.filter((item) => item.category === category).map((item) => ({ value: item.value, label: t(item.label) }))}
            onChange={(event) => {
              const next = event.currentTarget.value as WorkbenchOperation
              changeOperation(next)
            }}
          />
        </label>
        <div className={`text-workbench-options${operation === 'clean-list' ? ' text-workbench-options--cleanup' : ''}`}>
          {operation === 'json-format' ? (
            <SegmentedControl
              aria-label={t('workbench.indent')}
              value={String(options.indent)}
              options={[2, 4].map((count) => ({ value: String(count), label: t('workbench.spaces', { count }) }))}
              onChange={(value) => changeOption('indent', Number(value))}
            />
          ) : null}
          {operation === 'sort' ? (
            <SegmentedControl
              aria-label={t('param.direction.label')}
              value={options.direction}
              options={[
                { value: 'asc', label: t('param.direction.asc') },
                { value: 'desc', label: t('param.direction.desc') },
              ]}
              onChange={(value) => changeOption('direction', value as WorkbenchOptions['direction'])}
            />
          ) : null}
          {operation === 'sort' || operation === 'dedup' ? (
            <Checkbox checked={options.ignoreCase} onChange={(event) => changeOption('ignoreCase', (event.target as HTMLInputElement).checked)}>
              {t('param.ignoreCase')}
            </Checkbox>
          ) : null}
          {operation === 'clean-list' ? (['trim', 'removeBlank', 'dedup'] as const).map((key) => (
            <Checkbox key={key} checked={options[key]} title={t(`param.cleanList.${key}Hint`)} onChange={(event) => changeOption(key, (event.target as HTMLInputElement).checked)}>
              {t(`workbench.cleanup.${key}`)}
            </Checkbox>
          )) : null}
          {(['separator', 'prefix', 'suffix', 'left', 'right'] as const).filter((key) => (
            operation === 'join' && key === 'separator'
            || operation === 'prepend' && key === 'prefix'
            || operation === 'append' && key === 'suffix'
            || operation === 'wrap' && (key === 'left' || key === 'right')
          )).map((key) => (
            <label key={key} className="text-workbench-option-field">
              <span>{t(`param.${key}`)}</span>
              <TextInput value={options[key]} aria-label={t(`param.${key}`)} onChange={(event) => changeOption(key, event.currentTarget.value)} />
            </label>
          ))}
          {!['json-format', 'sort', 'dedup', 'clean-list', 'join', 'prepend', 'append', 'wrap'].includes(operation) ? <span>{t('option.livePreview')}</span> : null}
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
          <div className={`text-workbench-result-meta${delivery.feedback ? ` is-delivery is-${delivery.feedback.tone}` : ''}`} role="status" aria-live="polite">
            <span>{delivery.feedback?.message ?? t(selected.label)}</span>
            {!delivery.feedback && result.status === 'ready' ? <span>{t('meta.characters', { count: outputText.length })}</span> : null}
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
