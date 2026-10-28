import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, Select, TextArea, TextInput } from '@hiven/plugin-ui'
import { MAX_REGEX_MATCHES, type MatchResult } from './regexCore'
import { useRegexExecution } from './useRegexExecution'
import { extractRegexMatches, type RegexExtractionTarget } from './extractMatches'
import { createAiCandidateSession, type AiCandidateState } from './aiCandidateSession'
import { AiCandidateControls } from './AiCandidateControls'

const COMMON_FLAGS = ['g', 'i', 'm', 's', 'u'] as const

export function RegexTesterSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const baseline = useRef({
    pattern: '[a-z]+',
    flags: 'g',
    sourceText: props.initialText ?? 'hello 123\nworld 456',
  })
  const [pattern, setPattern] = useState(baseline.current.pattern)
  const [flags, setFlags] = useState(baseline.current.flags)
  const [sourceText, setSourceText] = useState(baseline.current.sourceText)
  const [aiState, setAiState] = useState<AiCandidateState>({ status: 'idle' })
  const aiSession = useRef<ReturnType<typeof createAiCandidateSession> | null>(null)
  useLayoutEffect(() => {
    const session = createAiCandidateSession(host.ai, setAiState)
    aiSession.current = session
    setAiState({ status: 'idle' })
    const unsubscribe = host.deliveryFeedbackOwner?.subscribeInvalidation(() => session.invalidate())
    return () => { unsubscribe?.(); session.dispose(); aiSession.current = null }
  }, [host.ai, host.deliveryFeedbackOwner])
  useLayoutEffect(() => { aiSession.current?.invalidate() }, [props.initialText])
  const [activeMatch, setActiveMatch] = useState(-1)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const execution = useRegexExecution(pattern, flags, sourceText, host.deliveryFeedbackOwner)
  const result = execution.result
  const [extractionTarget, setExtractionTarget] = useState<RegexExtractionTarget>('whole')
  const extractionOptions = useMemo(() => [
    { value: 'whole', label: t('surface.wholeMatch') },
    ...Array.from({ length: result.matches[0]?.groups.length ?? 0 }, (_, index) => ({
      value: `group:${index + 1}`, label: t('surface.captureGroup', { number: index + 1 }),
    })),
    ...Object.keys(result.matches[0]?.namedGroups ?? {}).map((name) => ({
      value: `name:${name}`, label: t('surface.namedGroup', { name }),
    })),
  ], [result, t])
  const extraction = useMemo(() => result.status === 'ready' ? extractRegexMatches(result, extractionTarget) : { status: 'invalid' as const, text: '' }, [result, extractionTarget])
  const currentResultRef = useRef<typeof result | null>(result)
  currentResultRef.current = result
  const activeRef = useRef(true)
  const actionEpochRef = useRef(0)
  const [actionEpoch, setActionEpoch] = useState(0)
  const sourceLines = sourceText ? sourceText.split('\n').length : 0

  useEffect(() => setActiveMatch(-1), [flags, pattern, sourceText])
  useEffect(() => {
    activeRef.current = true
    return () => { activeRef.current = false }
  }, [])

  // Revoke rendered actions immediately, before an input change commits a new render.
  const invalidateResult = (cancelExecution = true) => {
    aiSession.current?.invalidate()
    if (cancelExecution) execution.cancel()
    currentResultRef.current = null
    actionEpochRef.current += 1
    // Hidden native surfaces remain mounted. Refresh the current button while
    // permanently invalidating callbacks captured before leaving this view.
    setActionEpoch(actionEpochRef.current)
  }

  useLayoutEffect(() => host.deliveryFeedbackOwner?.subscribeInvalidation(() => invalidateResult(false)), [host.deliveryFeedbackOwner])
  useLayoutEffect(() => host.subscribeLeaveIntent?.(() => invalidateResult()), [host.subscribeLeaveIntent])

  const toggleFlag = (flag: string) => {
    invalidateResult()
    setFlags((current) => {
      const values = new Set(current.split(''))
      if (values.has(flag)) values.delete(flag)
      else values.add(flag)
      return [...values].join('')
    })
  }

  const revealMatch = (match: MatchResult, index: number) => {
    setActiveMatch(index)
    requestAnimationFrame(() => {
      if (!activeRef.current || currentResultRef.current !== result || actionEpochRef.current !== actionEpoch) return
      const textarea = sourceRef.current
      if (!textarea) return
      textarea.focus()
      textarea.setSelectionRange(match.index, match.index + match.text.length)
    })
  }

  return (
    <section className="regex-tester-surface" aria-label={t('surface.title')}>
      <div className="regex-tester-surface__controls">
        <label className="regex-tester-surface__expression">
          <span>{t('surface.expression')}</span>
          <div className="regex-tester-surface__pattern">
            <i aria-hidden="true">/</i>
            <TextInput
              value={pattern}
              onChange={(event) => { invalidateResult(); setPattern(event.target.value) }}
              placeholder={t('panel.regex.pattern')}
              aria-label={t('panel.regex.pattern')}
              spellCheck={false}
              autoFocus
            />
            <i aria-hidden="true">/</i>
            <TextInput
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
            <Button
              key={flag}
              type="button"
              variant={flags.includes(flag) ? 'primary' : 'secondary'}
              aria-pressed={flags.includes(flag)}
              title={t(`surface.flag.${flag}`)}
              onClick={() => toggleFlag(flag)}
            >
              {flag}
            </Button>
          ))}
        </fieldset>
      </div>

      <AiCandidateControls
        host={host} t={t} state={aiState}
        invalidate={() => aiSession.current?.invalidate()}
        generate={(input) => { if (host.deliveryFeedbackOwner?.isCurrent() !== false) void aiSession.current?.generate(input) }}
        cancel={() => aiSession.current?.cancel()}
        adopt={() => {
          if (host.deliveryFeedbackOwner?.isCurrent() === false) return
          const candidate = aiSession.current?.adopt()
          if (!candidate) return
          invalidateResult()
          setPattern(candidate.pattern)
          setFlags(candidate.flags)
        }}
      />

      <div className="regex-tester-surface__body">
        <label className="regex-tester-surface__pane regex-tester-surface__pane--source">
          <span className="regex-tester-surface__pane-header">
            <strong>{t('surface.sampleText')}</strong>
            <small>{t('surface.sourceStats', { lines: sourceLines, chars: sourceText.length })}</small>
          </span>
          <TextArea
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
            {result.status === 'ready' && pattern ? (
              <small>{t(result.matches.length === 1 ? 'panel.regex.match' : 'panel.regex.matches', { count: result.matches.length })}</small>
            ) : null}
          </span>
          <div className="regex-tester-surface__matches" aria-live="polite">
            {result.status === 'running' || result.status === 'cancelled' ? <p role="status">{t(`execution.${result.status}`)}</p> : null}
            {(result.status === 'invalid' || result.status === 'timeout' || result.status === 'failed') && (
              <div role="alert" className="regex-tester-surface__error">
                <strong>{t(result.status === 'invalid' ? 'error.invalid' : `execution.${result.status}`)}</strong>
                {result.status === 'invalid' ? <code>{result.error}</code> : null}
              </div>
            )}
            {result.status === 'ready' && result.matches.length === 0 && (
              <div className="regex-tester-surface__empty">
                <span aria-hidden="true">.*</span>
                <strong>{pattern ? t('panel.regex.noMatches') : t('surface.enterPattern')}</strong>
              </div>
            )}
            {result.status === 'ready' && result.matches.length > 0 && (
              <>
                {result.matches.slice(0, 100).map((match, index) => (
                  <Button
                    key={`${match.index}:${index}`}
                    type="button"
                    variant="ghost"
                    className={activeMatch === index ? 'regex-tester-surface__match is-active' : 'regex-tester-surface__match'}
                    aria-label={t('surface.revealMatch', { line: match.line, col: match.col })}
                    onClick={() => revealMatch(match, index)}
                  >
                    <span className="regex-tester-surface__location">{match.line}:{match.col}</span>
                    <code>{match.text || t('surface.emptyGroup')}</code>
                    {match.groups.length > 0 ? (
                      <em>
                        <b>{t('surface.groups')}</b>
                        {match.groups.map((group) => group === undefined ? t('surface.missingGroup') : group === '' ? t('surface.emptyGroup') : group).join(', ')}
                      </em>
                    ) : <em />}
                  </Button>
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
            <Select aria-label={t('surface.extractTarget')} value={extractionTarget}
              options={extractionOptions.some((option) => option.value === extractionTarget) ? extractionOptions : [
                ...extractionOptions, { value: extractionTarget, label: t('surface.unavailableGroup') },
              ]}
              onChange={(event) => { invalidateResult(false); setExtractionTarget(event.currentTarget.value as RegexExtractionTarget) }} />
            {extraction.status === 'empty-matches' ? <p role="status">{t('surface.emptyMatches')}</p> : null}
            {['missing-group', 'empty-group', 'truncated', 'too-large'].includes(extraction.status) ? <p role="alert">{t(`extraction.${extraction.status}`, { limit: MAX_REGEX_MATCHES })}</p> : null}
            {host.OutputActions && <host.OutputActions text={extraction.status === 'ready' ? extraction.text : ''} />}
          </footer>
        </div>
      </div>
    </section>
  )
}
