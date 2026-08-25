import { isSafeExperienceIdentifier } from '../contentBoundary'

const STORAGE_KEY = 'hiven:learning-candidate-suppressions:v1'

type CandidateSuppressions = {
  version: 1
  candidateKeys: string[]
  actionKeys: string[]
}

const EMPTY: CandidateSuppressions = { version: 1, candidateKeys: [], actionKeys: [] }

function storage(): Storage | null {
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function readCandidateSuppressions(): CandidateSuppressions {
  try {
    const parsed = JSON.parse(storage()?.getItem(STORAGE_KEY) ?? 'null') as Partial<CandidateSuppressions> | null
    if (
      parsed?.version !== 1 ||
      !Array.isArray(parsed.candidateKeys) ||
      !parsed.candidateKeys.every((value) => typeof value === 'string' && /^candidate_[0-9a-f]{16}$/.test(value)) ||
      !Array.isArray(parsed.actionKeys) ||
      !parsed.actionKeys.every((value) => typeof value === 'string' && isSafeExperienceIdentifier(value))
    ) return EMPTY
    return { version: 1, candidateKeys: [...new Set(parsed.candidateKeys)], actionKeys: [...new Set(parsed.actionKeys)] }
  } catch {
    return EMPTY
  }
}

export function suppressCandidate(candidateKey: string): void {
  const state = readCandidateSuppressions()
  storage()?.setItem(STORAGE_KEY, JSON.stringify({
    ...state,
    candidateKeys: [...new Set([...state.candidateKeys, candidateKey])],
  }))
}

export function disableActionLearning(actionKey: string): void {
  const state = readCandidateSuppressions()
  storage()?.setItem(STORAGE_KEY, JSON.stringify({
    ...state,
    actionKeys: [...new Set([...state.actionKeys, actionKey])],
  }))
}
