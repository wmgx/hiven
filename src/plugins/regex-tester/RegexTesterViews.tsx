import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { SurfaceHeaderField, SurfaceHeaderActions, SurfaceStatus, SurfaceError, ActionBar, ValueChip, ToggleGroup, RowList, EmptyState, TextArea, TextInput } from '@hiven/plugin-ui'
import { MAX_REGEX_MATCHES, type MatchResult } from './regexCore'
import { useRegexExecution } from './useRegexExecution'
import { extractRegexMatches, type RegexExtractionTarget } from './extractMatches'
import { createAiCandidateSession, type AiCandidateState } from './aiCandidateSession'
import { AiCandidateControls } from './AiCandidateControls'

const COMMON_FLAGS = ['g', 'i', 'm', 's', 'u', 'd', 'v', 'y'] as const

export function RegexTesterSurface(props: PluginSurfaceProps) {
  const { host, t } = props
  const baseline = useRef({
    pattern: '[a-z]+',
    flags: 'g',
    sourceText: props.initialText ?? '',
  })
  const [aiOpen, setAiOpen] = useState(false)
  const [pattern, setPattern] = useState(baseline.current.pattern)
  const [flags, setFlags] = useState(baseline.current.flags)
  const [sourceText, setSourceText] = useState(baseline.current.sourceText)
  useEffect(() => {
    let live = true
    if (!props.initialText) void host.clipboard.readText().then(text => { if (live) setSourceText(previous => previous || text) }).catch(() => {})
    return () => { live = false }
  }, [])
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
      <SurfaceHeaderField><TextInput value={pattern} onChange={event => { invalidateResult(); setPattern(event.target.value) }} placeholder={t('panel.regex.pattern')} aria-label={t('panel.regex.pattern')} spellCheck={false} autoFocus data-plugin-surface-autofocus={aiOpen ? undefined : 'sticky'} /></SurfaceHeaderField>
      <SurfaceHeaderActions>
        <ToggleGroup aria-label={t('surface.quickFlags')} value={flags.split('')} options={COMMON_FLAGS.map(value => ({ value, label: value }))} onChange={values => { invalidateResult(); setFlags(values.join('')) }} />
        <ValueChip label={t('surface.extractTarget')} value={extractionTarget}
          options={extractionOptions.some(option => option.value === extractionTarget) ? extractionOptions : [...extractionOptions, { value: extractionTarget, label: t('surface.unavailableGroup') }]}
          onChange={value => { invalidateResult(false); setExtractionTarget(value as RegexExtractionTarget) }} onPreview={value => { invalidateResult(false); setExtractionTarget(value as RegexExtractionTarget) }} />
      </SurfaceHeaderActions>
      <SurfaceError>{['invalid','timeout','failed'].includes(result.status) ? <span>{t(result.status === 'invalid' ? 'error.invalid' : `execution.${result.status}`)}{result.status === 'invalid' && <code> · {result.error}</code>}</span>
        : ['missing-group','empty-group','truncated','too-large'].includes(extraction.status) ? t(`extraction.${extraction.status}`, { limit: MAX_REGEX_MATCHES }) : null}</SurfaceError>
      <SurfaceStatus>{result.status === 'running' || result.status === 'cancelled' ? t(`execution.${result.status}`) : extraction.status === 'empty-matches' ? t('surface.emptyMatches') : t('panel.regex.matches', { count: result.matches.length })}</SurfaceStatus>
      <AiCandidateControls open={aiOpen} close={() => { aiSession.current?.invalidate(); setAiOpen(false) }}
        host={host} t={t} state={aiState}
        invalidate={() => aiSession.current?.invalidate()}
        generate={(input, selection) => { if (host.deliveryFeedbackOwner?.isCurrent() !== false) void aiSession.current?.generate(input, selection) }}
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
            {result.status === 'ready' && result.matches.length === 0 && (
              <EmptyState title={pattern ? t('panel.regex.noMatches') : t('surface.enterPattern')} hint={`⌘K · ${t('ai.title')}`} />
            )}
            {result.status === 'ready' && result.matches.length > 0 && (
              <>
                <RowList label={t('surface.matches')} selectedId={String(activeMatch)} onSelect={id => setActiveMatch(Number(id))}
                  onActivate={id => { const index = Number(id); const match = result.matches[index]; if (match) revealMatch(match, index) }}
                  items={result.matches.slice(0, 100).map((match, index) => ({ id: String(index), title: match.text || t('surface.emptyGroup'), description: `${match.line}:${match.col}${match.groups.length ? ` · ${t('surface.groups')}: ${match.groups.map(group => group === undefined ? t('surface.missingGroup') : group || t('surface.emptyGroup')).join(', ')}` : ''}` }))} />
                {result.matches.length > 100 ? (
                  <div className="regex-tester-surface__more">
                    {t('panel.regex.more', { count: result.matches.length - 100 })}
                  </div>
                ) : null}
              </>
            )}
          </div>
        </div>
      </div>
      <ActionBar>{host.OutputActions && <host.OutputActions text={extraction.status === 'ready' ? extraction.text : ''}
        more={[{ id: 'ai', label: t('ai.title'), run: () => setAiOpen(true) }]} />}</ActionBar>
    </section>
  )
}
