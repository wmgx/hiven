import { collectStaticCandidates } from '../launcher/registry'
import { exportExperienceEvents } from './journal'
import { mineLearningCandidates, type ExperienceEventRecord, type LearningCandidate } from './miner'
import { disableActionLearning, readCandidateSuppressions, suppressCandidate } from './candidateSuppressions'
import { recordCandidateDismissed } from './candidateEvents'
import { createSavedAction, listSavedActions } from '../savedActions/store'
import { recordSavedActionEvent } from '../savedActions/events'
import type { CandidateDecision } from './types'

export async function loadLearningCandidates(): Promise<LearningCandidate[]> {
  const raw = JSON.parse(await exportExperienceEvents()) as unknown
  const events = Array.isArray(raw) ? raw as ExperienceEventRecord[] : []
  const suppressions = readCandidateSuppressions()
  return mineLearningCandidates({
    events,
    baseItems: collectStaticCandidates('global-launcher'),
    savedActions: listSavedActions(),
    suppressedCandidateKeys: new Set(suppressions.candidateKeys),
    disabledActionKeys: new Set(suppressions.actionKeys),
  })
}

export function saveLearningCandidate(candidate: LearningCandidate, name: string, aliases: string[] = []): void {
  const artifact = createSavedAction({
    status: 'ready',
    runId: candidate.candidateKey,
    actionKey: candidate.actionKey,
    savedParams: candidate.savedParams,
    inputBinding: candidate.inputBinding,
    outputIntent: candidate.outputIntent,
    contractFingerprint: candidate.contractFingerprint,
    actionPolicy: candidate.actionPolicy,
    completedAt: Date.now(),
  }, name, aliases)
  recordSavedActionEvent('artifact.saved', artifact, candidate.candidateKey)
}

export function dismissLearningCandidate(candidate: LearningCandidate, decision: CandidateDecision): void {
  recordCandidateDismissed(candidate, decision)
  if (decision === 'suppress-cluster') suppressCandidate(candidate.candidateKey)
  if (decision === 'disable-action-learning') disableActionLearning(candidate.actionKey)
}
