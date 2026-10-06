import { useEffect, useMemo, useState, type ReactNode } from 'react'
import type { AiProviderDescriptor, PluginSettingsModalBodyProps } from '@hiven/plugin'
import { Select } from '@hiven/plugin-ui'
import type { TranslateProfile, TranslateSettings } from './model'

const EFFORTS = ['low', 'medium', 'high', 'xhigh'] as const

export function AiTranslateSettingsModal({ value, setValue, host, t }: PluginSettingsModalBodyProps<TranslateSettings>) {
  const profiles = value.profiles.filter((profile) => profile.provider === 'ai')
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? '')
  const [providers, setProviders] = useState<AiProviderDescriptor[]>([])
  const [loading, setLoading] = useState(true)
  const profile = profiles.find((item) => item.id === profileId) ?? profiles[0]

  useEffect(() => {
    void host.ai.providers()
      .then((items) => setProviders(items.filter((item) => item.status === 'ready')))
      .catch(() => host.showMessage(t('ai.loadFailed'), 'error'))
      .finally(() => setLoading(false))
  }, [host.ai, host, t])

  const selectedProvider = providers.find((item) => item.id === profile?.aiProviderId)
    ?? providers.find((item) => item.isDefault)
    ?? providers[0]
  const selectedAgent = selectedProvider?.agents.find((item) => item.id === profile?.aiAgentId)
    ?? selectedProvider?.agents.find((item) => item.isDefault)
    ?? selectedProvider?.agents[0]
  const efforts = selectedAgent?.supportedEfforts ?? []

  const updateProfile = (patch: Partial<TranslateProfile>) => {
    if (!profile) return
    setValue({
      ...value,
      profiles: value.profiles.map((item) => item.id === profile.id ? { ...item, ...patch } : item),
    })
  }

  const providerOptions = useMemo(() => [
    { value: '', label: t('ai.inherit') },
    ...providers.map((item) => ({ value: item.id, label: item.name })),
  ], [providers, t])

  if (loading) return (
    <div className="translate-ai-settings-skeleton" role="status" aria-label={t('ai.loading')} aria-busy="true">
      {[0, 1, 2].map((index) => (
        <div key={index} className="translate-ai-settings-skeleton__field" aria-hidden="true">
          <span />
          <div />
        </div>
      ))}
    </div>
  )
  if (!profile || providers.length === 0) return <p className="text-[12px] text-muted-foreground">{t('ai.unavailable')}</p>

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
        <Select
          value={profile.aiAgentId ?? ''}
          options={[{ value: '', label: t('ai.inherit') }, ...(selectedProvider?.agents ?? []).map((item) => ({ value: item.id, label: item.name }))]}
          onChange={(event) => updateProfile({ aiAgentId: event.currentTarget.value, aiEffort: 'inherit' })}
        />
      </Field>
      <Field label={t('ai.effort')}>
        <Select
          value={profile.aiEffort ?? 'inherit'}
          options={[{ value: 'inherit', label: t('ai.inherit') }, ...EFFORTS.filter((effort) => efforts.includes(effort)).map((effort) => ({ value: effort, label: t(`ai.effort.${effort}`) }))]}
          onChange={(event) => updateProfile({ aiEffort: event.currentTarget.value as TranslateProfile['aiEffort'] })}
        />
      </Field>
    </div>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <label className="flex flex-col gap-1.5 text-[12px]"><span className="font-medium">{label}</span>{children}</label>
}
