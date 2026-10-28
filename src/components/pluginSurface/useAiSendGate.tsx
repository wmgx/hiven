import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { SurfaceError } from '../../ui/SurfaceHeaderActions'
import { useT } from '../../i18n'
import type { PluginAiApi, AiPreflightResult } from '../../workspace/ai/types'
import type { PluginAiSendGate } from '../../workspace/pluginTypes'
import { aiTargetName, aiSendCharCount, aiUnavailableReasonKey, decideAiSend, type AiSendRequest } from '../../workspace/ai/sendGate'

function AiDisclosure({ ai, request, remember }: { ai: PluginAiApi | undefined; request: AiSendRequest; remember(selection?: AiPreflightResult): void }) {
  const t = useT('aiSendGate')
  const [target, setTarget] = useState<AiPreflightResult>()
  const preflight = JSON.stringify(request.preflight ?? { capabilities: ['text.generate'], inputModalities: ['text'] })
  useEffect(() => {
    let live = true
    let revision = 0
    const refresh = async () => {
      const token = ++revision
      setTarget(undefined); remember(undefined)
      try {
        const selection = await ai?.preflight?.(JSON.parse(preflight))
        if (live && token === revision) { setTarget(selection); remember(selection) }
      } catch { /* Unavailable metadata never authorizes a send. */ }
    }
    void refresh()
    const stop = ai?.subscribePreflight?.(() => { void refresh() })
    return () => { live = false; remember(undefined); stop?.() }
  }, [ai, preflight, remember])
  return <p className="ai-send-disclosure">{target?.status === 'ready'
    ? t('willSend', { count: aiSendCharCount(request), target: aiTargetName(target) })
    : target ? t('unavailable', { reason: t(aiUnavailableReasonKey(target.reason)) }) : t('checking')}</p>
}

/** Readiness and secret guard; the visible page/button is the user's send confirmation. */
export function useAiSendGate({ ai, isCurrent, openAiSettings }: {
  pluginId: string; ai: PluginAiApi | undefined; isCurrent(): boolean; openAiSettings?: () => void
}): { gate: PluginAiSendGate; layer: ReactNode } {
  const t = useT('aiSendGate')
  const [error, setError] = useState('')
  useEffect(() => {
    if (!error) return
    const clear = () => setError('')
    for (const event of ['input', 'pointerdown', 'keydown']) document.addEventListener(event, clear, true)
    return () => { for (const event of ['input', 'pointerdown', 'keydown']) document.removeEventListener(event, clear, true) }
  }, [error])
  const gate = useMemo<PluginAiSendGate>(() => {
    const targets = new Map<string, AiPreflightResult>()
    const Disclosure: PluginAiSendGate['Disclosure'] = ({ request }) => {
      const remember = useMemo(() => (selection?: AiPreflightResult) => {
        if (selection) targets.set(request.commandId, selection); else targets.delete(request.commandId)
      }, [request.commandId])
      return <AiDisclosure ai={ai} request={request} remember={remember} />
    }
    return { Disclosure, async request(send, options) {
      if (!isCurrent() || options?.signal?.aborted) return null
      setError('')
      if (!decideAiSend(send).allowed) { setError(t('secret')); return null }
      let selection = send.selection
      try { selection ??= await ai?.preflight?.(send.preflight ?? { capabilities: ['text.generate'], inputModalities: ['text'] }) } catch { /* Display unavailable below. */ }
      if (!isCurrent() || options?.signal?.aborted) return null
      if (!selection || selection.status !== 'ready' || !selection.providerId || !selection.agentId) {
        setError(t('unavailable', { reason: t(aiUnavailableReasonKey(selection?.reason ?? 'metadata_unavailable')) })); return null
      }
      if (!send.selection && targets.get(send.commandId)?.selectionKey !== selection.selectionKey) { setError(t('reason.changed')); return null }
      return { selection }
    } }
  }, [ai, isCurrent, t])
  return { gate, layer: <SurfaceError>{error}{error && openAiSettings && <button type="button" onClick={openAiSettings}>{t('openSettings')}</button>}</SurfaceError> }
}
