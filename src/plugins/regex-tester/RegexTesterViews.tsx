import { useEffect, useMemo, useRef, useState } from 'react'
import { getPluginHostSdk, type PanelPropsV2, type PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon } from '@hiven/plugin-ui/icons'
import { evaluateRegex, MAX_REGEX_MATCHES, type MatchResult } from './regexCore'
import { extractRegexMatches } from './extractMatches'

const COMMON_FLAGS = ['g', 'i', 'm', 's', 'u'] as const

export function RegexTesterPluginPanel({ host, paneId }: PanelPropsV2<unknown>) {
  const { hooks, react: React } = getPluginHostSdk()
  const t = hooks.useT('regex-tester')
  const paneText = hooks.usePaneText(paneId ?? '') ?? ''
  const [pattern, setPattern] = React.useState('')
  const [flags, setFlags] = React.useState('g')
  const result = React.useMemo(() => evaluateRegex(pattern, flags, paneText), [flags, paneText, pattern])

  return (
    <div className="flex flex-col h-full overflow-hidden" style={{ background: 'var(--color-background-primary)' }}>
      <div
        className="h-[28px] flex items-center px-3 gap-2 shrink-0"
        style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}
      >
        <span className="text-[11px] font-medium" style={{ color: 'var(--color-text-secondary)' }}>
          {t('panel.main.title')}
        </span>
        <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>
          · {paneId || 'editor'}
        </span>
        <button
          className="ml-auto text-[10px] px-1.5 py-0.5 rounded hover:opacity-80"
          style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-secondary)' }}
          onClick={host.close}
        >
          {t('panel.close')}
        </button>
      </div>

      <div className="flex items-center px-3 py-1.5 gap-2" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>/</span>
        <input
          className="flex-1 text-[12px] bg-transparent outline-none"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder={t('panel.regex.pattern')}
          value={pattern}
          onChange={(event) => setPattern(event.target.value)}
          autoFocus
        />
        <span className="text-[10px] shrink-0" style={{ color: 'var(--color-text-tertiary)' }}>/</span>
        <input
          className="w-[40px] text-[12px] bg-transparent outline-none text-center"
          style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}
          placeholder={t('panel.regex.flags')}
          value={flags}
          onChange={(event) => setFlags(event.target.value)}
        />
      </div>

      <div className="flex-1 overflow-auto px-3 py-1.5">
        {result.error && (
          <div role="alert" className="text-[11px] py-1" style={{ color: 'var(--color-error-text)' }}>
            {t('error.invalid')}
          </div>
        )}
        {!result.error && result.matches.length > 0 && (
          <div className="text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
            <span style={{ color: 'var(--color-success-text)' }}>
              {t(result.matches.length === 1 ? 'panel.regex.match' : 'panel.regex.matches', { count: result.matches.length })}
            </span>
            {result.matches.slice(0, 20).map((match, index) => (
              <div key={`${match.index}-${index}`} className="flex gap-2 py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                <span className="shrink-0">{match.line}:{match.col}</span>
                <span className="truncate" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>
                  {match.text.slice(0, 50)}{match.text.length > 50 ? '…' : ''}
                </span>
                {match.groups.length > 0 && (
                  <span style={{ color: 'var(--color-text-tertiary)' }}>
                    [{match.groups.map((group) => group || '∅').join(', ')}]
                  </span>
                )}
              </div>
            ))}
            {result.matches.length > 20 && (
              <div className="py-0.5" style={{ color: 'var(--color-text-tertiary)' }}>
                {t('panel.regex.more', { count: result.matches.length - 20 })}
              </div>
            )}
          </div>
        )}
        {!result.error && pattern && result.matches.length === 0 && (
          <div className="text-[11px]" style={{ color: 'var(--color-text-tertiary)' }}>
            {t('panel.regex.noMatches')}
          </div>
        )}
      </div>
    </div>
  )
}

export function RegexTesterSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const [pattern, setPattern] = useState('[a-z]+')
  const [flags, setFlags] = useState('g')
  const [sourceText, setSourceText] = useState(props.initialText ?? 'hello 123\nworld 456')
  const [activeMatch, setActiveMatch] = useState(-1)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const result = useMemo(() => evaluateRegex(pattern, flags, sourceText), [flags, pattern, sourceText])
  const extraction = useMemo(() => extractRegexMatches(result), [result])
  const currentResultRef = useRef<typeof result | null>(result)
  currentResultRef.current = result
  const activeRef = useRef(true)
  const actionEpochRef = useRef(0)
  const [actionEpoch, setActionEpoch] = useState(0)
  const handedOffResultRef = useRef<typeof result | null>(null)
  const [handedOffResult, setHandedOffResult] = useState<typeof result | null>(null)
  const [failedResult, setFailedResult] = useState<typeof result | null>(null)
  const sourceLines = sourceText ? sourceText.split('\n').length : 0

  useEffect(() => setActiveMatch(-1), [flags, pattern, sourceText])
  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false }
  }, [])

  // Revoke rendered actions immediately, before an input change commits a new render.
  const invalidateResult = () => {
    currentResultRef.current = null
    actionEpochRef.current += 1
    // Hidden native surfaces remain mounted. Refresh the current button while
    // permanently invalidating callbacks captured before leaving this view.
    setActionEpoch(actionEpochRef.current)
  }

  const toggleFlag = (flag: string) => {
    invalidateResult()
    setFlags((current) => {
      const values = new Set(current.split(''))
      if (values.has(flag)) values.delete(flag)
      else values.add(flag)
      return [...values].join('')
    })
  }

  const continueProcessing = () => {
    if (!activeRef.current || actionEpochRef.current !== actionEpoch || currentResultRef.current !== result || extraction.status !== 'ready' || handedOffResultRef.current === result) return
    handedOffResultRef.current = result
    setHandedOffResult(result)
    setFailedResult(null)
    try {
      host.returnToLauncherWithObject({ kind: 'text', text: extraction.text, source: 'tool-result' })
    } catch {
      if (handedOffResultRef.current === result) {
        handedOffResultRef.current = null
        setHandedOffResult((current) => current === result ? null : current)
      }
      if (activeRef.current && currentResultRef.current === result) setFailedResult(result)
    }
  }

  const revealMatch = (match: MatchResult, index: number) => {
    setActiveMatch(index)
    requestAnimationFrame(() => {
      const textarea = sourceRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(match.index, match.index + match.text.length)
    })
  }

  return (
    <section className="regex-tester-surface" aria-label={t('surface.title')}>
      <header className="regex-tester-surface__header">
        <IconButton type="button" label={t('surface.back')} onClick={() => { invalidateResult(); host.requestBack() }}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <strong>{t('surface.title')}</strong>
        <span>{t('surface.subtitle')}</span>
        <div className="regex-tester-surface__header-spacer" />
        <IconButton type="button" label={t('surface.close')} onClick={() => { invalidateResult(); host.close() }}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <div className="regex-tester-surface__controls">
        <label className="regex-tester-surface__expression">
          <span>{t('surface.expression')}</span>
          <div className="regex-tester-surface__pattern">
            <i aria-hidden="true">/</i>
            <input
              value={pattern}
              onChange={(event) => { invalidateResult(); setPattern(event.target.value) }}
              placeholder={t('panel.regex.pattern')}
              aria-label={t('panel.regex.pattern')}
              spellCheck={false}
              autoFocus
            />
            <i aria-hidden="true">/</i>
            <input
              className="regex-tester-surface__flags"
              value={flags}
              onChange={(event) => { invalidateResult(); setFlags(event.target.value) }}
              placeholder="g"
              aria-label={t('panel.regex.flags')}
              spellCheck={false}
            />
          </div>
        </label>
        <fieldset className="regex-tester-surface__flag-list">
          <legend>{t('surface.quickFlags')}</legend>
          {COMMON_FLAGS.map((flag) => (
            <button
              key={flag}
              type="button"
              className={flags.includes(flag) ? 'is-active' : undefined}
              aria-pressed={flags.includes(flag)}
              title={t(`surface.flag.${flag}`)}
              onClick={() => toggleFlag(flag)}
            >
              {flag}
            </button>
          ))}
        </fieldset>
      </div>

      <div className="regex-tester-surface__body">
        <label className="regex-tester-surface__pane regex-tester-surface__pane--source">
          <span className="regex-tester-surface__pane-header">
            <strong>{t('surface.sampleText')}</strong>
            <small>{t('surface.sourceStats', { lines: sourceLines, chars: sourceText.length })}</small>
          </span>
          <textarea
            ref={sourceRef}
            value={sourceText}
            onChange={(event) => { invalidateResult(); setSourceText(event.target.value) }}
            placeholder={t('surface.samplePlaceholder')}
            spellCheck={false}
          />
        </label>
        <div className="regex-tester-surface__pane">
          <span className="regex-tester-surface__pane-header">
            <strong>{t('surface.matches')}</strong>
            {!result.error && pattern ? (
              <small>{t(result.matches.length === 1 ? 'panel.regex.match' : 'panel.regex.matches', { count: result.matches.length })}</small>
            ) : null}
          </span>
          <div className="regex-tester-surface__matches">
            {result.error && (
              <div role="alert" className="regex-tester-surface__error">
                <strong>{t('error.invalid')}</strong>
                <code>{result.error}</code>
              </div>
            )}
            {!result.error && result.matches.length === 0 && (
              <div className="regex-tester-surface__empty">
                <span aria-hidden="true">.*</span>
                <strong>{pattern ? t('panel.regex.noMatches') : t('surface.enterPattern')}</strong>
                <p>{pattern ? t('surface.noMatchesHint') : t('surface.enterPatternHint')}</p>
              </div>
            )}
            {!result.error && result.matches.length > 0 && (
              <>
                {result.matches.slice(0, 100).map((match, index) => (
                  <button
                    key={`${match.index}:${index}`}
                    type="button"
                    className={activeMatch === index ? 'regex-tester-surface__match is-active' : 'regex-tester-surface__match'}
                    aria-label={t('surface.revealMatch', { line: match.line, col: match.col })}
                    onClick={() => revealMatch(match, index)}
                  >
                    <span className="regex-tester-surface__location">{match.line}:{match.col}</span>
                    <code>{match.text || t('surface.emptyGroup')}</code>
                    {match.groups.length > 0 ? (
                      <em>
                        <b>{t('surface.groups')}</b>
                        {match.groups.map((group) => group || t('surface.emptyGroup')).join(', ')}
                      </em>
                    ) : <em />}
                  </button>
                ))}
                {result.matches.length > 100 ? (
                  <div className="regex-tester-surface__more">
                    {t('panel.regex.more', { count: result.matches.length - 100 })}
                  </div>
                ) : null}
              </>
            )}
          </div>
          <footer className="regex-tester-surface__extract">
            <p>{t('surface.extractHint', { limit: MAX_REGEX_MATCHES })}</p>
            {extraction.status === 'empty-matches' ? <p role="status">{t('surface.emptyMatches')}</p> : null}
            {failedResult === result ? <p role="alert">{t('error.continueFailed')}</p> : null}
            <Button type="button" disabled={extraction.status !== 'ready' || handedOffResult === result} onClick={continueProcessing}>
              {t('surface.extractMatches', { count: result.matches.length })}
            </Button>
          </footer>
        </div>
      </div>
    </section>
  )
}
