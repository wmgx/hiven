import { useEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, Checkbox, IconButton, SegmentedControl, TextInput } from '@hiven/plugin-ui'
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
  const [pasting, setPasting] = useState(false)
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

  const copyText = async (value: string) => {
    if (!value) return
    try {
      await host.clipboard.writeText(value)
      host.showMessage(t('toast.copied'), 'success')
      host.complete()
    } catch {
      host.showMessage(t('toast.copyFailed'), 'error')
    }
  }

  const useLineOutput = () => {
    if (lineOutput) setInputText(lineOutput)
  }

  const pasteOutput = async (text: string) => {
    if (!text || pasting) return
    setPasting(true)
    try {
      const result = await host.paste.pasteText(text)
      if (result.ok) host.complete()
      else if (result.fallback === 'copied') {
        host.showMessage(result.message || t('toast.copied'), 'info')
        host.complete()
      } else host.showMessage(result.message || t('toast.pasteFailed'), 'error')
    } catch {
      host.showMessage(t('toast.pasteFailed'), 'error')
    } finally {
      setPasting(false)
    }
  }

  return (
    <section className="text-tools-surface" aria-label={t('surface.title')} data-no-drag>
      <header className="text-tools-header">
        <IconButton type="button" label={t('action.back')} onClick={() => host.requestBack()}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <IconButton type="button" label={t('action.close')} onClick={() => host.close()}>
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
            onClick={() => setGroup(item)}
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
              onClick={() => setLineOperation(route.operation as LineOperation)}
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
                onChange={(value) => setDirection(value as 'asc' | 'desc')}
              />
            ) : null}
            {lineOperation === 'sort' || lineOperation === 'dedup' ? (
              <Checkbox checked={ignoreCase} onChange={(event) => setIgnoreCase((event.target as HTMLInputElement).checked)}>
                {t('param.ignoreCase')}
              </Checkbox>
            ) : null}
            {lineOperation === 'join' ? <TextInput value={separator} aria-label={t('param.separator')} placeholder={t('param.separator')} onChange={(event) => setSeparator(event.currentTarget.value)} /> : null}
            {lineOperation === 'prepend' ? <TextInput value={prefix} aria-label={t('param.prefix')} placeholder={t('param.prefix')} onChange={(event) => setPrefix(event.currentTarget.value)} /> : null}
            {lineOperation === 'append' ? <TextInput value={suffix} aria-label={t('param.suffix')} placeholder={t('param.suffix')} onChange={(event) => setSuffix(event.currentTarget.value)} /> : null}
            {lineOperation === 'wrap' ? (
              <>
                <TextInput value={left} aria-label={t('param.left')} placeholder={t('param.left')} onChange={(event) => setLeft(event.currentTarget.value)} />
                <TextInput value={right} aria-label={t('param.right')} placeholder={t('param.right')} onChange={(event) => setRight(event.currentTarget.value)} />
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
                <Button type="button" variant="ghost" disabled={!inputText} onClick={() => setInputText('')}>{t('action.clear')}</Button>
              </div>
              <textarea
                data-plugin-surface-autofocus
                data-launcher-scrollable
                value={inputText}
                aria-label={t('pane.input')}
                placeholder={t('surface.inputPlaceholder')}
                spellCheck={false}
                onChange={(event) => setInputText(event.currentTarget.value)}
              />
            </section>
            <section className="text-tools-pane text-tools-pane--output">
              <div className="text-tools-pane-header">
                <strong>{t('pane.output')}</strong>
                <div className="text-tools-pane-actions">
                  <Button type="button" variant="ghost" disabled={!lineOutput || pasting} onClick={useLineOutput}>{t('action.useAsInput')}</Button>
                  <IconButton type="button" label={t('action.continueProcessing')} disabled={!lineOutput || pasting} onClick={() => host.returnToLauncherWithObject({ kind: 'text', text: lineOutput })}>
                    <CornerDownLeft size={14} />
                  </IconButton>
                  <IconButton type="button" label={t('action.pasteBack')} disabled={!lineOutput || pasting} onClick={() => void pasteOutput(lineOutput)}>
                    <ClipboardPaste size={14} />
                  </IconButton>
                  <Button type="button" disabled={!lineOutput || pasting} onClick={() => void copyText(lineOutput)}>{t('action.copy')}</Button>
                </div>
              </div>
              <textarea data-launcher-scrollable value={lineOutput} aria-label={t('pane.output')} placeholder={t('surface.outputPlaceholder')} readOnly spellCheck={false} />
            </section>
          </div>
          <footer className="text-tools-status">
            <span>{t('meta.characters', { count: inputText.length })}</span>
            <span>{t('status.live')}</span>
            <span>{t('meta.characters', { count: lineOutput.length })}</span>
          </footer>
        </main>
      ) : group === 'case' ? (
        <main className="text-tools-main text-tools-main--case">
          <section className="text-tools-pane text-tools-case-input">
            <div className="text-tools-pane-header">
              <strong>{t('pane.sourceName')}</strong>
              <Button type="button" variant="ghost" disabled={!inputText} onClick={() => setInputText('')}>{t('action.clear')}</Button>
            </div>
            <textarea
              data-plugin-surface-autofocus
              data-launcher-scrollable
              value={inputText}
              aria-label={t('pane.sourceName')}
              placeholder={t('surface.casePlaceholder')}
              spellCheck={false}
              onChange={(event) => setInputText(event.currentTarget.value)}
            />
          </section>
          <section className="text-tools-results" aria-label={t('pane.caseResults')}>
            <div className="text-tools-pane-header">
              <strong>{t('pane.caseResults')}</strong>
              <span>{t('case.copyHint')}</span>
            </div>
            <ul data-launcher-scrollable>
              {caseResults.map((result) => (
                <li key={result.surfaceId} ref={result.operation === selectedCase ? selectedResultRef : undefined} className={result.operation === selectedCase ? 'is-selected' : ''}>
                  <button className="text-tools-result-copy" type="button" disabled={!result.output || pasting} aria-label={t('case.copyLabel', { format: t(result.titleKey) })} onClick={() => {
                    setSelectedCase(result.operation)
                    void copyText(result.output)
                  }}>
                    <span>{t(result.titleKey)}</span>
                    <code>{result.output || t('case.emptyResult')}</code>
                    <small>{t('action.copy')}</small>
                  </button>
                  <div className="text-tools-pane-actions">
                    <IconButton type="button" label={t('action.continueProcessing')} disabled={!result.output || pasting} onClick={() => host.returnToLauncherWithObject({ kind: 'text', text: result.output })}>
                      <CornerDownLeft size={14} />
                    </IconButton>
                    <IconButton type="button" label={t('action.pasteBack')} disabled={!result.output || pasting} onClick={() => void pasteOutput(result.output)}>
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
              <Button type="button" variant="ghost" disabled={!inputText} onClick={() => setInputText('')}>{t('action.clear')}</Button>
            </div>
            <textarea
              data-plugin-surface-autofocus
              data-launcher-scrollable
              value={inputText}
              aria-label={t('pane.input')}
              placeholder={t('surface.statsPlaceholder')}
              spellCheck={false}
              onChange={(event) => setInputText(event.currentTarget.value)}
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
