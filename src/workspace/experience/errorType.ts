import type { ExperienceErrorType, ExperienceRunStatus } from './types'

export function classifyExperienceError(
  error: unknown,
  fallback: ExperienceErrorType,
): { status: ExperienceRunStatus; errorType?: ExperienceErrorType } {
  if (error instanceof Error && error.name === 'AbortError') return { status: 'cancelled' }
  const message = error instanceof Error ? error.message : String(error)
  if (/permission|access denied|not authorized|missing.scope/i.test(message)) {
    return { status: 'failed', errorType: 'permission-denied' }
  }
  if (/timeout|timed out/i.test(message)) return { status: 'failed', errorType: 'timeout' }
  if (/validation|invalid|required/i.test(message)) return { status: 'failed', errorType: 'validation' }
  return { status: 'failed', errorType: fallback }
}
