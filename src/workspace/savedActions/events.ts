import {
  appendExperienceEvent,
  currentExperienceSessionId,
  newExperienceId,
} from '../experience/journal'
import type { SavedActionV1 } from './types'

const fallbackSessionId = newExperienceId('session')

export function recordSavedActionEvent(
  eventType: 'artifact.saved' | 'artifact.deleted',
  artifact: SavedActionV1,
): void {
  appendExperienceEvent({
    eventId: newExperienceId('event'),
    ts: Date.now(),
    sessionId: currentExperienceSessionId(fallbackSessionId),
    eventType,
    actionKey: artifact.baseActionKey,
    artifactId: artifact.id,
    inputBinding: artifact.inputBinding,
    outputIntent: artifact.outputIntent,
  })
}
