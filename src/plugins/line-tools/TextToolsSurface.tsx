import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, Checkbox, IconButton, SegmentedControl, TextInput, useToolDeliveryFeedback } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { ClipboardPaste, CornerDownLeft } from 'lucide-react'
import {
  convertText,
  getTextStats,
  processLines,
  type CaseOperation,
  type LineOperation,
} from './core'
import { caseOperationRoutes, lineOperationRoutes, textToolRoutes } from './routes'

type Group = 'lines' | 'case' | 'stats'

export function TextToolsSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const initialRoute = textToolRoutes.find((route) => route.surfaceId === props.surfaceId)
  const [group, setGroup] = useState<Group>(initialRoute?.group ?? 'lines')
  const [inputText, setInputText] = useState(props.initialText ?? '')
  const baseline = useRef(props.initialText ?? '')
  const hasUnsavedChanges = inputText !== baseline.current
  const reportUnsavedChanges = host.setUnsavedChanges
  useLayoutEffect(() => {
    reportUnsavedChanges?.(hasUnsavedChanges)
  }, [hasUnsavedChanges, reportUnsavedChanges])
  const [lineOperation, setLineOperation] = useState<LineOperation>(
    initialRoute?.group === 'lines' ? initialRoute.operation as LineOperation : 'sort',
  )
  const [selectedCase, setSelectedCase] = useState<CaseOperation>(
    initialRoute?.group === 'case' ? initialRoute.operation as CaseOperation : 'camel',
  )
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc')
  const [ignoreCase, setIgnoreCase] = useState(false)
  const [separator, setSeparator] = useState(',')
  const [prefix, setPrefix] = useState('- ')
  const [suffix, setSuffix] = useState(',')
  const [left, setLeft] = useState('"')
  const [right, setRight] = useState('"')
  const [busy, setBusy] = useState<'copy' | 'paste' | 'return' | null>(null)
  const pendingRef = useRef<{ action: 'copy' | 'paste' | 'return'; controller: AbortController } | null>(null)
  const selectedResultRef = useRef<HTMLLIElement>(null)

  useEffect(() => {
    if (group === 'case') selectedResultRef.current?.scrollIntoView({ block: 'nearest' })
  }, [group, selectedCase])

  const lineOutput = useMemo(() => inputText ? processLines(lineOperation, inputText, {
    direction, ignoreCase, separator, prefix, suffix, left, right,
  }) : '', [direction, ignoreCase, inputText, left, lineOperation, prefix, right, separator, suffix])
  const caseResults = useMemo(() => caseOperationRoutes.map((route) => ({
    ...route,
    operation: route.operation as CaseOperation,
    output: convertText(inputText, route.operation as CaseOperation),
  })), [inputText])
  const stats = useMemo(() => getTextStats(inputText), [inputText])

  const resultIdentity = useMemo(() => ({ inputText, group, lineOperation, direction, ignoreCase, separator, prefix, suffix, left, right }),
    [inputText, group, lineOperation, direction, ignoreCase, separator, prefix, suffix, left, right])
  const delivery = useToolDeliveryFeedback(resultIdentity, host.deliveryFeedbackOwner)

  useLayoutEffect(() => () => {
    pendingRef.current?.controller.abort()
    pendingRef.current = null
  }, [])

  const update = (change: () => void) => {
    delivery.invalidate()
    pendingRef.current?.controller.abort()
    // Keep an issued clipboard/paste write locked until it settles.
    if (pendingRef.current?.action === 'return') {
      pendingRef.current = null
      setBusy(null)
    }
    change()
  }

  const deliver = async (action: 'copy' | 'paste' | 'return', text: string) => {
    if (!text || pendingRef.current) return
    const attempt = delivery.beginAttempt()
    if (!attempt.isCurrent()) return
    const submission = { action, controller: new AbortController() }
    pendingRef.current = submission
    setBusy(action)
    const isCurrent = () => pendingRef.current === submission
      && !submission.controller.signal.aborted && attempt.isCurrent()
    const release = () => {
      if (pendingRef.current !== submission) return
      pendingRef.current = null
      setBusy(null)
    }
    try {
      if (action === 'return') {
        const accepted = await host.returnToLauncherWithObject(
          { kind: 'text', text: text, source: 'tool-result' },
          { signal: submission.controller.signal },
        )
        if (!isCurrent()) return
        if (accepted === false) release()
        return accepted
      }
      if (action === 'copy') {
        await host.clipboard.writeText(text)
        if (!isCurrent()) return
        delivery.invalidate()
        host.showMessage(t('toast.copied'), 'success')
        host.complete()
      } else {
        const delivered = await host.paste.pasteText(text)
        if (!isCurrent()) return
        attempt.reportPaste(delivered)
        if (delivered.ok) host.complete()
      }
    } catch {
      if (isCurrent()) {
        attempt.reportError(t(action === 'copy' ? 'toast.copyFailed' : action === 'paste' ? 'toast.pasteFailed' : 'toast.returnFailed'))
        release()
      }
    } finally {
      release()
    }
  }

  const useLineOutput = () => {
    if (lineOutput) update(() => setInputText(lineOutput))
  }

  return (
    <section className="text-tools-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="text-tools-header">
        <IconButton type="button" label={t('action.back')} onClick={() => update(() => host.requestBack())}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <IconButton type="button" label={t('action.close')} onClick={() => update(() => host.close())}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <nav className="text-tools-groups" aria-label={t('group.label')}>
        {(['lines', 'case', 'stats'] as Group[]).map((item) => (
          <button
            key={item}
            type="button"
            className={item === group ? 'is-active' : ''}
            aria-pressed={item === group}
            onClick={() => update(() => setGroup(item))}
          >
            {t(`group.${item}`)}
          </button>
        ))}
      </nav>

      {group === 'lines' ? (
        <nav className="text-tools-operations" aria-label={t('operation.label')}>
          {lineOperationRoutes.map((route) => (
            <button
              key={route.surfaceId}
              type="button"
              className={route.operation === lineOperation ? 'is-active' : ''}
              aria-pressed={route.operation === lineOperation}
              onClick={() => update(() => setLineOperation(route.operation as LineOperation))}
            >
              {t(route.titleKey)}
            </button>
          ))}
        </nav>
      ) : null}

      {group === 'lines' ? (
        <main className="text-tools-main text-tools-main--lines">
          <div className="text-tools-options">
            {lineOperation === 'sort' ? (
              <SegmentedControl
                aria-label={t('param.direction.label')}
                value={direction}
                options={[
                  { value: 'asc', label: t('param.direction.asc') },
                  { value: 'desc', label: t('param.direction.desc') },
                ]}
                onChange={(value) => update(() => setDirection(value as 'asc' | 'desc'))}
              />
            ) : null}
            {lineOperation === 'sort' || lineOperation === 'dedup' ? (
              <Checkbox checked={ignoreCase} onChange={(event) => update(() => setIgnoreCase((event.target as HTMLInputElement).checked))}>
                {t('param.ignoreCase')}
              </Checkbox>
            ) : null}
            {lineOperation === 'join' ? <TextInput value={separator} aria-label={t('param.separator')} placeholder={t('param.separator')} onChange={(event) => update(() => setSeparator(event.currentTarget.value))} /> : null}
            {lineOperation === 'prepend' ? <TextInput value={prefix} aria-label={t('param.prefix')} placeholder={t('param.prefix')} onChange={(event) => update(() => setPrefix(event.currentTarget.value))} /> : null}
            {lineOperation === 'append' ? <TextInput value={suffix} aria-label={t('param.suffix')} placeholder={t('param.suffix')} onChange={(event) => update(() => setSuffix(event.currentTarget.value))} /> : null}
            {lineOperation === 'wrap' ? (
              <>
                <TextInput value={left} aria-label={t('param.left')} placeholder={t('param.left')} onChange={(event) => update(() => setLeft(event.currentTarget.value))} />
                <TextInput value={right} aria-label={t('param.right')} placeholder={t('param.right')} onChange={(event) => update(() => setRight(event.currentTarget.value))} />
              </>
            ) : null}
            {!['sort', 'dedup', 'join', 'prepend', 'append', 'wrap'].includes(lineOperation) ? (
              <span>{t('option.livePreview')}</span>
            ) : null}
          </div>
          <div className="text-tools-editors">
            <section className="text-tools-pane">
              <div className="text-tools-pane-header">
                <strong>{t('pane.input')}</strong>
                <Button type="button" variant="ghost" disabled={!inputText} onClick={() => update(() => setInputText(''))}>{t('action.clear')}</Button>
              </div>
              <textarea
                data-plugin-surface-autofocus
                data-launcher-scrollable
                value={inputText}
                aria-label={t('pane.input')}
                placeholder={t('surface.inputPlaceholder')}
                spellCheck={false}
                onChange={(event) => update(() => setInputText(event.currentTarget.value))}
              />
            </section>
            <section className="text-tools-pane text-tools-pane--output">
              <div className="text-tools-pane-header">
                <strong>{t('pane.output')}</strong>
                <div className="text-tools-pane-actions">
                  <Button type="button" variant="ghost" title={t('action.useAsInputDescription')} aria-label={t('action.useAsInputDescription')} disabled={!lineOutput || busy !== null} onClick={useLineOutput}>{t('action.useAsInput')}</Button>
                  <Button type="button" variant="ghost" title={t('action.continueProcessingDescription')} aria-label={t('action.continueProcessingDescription')} disabled={!lineOutput || busy !== null} onClick={() => deliver('return', lineOutput)}>
                    <CornerDownLeft size={14} aria-hidden="true" />
                    {t('action.continueProcessing')}
                  </Button>
                  <Button type="button" variant="ghost" title={t('action.pasteBackDescription')} aria-label={t('action.pasteBackDescription')} disabled={!lineOutput || busy !== null} onClick={() => void deliver('paste', lineOutput)}>
                    <ClipboardPaste size={14} aria-hidden="true" />
                    {t('action.pasteBack')}
                  </Button>
                  <Button type="button" title={t('action.copyDescription')} aria-label={t('action.copyDescription')} disabled={!lineOutput || busy !== null} onClick={() => void deliver('copy', lineOutput)}>{t('action.copy')}</Button>
                </div>
              </div>
              <textarea data-launcher-scrollable value={lineOutput} aria-label={t('pane.output')} placeholder={t('surface.outputPlaceholder')} readOnly spellCheck={false} />
            </section>
          </div>
          <footer className={`text-tools-status${delivery.feedback ? ' has-delivery' : ''}`} aria-live="polite">
            <span>{t('meta.characters', { count: inputText.length })}</span>
            <span className={delivery.feedback ? `is-${delivery.feedback.tone}` : ''} role="status">{delivery.feedback?.message ?? t('status.live')}</span>
            <span>{t('meta.characters', { count: lineOutput.length })}</span>
          </footer>
        </main>
      ) : group === 'case' ? (
        <main className="text-tools-main text-tools-main--case">
          <section className="text-tools-pane text-tools-case-input">
            <div className="text-tools-pane-header">
              <strong>{t('pane.sourceName')}</strong>
              <Button type="button" variant="ghost" disabled={!inputText} onClick={() => update(() => setInputText(''))}>{t('action.clear')}</Button>
            </div>
            <textarea
              data-plugin-surface-autofocus
              data-launcher-scrollable
              value={inputText}
              aria-label={t('pane.sourceName')}
              placeholder={t('surface.casePlaceholder')}
              spellCheck={false}
              onChange={(event) => update(() => setInputText(event.currentTarget.value))}
            />
          </section>
          <section className="text-tools-results" aria-label={t('pane.caseResults')}>
            <div className={`text-tools-pane-header${delivery.feedback ? ' has-delivery' : ''}`}>
              <strong>{t('pane.caseResults')}</strong>
              <span className={delivery.feedback ? `text-tools-delivery is-${delivery.feedback.tone}` : ''} role="status" aria-live="polite">{delivery.feedback?.message ?? t('case.copyHint')}</span>
            </div>
            <ul data-launcher-scrollable>
              {caseResults.map((result) => (
                <li key={result.surfaceId} ref={result.operation === selectedCase ? selectedResultRef : undefined} className={result.operation === selectedCase ? 'is-selected' : ''}>
                  <button className="text-tools-result-copy" type="button" disabled={!result.output || busy !== null} aria-label={t('case.copyLabel', { format: t(result.titleKey) })} onClick={() => {
                    setSelectedCase(result.operation)
                    void deliver('copy', result.output)
                  }}>
                    <span>{t(result.titleKey)}</span>
                    <code>{result.output || t('case.emptyResult')}</code>
                    <small>{t('action.copy')}</small>
                  </button>
                  <div className="text-tools-pane-actions">
                    <IconButton type="button" label={t('action.continueProcessingDescription')} disabled={!result.output || busy !== null} onClick={() => deliver('return', result.output)}>
                      <CornerDownLeft size={14} />
                    </IconButton>
                    <IconButton type="button" label={t('action.pasteBackDescription')} disabled={!result.output || busy !== null} onClick={() => void deliver('paste', result.output)}>
                      <ClipboardPaste size={14} />
                    </IconButton>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </main>
      ) : (
        <main className="text-tools-main text-tools-main--stats">
          <section className="text-tools-pane">
            <div className="text-tools-pane-header">
              <strong>{t('pane.input')}</strong>
              <Button type="button" variant="ghost" disabled={!inputText} onClick={() => update(() => setInputText(''))}>{t('action.clear')}</Button>
            </div>
            <textarea
              data-plugin-surface-autofocus
              data-launcher-scrollable
              value={inputText}
              aria-label={t('pane.input')}
              placeholder={t('surface.statsPlaceholder')}
              spellCheck={false}
              onChange={(event) => update(() => setInputText(event.currentTarget.value))}
            />
          </section>
          <section className="text-tools-stats" aria-label={t('count.title')} aria-live="polite">
            <h2>{t('count.title')}</h2>
            <dl>
              <div><dt>{t('count.linesLabel')}</dt><dd>{stats.lines}</dd></div>
              <div><dt>{t('count.wordsLabel')}</dt><dd>{stats.words}</dd></div>
              <div><dt>{t('count.charactersLabel')}</dt><dd>{stats.characters}</dd></div>
              <div><dt>{t('count.charactersNoSpaceLabel')}</dt><dd>{stats.charactersNoSpace}</dd></div>
            </dl>
          </section>
        </main>
      )}
    </section>
  )
}
