import type { CommitVia, InputBinding, LauncherSurfaceId, OutputIntent } from '../launcher/types'

export type ExperienceEventType =
  | 'run.started'
  | 'run.finished'
  | 'output.applied'
  | 'artifact.saved'
  | 'artifact.invoked'
  | 'artifact.deleted'
  | 'candidate.surfaced'
  | 'candidate.dismissed'

export type ExperienceRunStatus = 'success' | 'failed' | 'cancelled'

export type ExperienceErrorType =
  | 'permission-denied'
  | 'timeout'
  | 'validation'
  | 'provider-failed'
  | 'output-failed'
  | 'unknown'

export type CandidateDecision =
  | 'ignore-once'
  | 'suppress-cluster'
  | 'disable-action-learning'

export type ExperienceEvent = {
  eventId: string
  ts: number
  sessionId: string
  runId?: string
  eventType: ExperienceEventType
  actionKey?: string
  surfaceId?: LauncherSurfaceId
  via?: CommitVia
  status?: ExperienceRunStatus
  errorType?: ExperienceErrorType
  inputBinding?: InputBinding
  inputFingerprint?: string
  paramSignature?: string
  safeParamsJson?: string
  outputIntent?: OutputIntent
  outputApplication?: 'explicit'
  artifactId?: string
  candidateKey?: string
  candidateDecision?: CandidateDecision
}
