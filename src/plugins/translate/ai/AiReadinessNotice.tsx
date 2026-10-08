import { Button } from '@hiven/plugin-ui'
import type { TranslateProfile } from '../settings/model'
import type { AiReadinessSnapshot } from './readiness'

export function AiReadinessNotice({ readiness, profile, t, onRefresh, onSettings, onAppSettings }: {
  readiness: AiReadinessSnapshot
  profile: TranslateProfile
  t: (key: string) => string
  onRefresh: () => void
  onSettings?: () => void
  onAppSettings?: () => void
}) {
  const result = readiness.result
  const provider = result?.providerName || result?.providerId || profile.aiProviderId || t('ai.unresolvedDefault')
  const model = result?.agentName || result?.agentId || profile.aiAgentId || t('ai.unresolvedDefault')
  const bindingMissing = !(result?.providerId || profile.aiProviderId) || !(result?.agentId || profile.aiAgentId)
  return (
    <div className="translate-ai-readiness" role="status" aria-live="polite" aria-busy={readiness.status === 'checking'} data-state={readiness.status}>
      <div className="translate-ai-readiness__details">
        <div className="translate-ai-readiness__selection">{t('ai.provider')}: {provider} · {t('ai.model')}: {model}</div>
        <div>{t(`ai.readiness.${readiness.reason}`)}</div>
        {readiness.status === 'unknown' && bindingMissing && readiness.reason !== 'selection_required' && <div>{t('ai.readiness.selection_required')}</div>}
        {result?.message && readiness.status !== 'ready' && <details><summary>{t('ai.diagnostic')}</summary><div>{result.message}</div></details>}
        {readiness.status === 'ready' && <div className="translate-ai-readiness__hint">{t('ai.readiness.scope')}</div>}
      </div>
      <div className="translate-ai-readiness__actions">
        <Button type="button" onClick={onRefresh} disabled={readiness.status === 'checking'}>{t('ai.recheck')}</Button>
        {onSettings && <Button type="button" onClick={onSettings}>{t('action.translationSettings')}</Button>}
        {onAppSettings && <Button type="button" onClick={onAppSettings}>{t('action.appAiSettings')}</Button>}
      </div>
    </div>
  )
}
