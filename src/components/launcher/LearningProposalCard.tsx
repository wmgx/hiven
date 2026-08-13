/**
 * LearningProposalCard — first user-visible self-learning surface (P2c).
 *
 * When the launcher opens with an empty query and the learner has a confident
 * rule candidate (≥3 distinct inputs verified to the same transform, not
 * over-broad, not already learned/rejected), this card asks — exactly once —
 * whether to make it a direct answer. Mouse-driven (explicit Accept / Reject),
 * deliberately kept OUT of the arrow-key model so it can't regress the tuned
 * launcher navigation. All copy is i18n; the transform names resolve from the
 * registry in the current locale (never persisted).
 *
 * See doc/2026-08-12-direct-answer-workbench-design.md §8 (P2).
 */

import { useEffect, useState } from 'react'
import { Check, Sparkles, X } from 'lucide-react'
import { t, type Locale } from '../../i18n'
import type { RuleCandidate } from '../../workspace/learning/cluster'
import {
  acceptProposal,
  getPendingProposals,
  rejectProposal,
} from '../../workspace/learning/learningController'
import { matcherShapeLabel, transformBodyKey, transformLabel } from './learningLabels'

export function LearningProposalCard({ locale }: { locale: Locale }) {
  const [candidate, setCandidate] = useState<RuleCandidate | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void getPendingProposals()
      .then((proposals) => {
        if (!cancelled) setCandidate(proposals[0] ?? null)
      })
      .catch(() => {
        // fail-soft: no card
      })
    return () => {
      cancelled = true
    }
  }, [])

  if (!candidate) return null

  const body = t(locale, transformBodyKey(candidate.transform), {
    shape: matcherShapeLabel(candidate.matcher, locale),
    transform: transformLabel(candidate.transform, locale),
  })

  const onAccept = () => {
    if (busy) return
    setBusy(true)
    void acceptProposal(candidate).finally(() => setCandidate(null))
  }
  const onReject = () => {
    if (busy) return
    setBusy(true)
    void rejectProposal(candidate.clusterKey).finally(() => setCandidate(null))
  }

  return (
    <div className="learn-proposal-card" data-testid="learn-proposal-card">
      <div className="learn-proposal-icon" aria-hidden="true">
        <Sparkles size={16} strokeWidth={2} />
      </div>
      <div className="learn-proposal-body">
        <span className="learn-proposal-title">{t(locale, 'palette.learnProposalTitle')}</span>
        <span className="learn-proposal-desc">{body}</span>
      </div>
      <div className="learn-proposal-actions">
        <button
          type="button"
          className="learn-proposal-accept"
          onClick={onAccept}
          disabled={busy}
        >
          <Check size={13} strokeWidth={2.4} aria-hidden="true" />
          {t(locale, 'palette.learnProposalAccept')}
        </button>
        <button
          type="button"
          className="learn-proposal-reject"
          onClick={onReject}
          disabled={busy}
          aria-label={t(locale, 'palette.learnProposalReject')}
        >
          <X size={13} strokeWidth={2.4} aria-hidden="true" />
          {t(locale, 'palette.learnProposalReject')}
        </button>
      </div>
    </div>
  )
}
