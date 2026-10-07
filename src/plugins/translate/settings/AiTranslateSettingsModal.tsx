import { useState, type ReactNode } from 'react'
import type { PluginSettingsModalBodyProps } from '@hiven/plugin'
import { Select } from '@hiven/plugin-ui'
import type { TranslateProfile, TranslateSettings } from './model'
import { keepSelectedOption } from '../ai/readiness'
import { useAiTranslationReadiness } from '../ai/useReadiness'
import { AiReadinessNotice } from '../ai/AiReadinessNotice'

const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const

export function AiTranslateSettingsModal({ value, setValue, host, t }: PluginSettingsModalBodyProps<TranslateSettings>) {
  const profiles = value.profiles.filter((profile) => profile.provider === 'ai')
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '')
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0]
  const { controller, readiness } = useAiTranslationReadiness(host.ai, profile, true)
  const providers = readiness.providers
  const selectedProvider = providers.find((item) => item.id === (profile?.aiProviderId || readiness.result?.providerId))
  const selectedAgent = selectedProvider?.agents.find((item) => item.id === (profile?.aiAgentId || readiness.result?.agentId))
  const efforts = selectedAgent?.supportedEfforts ?? []
  const missing = (id: string) => t('ai.savedUnavailable').replace('{value}', id)

  const updateProfile = (patch: Partial<TranslateProfile>) => {
    if (!profile) return
    setValue({ ...value, profiles: value.profiles.map((item) => item.id === profile.id ? { ...item, ...patch } : item) })
  }

  if (!profile) return <p className="text-[12px] text-muted-foreground">{t('ai.unavailable')}</p>
  const providerOptions = keepSelectedOption([
    { value: '', label: t('ai.inherit') },
    ...providers.map((item) => ({ value: item.id, label: `${item.name} · ${t(`ai.providerStatus.${item.status}`)}` })),
  ], profile.aiProviderId || '', missing(profile.aiProviderId || ''))
  const agentOptions = keepSelectedOption([
    { value: '', label: t('ai.inherit') },
    ...(selectedProvider?.agents ?? []).map((item) => ({ value: item.id, label: item.name })),
  ], profile.aiAgentId || '', missing(profile.aiAgentId || ''))
  const effortOptions = keepSelectedOption([
    { value: 'inherit', label: t('ai.inherit') },
    ...EFFORTS.filter((effort) => efforts.includes(effort)).map((effort) => ({ value: effort, label: t(`ai.effort.${effort}`) })),
  ], profile.aiEffort || 'inherit', missing(t(`ai.effort.${profile.aiEffort}`)))

  return (
    <div className="flex flex-col gap-4 p-1">
      {profiles.length > 1 && (
        <Field label={t('ai.profile')}>
          <Select value={profile.id} options={profiles.map((item) => ({ value: item.id, label: item.name }))} onChange={(event) => setProfileId(event.currentTarget.value)} />
        </Field>
      )}
      <Field label={t('ai.provider')}>
        <Select value={profile.aiProviderId ?? ''} options={providerOptions} onChange={(event) => updateProfile({ aiProviderId: event.currentTarget.value, aiAgentId: '', aiEffort: 'inherit' })} />
      </Field>
      <Field label={t('ai.model')}>
        <Select value={profile.aiAgentId ?? ''} options={agentOptions} onChange={(event) => updateProfile({ aiAgentId: event.currentTarget.value, aiEffort: 'inherit' })} />
      </Field>
      <Field label={t('ai.effort')}>
        <Select value={profile.aiEffort ?? 'inherit'} options={effortOptions} onChange={(event) => updateProfile({ aiEffort: event.currentTarget.value as TranslateProfile['aiEffort'] })} />
      </Field>
      <AiReadinessNotice readiness={readiness} profile={profile} t={t} onRefresh={() => void controller.refresh(true)} />
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-[12px]"><span className="font-medium">{label}</span>{children}</label>
}
