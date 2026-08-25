import {
  appendExperienceEvent,
  currentExperienceSessionId,
  newExperienceId,
} from './journal'
import type { CandidateDecision } from './types'
import type { LearningCandidate } from './miner'
import { shouldRecordCandidateSurface } from './candidateSurfaceDedupe'

const fallbackSessionId = newExperienceId('session')

export function recordCandidateSurfaced(candidate: LearningCandidate): void {
  const sessionId = currentExperienceSessionId(fallbackSessionId)
  if (!shouldRecordCandidateSurface(sessionId, candidate.candidateKey)) return
  appendExperienceEvent({
    eventId: newExperienceId('event'),
    ts: Date.now(),
    sessionId,
    eventType: 'candidate.surfaced',
    actionKey: candidate.actionKey,
    candidateKey: candidate.candidateKey,
  })
}

export function recordCandidateDismissed(candidate: LearningCandidate, decision: CandidateDecision): void {
  appendExperienceEvent({
    eventId: newExperienceId('event'),
    ts: Date.now(),
    sessionId: currentExperienceSessionId(fallbackSessionId),
    eventType: 'candidate.dismissed',
    actionKey: candidate.actionKey,
    candidateKey: candidate.candidateKey,
    candidateDecision: decision,
  })
}
