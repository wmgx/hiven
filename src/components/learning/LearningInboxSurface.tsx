import { useEffect, useMemo, useState } from 'react'
import { t, type Locale } from '../../i18n'
import { useAppStore } from '../../store'
import { recordCandidateSurfaced } from '../../workspace/experience/candidateEvents'
import {
  dismissLearningCandidate,
  loadLearningCandidates,
  saveLearningCandidate,
} from '../../workspace/experience/learningInbox'
import type { LearningCandidate } from '../../workspace/experience/miner'

function localizedTitle(candidate: LearningCandidate, locale: Locale): string {
  return candidate.actionTitleI18n?.[locale] ?? candidate.actionTitle
}

function paramsSummary(candidate: LearningCandidate, locale: Locale): string {
  return Object.entries(candidate.savedParams)
    .map(([key, value]) => {
      const label = candidate.paramLabels[key]
      return `${label?.labelI18n?.[locale] ?? label?.label ?? key}: ${typeof value === 'string' || Array.isArray(value) ? JSON.stringify(value) : String(value)}`
    })
    .join(' · ')
}

export function LearningInboxSurface() {
  const locale = useAppStore((state) => state.locale)
  const [candidates, setCandidates] = useState<LearningCandidate[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [aliases, setAliases] = useState('')
  const [saveFailed, setSaveFailed] = useState(false)

  useEffect(() => {
    let cancelled = false
    void loadLearningCandidates().then((next) => {
      if (cancelled) return
      setCandidates(next)
      setLoading(false)
    }).catch(() => {
      if (cancelled) return
      setFailed(true)
      setLoading(false)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    for (const candidate of candidates) recordCandidateSurfaced(candidate)
  }, [candidates])

  const remove = (candidate: LearningCandidate, actionWide = false) => {
    setCandidates((current) => current.filter((entry) => actionWide
      ? entry.actionKey !== candidate.actionKey
      : entry.candidateKey !== candidate.candidateKey))
    setEditing(null)
  }

  const content = useMemo(() => {
    if (loading) return <div className="learning-inbox-state">{t(locale, 'palette.learningInboxLoading')}</div>
    if (failed) return <div className="learning-inbox-state">{t(locale, 'palette.learningInboxLoadFailed')}</div>
    if (!candidates.length) return <div className="learning-inbox-state">{t(locale, 'palette.learningInboxEmpty')}</div>
    return candidates.map((candidate) => (
      <article className="learning-candidate-card" key={candidate.candidateKey}>
        <div className="learning-candidate-heading">
          <strong>{localizedTitle(candidate, locale)}</strong>
          <span>{paramsSummary(candidate, locale) || t(locale, 'palette.learningInboxDefaultParams')}</span>
        </div>
        <dl className="learning-candidate-details">
          <div><dt>{t(locale, 'palette.learningInboxInput')}</dt><dd>{t(locale, `palette.learningInput.${candidate.inputBinding}`)}</dd></div>
          <div><dt>{t(locale, 'palette.learningInboxOutput')}</dt><dd>{t(locale, `palette.learningOutput.${candidate.outputIntent}`)}</dd></div>
        </dl>
        <p className="learning-candidate-evidence">
          {t(locale, 'palette.learningInboxEvidence', {
            runs: candidate.occurrences,
            inputs: candidate.distinctInputs,
            days: candidate.dayCount,
          })}
        </p>
        {editing === candidate.candidateKey ? (
          <form
            className="learning-candidate-save-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (!name.trim()) return
              try {
                saveLearningCandidate(candidate, name, aliases.split(','))
                remove(candidate)
                setName('')
                setAliases('')
                setSaveFailed(false)
              } catch {
                setSaveFailed(true)
              }
            }}
          >
            <input
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t(locale, 'palette.learningInboxNamePlaceholder')}
              aria-label={t(locale, 'palette.learningInboxNamePlaceholder')}
            />
            <input
              value={aliases}
              onChange={(event) => setAliases(event.target.value)}
              placeholder={t(locale, 'palette.learningInboxAliasesPlaceholder')}
              aria-label={t(locale, 'palette.learningInboxAliasesPlaceholder')}
            />
            <button type="submit" disabled={!name.trim()}>{t(locale, 'palette.learningInboxConfirmSave')}</button>
            <button type="button" onClick={() => setEditing(null)}>{t(locale, 'palette.learningInboxCancel')}</button>
            {saveFailed ? <span role="alert">{t(locale, 'palette.savedActionSaveFailed')}</span> : null}
          </form>
        ) : (
          <div className="learning-candidate-actions">
            <button type="button" onClick={() => { setEditing(candidate.candidateKey); setName(''); setAliases(''); setSaveFailed(false) }}>
              {t(locale, 'palette.learningInboxSave')}
            </button>
            <button type="button" onClick={() => { dismissLearningCandidate(candidate, 'ignore-once'); remove(candidate) }}>
              {t(locale, 'palette.learningInboxIgnore')}
            </button>
            <button type="button" onClick={() => { dismissLearningCandidate(candidate, 'suppress-cluster'); remove(candidate) }}>
              {t(locale, 'palette.learningInboxSuppress')}
            </button>
            <button type="button" onClick={() => { dismissLearningCandidate(candidate, 'disable-action-learning'); remove(candidate, true) }}>
              {t(locale, 'palette.learningInboxDisableAction')}
            </button>
          </div>
        )}
      </article>
    ))
  }, [aliases, candidates, editing, failed, loading, locale, name])

  return <div className="learning-inbox-surface">{content}</div>
}
