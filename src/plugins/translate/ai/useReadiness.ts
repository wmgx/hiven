import { useLayoutEffect, useState, useSyncExternalStore } from 'react'
import type { PluginAiApi } from '@hiven/plugin'
import type { TranslateProfile } from '../settings/model'
import { AiTranslationReadiness, aiSelectionKey, type AiReadinessSnapshot } from './readiness'

export function useAiTranslationReadiness(ai: PluginAiApi, profile: TranslateProfile | undefined, includeProviders = false) {
  const [controller] = useState(() => new AiTranslationReadiness(includeProviders))
  const selection = profile?.provider === 'ai' ? profile : undefined
  const key = aiSelectionKey(selection)
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot)
  useLayoutEffect(() => {
    controller.setAi(ai)
    controller.setSelection(selection)
    void controller.refresh()
  }, [controller, ai, key])
  useLayoutEffect(() => () => controller.dispose(), [controller])
  // Reject an old wrapper/selection during render, before layout effects rebind it.
  const readiness: AiReadinessSnapshot = controller.matches(ai, selection)
    ? snapshot
    : { revision: snapshot.revision + 1, status: 'checking', reason: 'checking', providers: [] }
  return { controller, readiness }
}
