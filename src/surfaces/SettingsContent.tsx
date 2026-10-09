import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { invoke } from '@tauri-apps/api/core'
import { BrainCircuit, Check, Command, Copy, Download, ExternalLink, Hash, Languages, LogIn, LogOut, Moon, RefreshCw, Save, Type, WrapText } from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../i18n'
import { pickLocale } from '../i18n/pickLocale'
import { ShortcutRecorder } from '../components/ShortcutRecorder'
import { AppHotkeysSettings } from '../components/AppHotkeysSettings'
import { cancelAiProviderLogin, listAiProviders, loginAiProvider, logoutAiProvider, refreshAiProvider } from '../workspace/ai/runtime'
import { createAiLoginSession, type AiLoginSessionSnapshot } from '../workspace/ai/loginSession'
import type { AiProviderDescriptor, AiReasoningEffort } from '../workspace/ai/types'
import { JEV_PRESETS, JevRequestError, testJevConnection, validJevEndpoint, validJevSettings, type JevSettings } from '../workspace/ai/jev'
import { openExternalUrl } from '../workspace/effectRunner'
import { showToast } from '../workspace/toast'
import { Combobox, NumberField, Select, Switch } from '../plugin-ui'

export function SettingsContent() {
  const { settings, updateSetting } = useAppStore()
  const locale = useAppStore((s) => s.locale)
  const t = useT('settings')
  const [appVersion, setAppVersion] = useState('')
  const [switchingLocale, setSwitchingLocale] = useState<string | null>(null)

  useEffect(() => {
    getVersion().then((v) => setAppVersion(v)).catch(() => setAppVersion('dev'))
  }, [])

  return (
    <div className="sscroll">
      {switchingLocale && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 12,
            background: 'var(--color-bg-overlay, rgba(0,0,0,0.4))',
            zIndex: 9999,
            fontSize: 'var(--text-base)',
            color: 'var(--color-text-primary)',
          }}
        >
          <RefreshCw size={22} className="animate-spin" aria-hidden="true" />
          <span>{t('switchingLanguage')}</span>
        </div>
      )}
      <SettingGroup title={t('general')}>
        <SettingsListRow icon={<Languages size={15} strokeWidth={2} />} name={t('language')} desc={t('languageInfo')}>
          <LocaleSelect
            value={locale}
            options={[
              { value: 'en', label: t('langEn') },
              { value: 'zh', label: t('langZh') },
            ]}
            onChange={(value) => {
              updateSetting('locale', value)
              setSwitchingLocale(value)
              setTimeout(() => window.location.reload(), 300)
            }}
          />
        </SettingsListRow>
        <SettingsListRow icon={<Moon size={15} strokeWidth={2} />} name={t('darkTheme')} desc={t('darkThemeInfo')}>
          <Switch checked={settings.theme === 'dark'} onCheckedChange={(value) => updateSetting('theme', value ? 'dark' : 'light')} aria-label={t('darkTheme')} />
        </SettingsListRow>
        <SettingsListRow icon={<Save size={15} strokeWidth={2} />} name={t('persistParams')} desc={t('persistParamsInfo')}>
          <Switch checked={settings.persistParams} onCheckedChange={(value) => updateSetting('persistParams', value)} aria-label={t('persistParams')} />
        </SettingsListRow>
        <SettingsListRow icon={<BrainCircuit size={15} strokeWidth={2} />} name={t('automaticLearning')} desc={t('automaticLearningInfo')}>
          <Switch checked={settings.automaticLearningEnabled === true} onCheckedChange={(value) => updateSetting('automaticLearningEnabled', value)} aria-label={t('automaticLearning')} />
        </SettingsListRow>
      </SettingGroup>

      <SettingGroup title={t('hotkeys')}>
        <SettingsListRow icon={<Command size={15} strokeWidth={2} />} name={t('globalPinnedLauncherShortcut')} desc={t('globalPinnedLauncherShortcutInfo')}>
          <ShortcutRecorder
            value={settings.globalPinnedLauncherShortcut ?? { kind: 'double-modifier', modifier: 'Command' }}
            allowDoubleModifier
            status={formatHotkeyRegistrationStatus(settings.globalPinnedLauncherShortcut, t)}
            hint={settings.globalPinnedLauncherShortcut?.kind === 'double-modifier'
              ? t('hotkeyAccessibilityHint', { modifier: settings.globalPinnedLauncherShortcut.modifier })
              : undefined}
            onRecord={(recordedShortcut) => updateSetting('globalPinnedLauncherShortcut', recordedShortcut)}
            onClear={() => updateSetting('globalPinnedLauncherShortcut', { kind: 'disabled' })}
          />
        </SettingsListRow>
        <SettingsListRow icon={<Command size={15} strokeWidth={2} />} name={t('quickEditorShortcut')} desc={t('quickEditorShortcutInfo')}>
          <ShortcutRecorder
            value={settings.quickEditorShortcut ?? { kind: 'disabled' }}
            status={formatHotkeyRegistrationStatus(settings.quickEditorShortcut, t)}
            onRecord={(recordedShortcut) => updateSetting('quickEditorShortcut', recordedShortcut)}
            onClear={() => updateSetting('quickEditorShortcut', { kind: 'disabled' })}
          />
        </SettingsListRow>
        <SettingsListRow stacked icon={<Command size={15} strokeWidth={2} />} name={t('appHotkeys')} desc={t('appHotkeysInfo')}>
          <AppHotkeysSettings />
        </SettingsListRow>
      </SettingGroup>

      <SettingGroup title={t('editor')}>
        <SettingsListRow icon={<Type size={15} strokeWidth={2} />} name={t('fontSize')} desc={t('fontSizeInfo')}>
          <NumberField
            value={settings.fontSize}
            min={10}
            max={24}
            aria-label={t('fontSize')}
            onChange={(value) => updateSetting('fontSize', value)}
          />
        </SettingsListRow>
        <SettingsListRow icon={<WrapText size={15} strokeWidth={2} />} name={t('wordWrap')} desc={t('wordWrapInfo')}>
          <Switch checked={settings.wordWrap} onCheckedChange={(value) => updateSetting('wordWrap', value)} aria-label={t('wordWrap')} />
        </SettingsListRow>
        <SettingsListRow icon={<Hash size={15} strokeWidth={2} />} name={t('lineNumbers')} desc={t('lineNumbersInfo')}>
          <Switch checked={settings.lineNumbers} onCheckedChange={(value) => updateSetting('lineNumbers', value)} aria-label={t('lineNumbers')} />
        </SettingsListRow>
      </SettingGroup>

      <div className="settings-about-card">
        <div className="settings-about-left">
          <div className="settings-about-mark" aria-hidden="true">h</div>
          <div className="settings-about-text">
            <span className="settings-about-name">hiven</span>
            <span className="settings-about-version">
              {t('currentVersion')} <span>v{appVersion}</span>
            </span>
          </div>
        </div>
        <div className="settings-about-right">
          <UpdateChecker compact />
        </div>
      </div>
    </div>
  )
}

export function AiSubscriptionsContent() {
  const { settings, updateSetting } = useAppStore()
  const locale = useAppStore((state) => state.locale)
  const t = useT('settings')
  const [providers, setProviders] = useState<AiProviderDescriptor[]>([])
  const providerOrderRef = useRef(new Map<string, number>())
  const [initialLoading, setInitialLoading] = useState(true)
  const [pendingProviderCount, setPendingProviderCount] = useState(3)
  const [loading, setLoading] = useState(false)
  const [pendingProviderId, setPendingProviderId] = useState<string | null>(null)
  const [refreshingProviderId, setRefreshingProviderId] = useState<string | null>(null)
  const [chatGptLogin, setChatGptLogin] = useState<AiLoginSessionSnapshot>({ generation: 0, phase: 'idle' })
  const chatGptSessionRef = useRef<ReturnType<typeof createAiLoginSession> | null>(null)
  const [chatGptAction, setChatGptAction] = useState<'open' | 'copy' | null>(null)
  const chatGptActionRef = useRef<object | null>(null)
  const chatGptOpenRef = useRef<AbortController | null>(null)
  const chatGptConnectRef = useRef<HTMLButtonElement | null>(null)
  const [chatGptFeedback, setChatGptFeedback] = useState<{ key: string; error?: boolean } | null>(null)

  useEffect(() => () => {
    const session = chatGptSessionRef.current
    chatGptSessionRef.current = null
    chatGptActionRef.current = null
    chatGptOpenRef.current?.abort()
    session?.dispose()
  }, [])

  useEffect(() => {
    if (chatGptLogin.reason === 'cancelled') chatGptConnectRef.current?.focus()
  }, [chatGptLogin.reason, chatGptLogin.generation])

  useEffect(() => {
    if (chatGptLogin.phase !== 'pending') return
    const session = chatGptSessionRef.current
    const generation = chatGptLogin.generation
    let disposed = false
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const provider = await refreshAiProvider('openai-chatgpt')
        if (disposed || session !== chatGptSessionRef.current || session?.getSnapshot().generation !== generation) return
        if (provider) setProviders((current) => current.map((item) => item.id === provider.id ? provider : item))
        if (provider?.status === 'ready') session.finish(generation)
      } catch {
        // Keep the pending sign-in available through transient status failures.
      } finally {
        checking = false
      }
    }
    const interval = window.setInterval(() => void check(), 1500)
    return () => {
      disposed = true
      window.clearInterval(interval)
    }
  }, [chatGptLogin.phase, chatGptLogin.generation])

  const refresh = async () => {
    try {
      const next = await listAiProviders((provider, _completed, total, index) => {
        providerOrderRef.current.set(provider.id, index)
        setProviders((current) => {
          const visible = [...current.filter((item) => item.id !== provider.id), provider]
            .sort((left, right) => (providerOrderRef.current.get(left.id) ?? 0) - (providerOrderRef.current.get(right.id) ?? 0))
          setPendingProviderCount(Math.max(0, total - visible.length))
          return visible
        })
      })
      setProviders(next)
    } catch (error) {
      showToast(t('aiRefreshFailed', { message: formatUserFacingError(error).short }), 'error')
    } finally {
      setInitialLoading(false)
    }
  }

  const refreshProvider = async (providerId: string) => {
    setRefreshingProviderId(providerId)
    try {
      const provider = await refreshAiProvider(providerId)
      if (provider) setProviders((current) => current.map((item) => item.id === providerId ? provider : item))
    } catch (error) {
      showToast(t('aiRefreshFailed', { message: formatUserFacingError(error).short }), 'error')
    } finally {
      setRefreshingProviderId(null)
    }
  }

  useEffect(() => { void refresh() }, [])
  useEffect(() => {
    if (!pendingProviderId) return
    let checking = false
    const check = async () => {
      if (checking) return
      checking = true
      try {
        const next = await listAiProviders()
        setProviders(next)
        if (next.some((item) => item.id === pendingProviderId && item.status === 'ready')) {
          setPendingProviderId(null)
        }
      } catch {
        // The manual refresh action reports errors; background OAuth polling stays quiet.
      } finally {
        checking = false
      }
    }
    const interval = window.setInterval(() => void check(), 1500)
    const timeout = window.setTimeout(() => setPendingProviderId(null), 300_000)
    return () => {
      window.clearInterval(interval)
      window.clearTimeout(timeout)
    }
  }, [pendingProviderId])

  const readyProviders = providers.filter((item) => item.status === 'ready')
  const automaticProviders = readyProviders.filter((item) => item.fallbackPolicy !== 'never')
  const configuredProvider = providers.find((item) => item.id === settings.aiDefaultProviderId)
  const keepConfiguredDefault = configuredProvider?.fallbackPolicy === 'never'
    || (initialLoading && settings.aiDefaultProviderId != null)
  const defaultProvider = keepConfiguredDefault
    ? configuredProvider
    : automaticProviders.find((item) => item.id === settings.aiDefaultProviderId)
      ?? automaticProviders.find((item) => item.isDefault)
      ?? automaticProviders[0]
  const providerOptions = readyProviders.map((item) => ({ value: item.id, label: item.name }))
  if (!keepConfiguredDefault && !defaultProvider && readyProviders.length) {
    providerOptions.unshift({ value: '', label: t('aiChooseProvider') })
  }
  if (keepConfiguredDefault && settings.aiDefaultProviderId && !providerOptions.some((item) => item.value === settings.aiDefaultProviderId)) {
    providerOptions.unshift({
      value: settings.aiDefaultProviderId,
      label: `${configuredProvider?.name ?? settings.aiDefaultProviderId} · ${t(initialLoading && !configuredProvider ? 'aiSelectionLoading' : 'aiSelectionUnavailable')}`,
    })
  }
  const agents = defaultProvider?.agents ?? []
  const selectedAgentId = settings.aiDefaultAgentId
    ?? (keepConfiguredDefault ? '' : agents.find((item) => item.isDefault)?.id ?? agents[0]?.id ?? '')
  const selectedAgent = agents.find((item) => item.id === selectedAgentId)
  const agentOptions = agents.map((item) => ({
    value: item.id,
    label: item.contextWindow
      ? `${item.name} · ${t('aiContextWindow', { tokens: formatTokenCount(item.contextWindow) })}`
      : item.name,
  }))
  if (selectedAgentId && !selectedAgent && keepConfiguredDefault) {
    agentOptions.unshift({ value: selectedAgentId, label: `${selectedAgentId} · ${t('aiSelectionUnavailable')}` })
  }
  const effortUnsupported = selectedAgent?.supportedEfforts.length === 0
  const effortUnknown = !selectedAgent
  const effortDisabled = effortUnsupported || effortUnknown

  const performChatGptLinkAction = async (action: 'open' | 'copy', expectedGeneration?: number) => {
    const session = chatGptSessionRef.current
    const snapshot = session?.getSnapshot()
    if (!session || snapshot?.phase !== 'pending' || !snapshot.url || chatGptActionRef.current
      || (expectedGeneration !== undefined && snapshot.generation !== expectedGeneration)) return
    const operation = {}
    chatGptActionRef.current = operation
    setChatGptAction(action)
    setChatGptFeedback(null)
    const isCurrent = () => chatGptSessionRef.current === session
      && session.getSnapshot().generation === snapshot.generation
      && session.getSnapshot().phase === 'pending'
    try {
      if (action === 'copy') {
        // The native command excludes this link from this Hiven session's history.
        // Never fall back to an ordinary write if its privacy guard fails.
        await invoke('clipboard_write_login_link', { text: snapshot.url })
      } else {
        const controller = new AbortController()
        chatGptOpenRef.current = controller
        await openExternalUrl(snapshot.url, controller.signal, { sensitive: true })
      }
      if (isCurrent()) setChatGptFeedback({ key: action === 'copy' ? 'aiSignInLinkCopied' : 'aiSignInOpenRequested' })
    } catch {
      // Native errors can contain the URL; only display localized, fixed text.
      if (isCurrent()) setChatGptFeedback({ key: action === 'copy' ? 'aiSignInCopyFailed' : 'aiSignInOpenFailed', error: true })
    } finally {
      if (chatGptActionRef.current === operation) {
        chatGptActionRef.current = null
        chatGptOpenRef.current = null
        setChatGptAction(null)
      }
    }
  }

  const connectChatGpt = async () => {
    if (chatGptSessionRef.current && chatGptSessionRef.current.getSnapshot().phase !== 'idle') return
    if (!chatGptSessionRef.current) {
      const session = createAiLoginSession({
        start: () => loginAiProvider('openai-chatgpt'),
        cancel: (loginId) => cancelAiProviderLogin('openai-chatgpt', loginId),
        onChange: (snapshot) => {
          if (chatGptSessionRef.current !== session) return
          setChatGptLogin(snapshot)
          if (snapshot.phase !== 'pending') {
            chatGptOpenRef.current?.abort()
            chatGptOpenRef.current = null
            chatGptActionRef.current = null
            setChatGptAction(null)
            setChatGptFeedback(snapshot.reason === 'timeout'
              ? { key: 'aiSignInTimedOut', error: true }
              : snapshot.reason === 'error'
                ? { key: 'aiSignInStartFailed', error: true }
                : snapshot.reason === 'cancelled'
                  ? { key: 'aiSignInCancelled' }
                  : null)
          }
        },
      })
      chatGptSessionRef.current = session
    }
    try {
      const snapshot = await chatGptSessionRef.current.start()
      if (snapshot?.phase === 'pending') await performChatGptLinkAction('open', snapshot.generation)
    } catch {
      // The session reports a safe error state without exposing login data.
    }
  }

  const cancelChatGpt = async () => {
    const session = chatGptSessionRef.current
    if (!session) return
    const cancellation = session.cancel()
    const generation = session.getSnapshot().generation
    try {
      await cancellation
    } catch {
      if (chatGptSessionRef.current === session && session.getSnapshot().generation === generation) {
        setChatGptFeedback({ key: 'aiSignInCancelFailed', error: true })
      }
    }
  }

  const connect = async (providerId: string) => {
    if (providerId === 'openai-chatgpt') {
      await connectChatGpt()
      return
    }
    setLoading(true)
    try {
      const result = await loginAiProvider(providerId)
      if (result.url) await openExternalUrl(result.url)
      if (result.verificationCode) showToast(t('aiVerificationCode', { code: result.verificationCode }), 'info', 300_000)
      setPendingProviderId(providerId)
    } catch (error) {
      showToast(t('aiConnectFailed', { message: formatUserFacingError(error).short }), 'error')
    } finally {
      setLoading(false)
    }
  }

  const disconnect = async (providerId: string) => {
    setLoading(true)
    try {
      await logoutAiProvider(providerId)
      setPendingProviderId(null)
      setProviders(await listAiProviders())
    } catch (error) {
      showToast(t('aiDisconnectFailed', { message: formatUserFacingError(error).short }), 'error')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="sscroll">
      <SettingGroup title={t('aiSubscriptionManagement')}>
        {providers.map((provider) => {
          const ready = provider.status === 'ready'
          const isChatGpt = provider.id === 'openai-chatgpt'
          const chatGptPending = isChatGpt && chatGptLogin.phase !== 'idle'
          const waiting = pendingProviderId === provider.id || chatGptPending
          const refreshing = refreshingProviderId === provider.id
          const requiresAccount = provider.authentication !== 'none'
          const subscription = [provider.subscription?.accountName, provider.subscription?.plan].filter(Boolean).join(' · ')
          return (
            <div className="ai-subscription-provider" key={provider.id}>
              <SettingsListRow
                icon={ready ? <Check size={15} strokeWidth={2} style={{ color: 'var(--color-success-text)' }} /> : requiresAccount ? <LogIn size={15} strokeWidth={2} /> : <BrainCircuit size={15} strokeWidth={2} />}
                name={provider.name}
                desc={!requiresAccount
                  ? t(`ollamaStatus_${provider.statusReason ?? (ready ? 'ready' : 'metadata_unavailable')}`)
                  : chatGptPending
                  ? t(chatGptLogin.phase === 'starting' ? 'aiSignInStarting' : 'aiSignInPending')
                  : waiting
                  ? t('aiSubscriptionWaiting')
                  : ready
                    ? t('aiSubscriptionReady', { plan: subscription })
                    : provider.statusMessage ?? t(provider.status === 'unavailable' ? 'aiProviderUnavailable' : 'aiSubscriptionLoginRequired')}
              >
                <div className="flex flex-wrap items-center gap-2">
                  {ready && (
                    <span className="flex items-center gap-1 text-[11px]" style={{ color: 'var(--color-success-text)' }}>
                      <Check size={11} /> {t(requiresAccount ? 'aiConnected' : 'aiLocalReady')}
                    </span>
                  )}
                  {requiresAccount && !chatGptPending && (ready
                    ? <button type="button" className="scripts-btn" disabled={loading} onClick={() => void disconnect(provider.id)}><LogOut size={11} /> {t('aiDisconnect')}</button>
                    : <button ref={isChatGpt ? chatGptConnectRef : undefined} type="button" className="scripts-btn scripts-btn-primary" disabled={loading || waiting || provider.status === 'unavailable'} onClick={() => void connect(provider.id)}>{waiting ? <RefreshCw size={11} className="animate-spin" /> : <LogIn size={11} />} {t(waiting ? 'aiConnecting' : 'aiConnect')}</button>)}
                  <button type="button" className="scripts-btn" disabled={loading || waiting || refreshing} onClick={() => void refreshProvider(provider.id)} aria-label={t(requiresAccount ? 'aiRefresh' : 'aiRefreshLocal')}>
                    <RefreshCw size={11} className={refreshing ? 'animate-spin' : ''} />
                    {!requiresAccount && t('aiRefreshLocal')}
                  </button>
                </div>
              </SettingsListRow>
              {chatGptPending && (
                <div className="ai-sign-in-handoff">
                  <p id="chatgpt-sign-in-help" role="status" aria-live="polite">
                    {t(chatGptLogin.phase === 'starting' ? 'aiSignInPreparing' : 'aiSignInInstructions')}
                  </p>
                  {chatGptLogin.phase === 'pending' && <p id="chatgpt-sign-in-clipboard-info">{t('aiSignInCopyPrivacy')}</p>}
                  <div className="ai-sign-in-actions" aria-describedby="chatgpt-sign-in-help">
                    {chatGptLogin.phase === 'pending' && <>
                      <button type="button" className="scripts-btn scripts-btn-primary" disabled={chatGptAction !== null} onClick={() => void performChatGptLinkAction('open')}>
                        {chatGptAction === 'open' ? <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> : <ExternalLink size={12} aria-hidden="true" />}
                        {t(chatGptAction === 'open' ? 'aiSignInOpening' : 'aiSignInOpen')}
                      </button>
                      <button type="button" className="scripts-btn" disabled={chatGptAction !== null} aria-describedby="chatgpt-sign-in-clipboard-info" onClick={() => void performChatGptLinkAction('copy')}>
                        {chatGptAction === 'copy' ? <RefreshCw size={12} className="animate-spin" aria-hidden="true" /> : <Copy size={12} aria-hidden="true" />}
                        {t(chatGptAction === 'copy' ? 'aiSignInCopying' : 'aiSignInCopy')}
                      </button>
                    </>}
                    <button type="button" className="scripts-btn" onClick={() => void cancelChatGpt()}>{t('aiSignInCancel')}</button>
                  </div>
                </div>
              )}
              {isChatGpt && chatGptFeedback && (
                <p className="ai-sign-in-feedback" role="status" aria-live="polite" style={{ color: chatGptFeedback.error ? 'var(--color-error-text)' : 'var(--color-text-secondary)' }}>
                  {t(chatGptFeedback.key)}
                </p>
              )}
              {!requiresAccount && <p className="px-4 pb-3 text-xs" style={{ color: 'var(--color-text-secondary)' }}>{t('ollamaLocalBoundary')}</p>}
              {ready && <AiQuotaUsage provider={provider} locale={locale} t={t} />}
            </div>
          )
        })}
        {initialLoading && <AiProviderSkeleton label={t('aiLoadingProviders')} count={pendingProviderCount} />}
      </SettingGroup>

      <SettingGroup title={t('aiDefaults')}>
        <SettingsListRow icon={<BrainCircuit size={15} strokeWidth={2} />} name={t('aiDefaultProvider')} desc={t('aiDefaultProviderInfo')}>
          <LocaleSelect
            value={(keepConfiguredDefault ? settings.aiDefaultProviderId : defaultProvider?.id) ?? ''}
            options={providerOptions}
            wide
            disabled={readyProviders.length === 0}
            emptyLabel={t('aiNoProviders')}
            onChange={(value) => {
              if (!value) return
              const selectedProvider = providers.find((item) => item.id === value)
              if (selectedProvider?.fallbackPolicy === 'never') {
                // An explicit provider choice binds the model shown now; refresh never rebinds it.
                if (settings.aiDefaultProviderId === value) return
                const selectedModel = selectedProvider.agents.find((item) => item.isDefault) ?? selectedProvider.agents[0]
                updateSetting('aiDefaultProviderId', value)
                updateSetting('aiDefaultAgentId', selectedModel?.id)
                return
              }
              updateSetting('aiDefaultProviderId', value)
              updateSetting('aiDefaultAgentId', undefined)
            }}
          />
        </SettingsListRow>
        <SettingsListRow icon={<BrainCircuit size={15} strokeWidth={2} />} name={t('aiDefaultAgent')} desc={t('aiDefaultAgentInfo')}>
          <LocaleSelect
            value={selectedAgentId}
            options={agentOptions}
            wide
            searchable
            searchPlaceholder={t('aiSearchAgents')}
            noResultsLabel={t('aiNoMatchingAgents')}
            disabled={agents.length === 0}
            emptyLabel={t('aiNoAgents')}
            onChange={(value) => updateSetting('aiDefaultAgentId', value)}
          />
        </SettingsListRow>
        <SettingsListRow icon={<BrainCircuit size={15} strokeWidth={2} />} name={t('aiDefaultEffort')} desc={t(effortUnknown ? 'aiEffortSelectModel' : effortUnsupported ? 'aiEffortUnsupported' : 'aiDefaultEffortInfo')}>
          <LocaleSelect
            value={effortDisabled ? '' : settings.aiDefaultEffort}
            wide
            disabled={effortDisabled}
            emptyLabel={t(effortUnknown ? 'aiSelectionUnavailable' : 'aiEffortNotApplicable')}
            options={effortDisabled ? [] : (['low', 'medium', 'high', 'xhigh'] as AiReasoningEffort[]).map((value) => ({
              value,
              label: t(`aiEffort_${value}`),
            }))}
            onChange={(value) => updateSetting('aiDefaultEffort', value)}
          />
        </SettingsListRow>
      </SettingGroup>
      <JevCommandSettings />
    </div>
  )
}

function JevCommandSettings() {
  const t = useT('settings')
  const { settings, updateSetting } = useAppStore()
  const [draft, setDraft] = useState<JevSettings>(() => settings.jevCommandSuggestion ?? { enabled: false, apiKey: '', ...JEV_PRESETS.tencent })
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState('')
  const configured = validJevSettings(draft)
  const preset = Object.entries(JEV_PRESETS).find(([, value]) => value.endpoint === draft.endpoint && value.model === draft.model)?.[0] ?? 'custom'
  const changed = JSON.stringify(draft) !== JSON.stringify(settings.jevCommandSuggestion)
  const inputStyle = { width: 'min(220px, 36vw)', boxSizing: 'border-box' as const }
  const editDraft = (next: JevSettings) => {
    setDraft(next)
    setTestResult('')
  }
  const testConnection = async () => {
    if (!configured) return
    setTesting(true)
    setTestResult('')
    try {
      await testJevConnection(draft)
      setTestResult(t('jevTestSuccess'))
    } catch (error) {
      const status = error instanceof JevRequestError ? error.status : 0
      setTestResult(t(status === 401 || status === 403 ? 'jevTestAuthError' : status === 429 ? 'jevTestRateLimit' : 'jevTestError'))
    } finally {
      setTesting(false)
    }
  }

  return (
    <SettingGroup title={t('jevTitle')}>
      <SettingsListRow icon={<BrainCircuit size={15} />} name={t('jevEnabled')} desc={t('jevInfo')}>
        <Switch checked={draft.enabled} disabled={!configured || testing} onCheckedChange={(enabled) => editDraft({ ...draft, enabled })} aria-label={t('jevEnabled')} />
      </SettingsListRow>
      <SettingsListRow icon={<BrainCircuit size={15} />} name={t('jevPreset')} desc={t('jevPresetInfo')}>
        <Select
          className="settings-select-wrap is-wide"
          value={preset}
          disabled={testing}
          aria-label={t('jevPreset')}
          options={[
            { value: 'tencent', label: t('jevTencent') },
            { value: 'official', label: t('jevOfficial') },
            { value: 'custom', label: t('jevCustom') },
          ]}
          onChange={(event) => {
            const value = event.currentTarget.value
            if (value === preset) return
            const next = value === 'tencent' ? JEV_PRESETS.tencent : value === 'official' ? JEV_PRESETS.official : { endpoint: '', model: '' }
            editDraft({ enabled: false, apiKey: '', ...next })
          }}
        />
      </SettingsListRow>
      <SettingsListRow icon={<BrainCircuit size={15} />} name={t('jevEndpoint')} desc={t('jevEndpointInfo')}>
        <input className="hiven-ui-input" style={inputStyle} value={draft.endpoint} disabled={testing} onChange={(event) => editDraft({ ...draft, enabled: false, apiKey: '', endpoint: event.target.value })} aria-label={t('jevEndpoint')} spellCheck={false} />
      </SettingsListRow>
      <SettingsListRow icon={<BrainCircuit size={15} />} name={t('jevApiKey')} desc={t('jevKeyInfo')}>
        <input className="hiven-ui-input" style={inputStyle} type="password" autoComplete="off" value={draft.apiKey} disabled={testing} onChange={(event) => editDraft({ ...draft, enabled: false, apiKey: event.target.value })} aria-label={t('jevApiKey')} />
      </SettingsListRow>
      <SettingsListRow icon={<BrainCircuit size={15} />} name={t('jevModel')}>
        <input className="hiven-ui-input" style={inputStyle} value={draft.model} disabled={testing} onChange={(event) => editDraft({ ...draft, enabled: false, model: event.target.value })} aria-label={t('jevModel')} spellCheck={false} />
      </SettingsListRow>
      <SettingsListRow icon={<BrainCircuit size={15} />} name={t('jevActions')} desc={!validJevEndpoint(draft.endpoint) && draft.endpoint ? t('jevInvalidEndpoint') : testResult || undefined}>
        <div className="flex items-center gap-2">
          <button type="button" className="scripts-btn" disabled={!configured || testing} onClick={() => void testConnection()}>{testing ? t('jevTesting') : t('jevTest')}</button>
          <button type="button" className="scripts-btn scripts-btn-primary" disabled={testing || !changed || (draft.enabled && !configured) || (Boolean(draft.endpoint) && !validJevEndpoint(draft.endpoint))} onClick={() => { updateSetting('jevCommandSuggestion', draft); setTestResult(t('jevSaved')) }}>{t('jevSave')}</button>
        </div>
      </SettingsListRow>
    </SettingGroup>
  )
}

function AiProviderSkeleton({ label, count = 2 }: { label: string; count?: number }) {
  if (count <= 0) return null
  return (
    <div className="ai-provider-skeleton" aria-label={label} aria-busy="true" role="status">
      {Array.from({ length: count }, (_, index) => (
        <div className="srow" key={index} aria-hidden="true">
          <div className="ai-provider-skeleton-icon" />
          <div className="s-main">
            <div className="ai-provider-skeleton-line ai-provider-skeleton-name" />
            <div className="ai-provider-skeleton-line ai-provider-skeleton-desc" />
          </div>
          <div className="ai-provider-skeleton-action" />
        </div>
      ))}
    </div>
  )
}

function AiQuotaUsage({ provider, locale, t }: { provider: AiProviderDescriptor; locale: string; t: ReturnType<typeof useT> }) {
  const buckets = [...(provider.quota?.buckets ?? [])].sort((left, right) => quotaBucketPriority(left) - quotaBucketPriority(right))
  const entries = buckets.flatMap((bucket) => {
    const rawBucketName = bucket.name?.trim() || bucket.id
    const hasKnownLabel = ['gpt-reserve', 'grok-subscription'].includes(rawBucketName.toLowerCase())
    const bucketName = hasKnownLabel ? formatQuotaBucketName(rawBucketName, t) : bucket.name?.trim() || formatQuotaBucketName(bucket.id, t)
    const hasBothWindows = Boolean(bucket.primary && bucket.secondary)
    return ([['primary', bucket.primary], ['secondary', bucket.secondary]] as const).flatMap(([kind, window]) => {
      if (!window) return []
      const used = Math.max(0, Math.min(100, window.usedPercent))
      return [{
        key: `${bucket.id}-${kind}`,
        label: [bucketName, hasBothWindows ? t(kind === 'primary' ? 'aiQuotaPrimary' : 'aiQuotaSecondary') : '', formatQuotaWindow(window.windowDurationMinutes, t)].filter(Boolean).join(' · '),
        technicalId: hasKnownLabel ? rawBucketName : bucket.name?.trim() ? undefined : bucket.id,
        used,
        reset: formatQuotaReset(window.resetsAt, locale, t),
      }]
    })
  })
  if (entries.length === 0 && provider.quota?.creditsRemaining == null) return null

  return (
    <div className="ai-quota-grid">
      {entries.map((entry) => (
        <div className="ai-quota-item" key={entry.key}>
          <div className="ai-quota-meta">
            <span className="ai-quota-label" title={entry.technicalId}>{entry.label}</span>
            <strong>{Math.round(entry.used)}%</strong>
          </div>
          <div className="ai-quota-track" role="progressbar" aria-label={entry.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(entry.used)}>
            <span className="ai-quota-fill" data-level={entry.used >= 80 ? 'high' : entry.used >= 50 ? 'medium' : 'low'} style={{ width: `${entry.used}%` }} />
          </div>
          <div className="ai-quota-reset">{entry.reset}</div>
        </div>
      ))}
      {provider.quota?.creditsRemaining != null && (
        <div className="ai-quota-credits">{t('aiCreditsRemaining', { credits: provider.quota.creditsRemaining })}</div>
      )}
    </div>
  )
}

function formatQuotaWindow(minutes: number | undefined, t: ReturnType<typeof useT>): string {
  if (!minutes) return t('aiQuotaLimit')
  if (minutes % 1440 === 0) return t('aiQuotaDays', { count: minutes / 1440 })
  if (minutes % 60 === 0) return t('aiQuotaHours', { count: minutes / 60 })
  return t('aiQuotaMinutes', { count: minutes })
}

function formatTokenCount(tokens: number): string {
  if (tokens >= 1_000_000) return `${Number((tokens / 1_000_000).toFixed(1))}M`
  if (tokens >= 1_000) return `${Number((tokens / 1_000).toFixed(0))}K`
  return String(tokens)
}

function formatQuotaBucketName(id: string, t: ReturnType<typeof useT>): string {
  if (id.trim().toLowerCase() === 'gpt-reserve') return t('aiQuotaOther')
  if (id.trim().toLowerCase() === 'grok-subscription') return t('aiQuotaGrokSubscription')
  return id.split(/[-_.:/]+/).filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')
}

function quotaBucketPriority(bucket: NonNullable<AiProviderDescriptor['quota']>['buckets'][number]): number {
  const names = [bucket.id, bucket.name ?? ''].map((value) => value.trim().toLowerCase())
  if (names.includes('codex')) return 0
  if (names.some((value) => value.includes('reserve'))) return 1
  return 2
}

function formatQuotaReset(resetsAt: number | undefined, locale: string, t: ReturnType<typeof useT>): string {
  if (resetsAt == null) return t('aiQuotaResetUnknown')
  const value = resetsAt < 1_000_000_000_000 ? resetsAt * 1000 : resetsAt
  const formatted = new Intl.DateTimeFormat(pickLocale(locale, 'zh-CN', 'en-US'), {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
  return t('aiQuotaResetsAt', { reset: formatted })
}

export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sgroup">
      <div className="sgroup-label">{title}</div>
      <div className="scard">{children}</div>
    </div>
  )
}

export function SettingsListRow({ icon, name, desc, children, stacked = false }: { icon: ReactNode; name: string; desc?: string; children: ReactNode; stacked?: boolean }) {
  return (
    <div className={`srow${stacked ? ' srow--stacked' : ''}`}>
      <div className="s-ico">{icon}</div>
      <div className="s-main">
        <div className="s-name">{name}</div>
        {desc && <div className="s-desc">{desc}</div>}
      </div>
      <div className="s-ctl">{children}</div>
    </div>
  )
}

function formatUserFacingError(err: unknown, maxLen = 160): { short: string; full: string } {
  const full = err instanceof Error ? (err.message || String(err)) : String(err)
  const single = full.replace(/\s+/g, ' ').trim()
  if (single.length <= maxLen) return { short: single, full: single }
  return { short: `${single.slice(0, maxLen - 1)}…`, full: single }
}

type LocaleSelectProps = {
  options: { value: string; label: string }[]
  value: string
  onChange: (value: string) => void
  disabled?: boolean
  emptyLabel?: string
  wide?: boolean
  searchable?: boolean
  searchPlaceholder?: string
  noResultsLabel?: string
}

function LocaleSelect(props: LocaleSelectProps) {
  const className = `settings-select-wrap ${props.wide ? 'is-wide' : ''}`
  if (props.searchable) {
    return (
      <Combobox
        className={className}
        value={props.value}
        options={props.options}
        disabled={props.disabled}
        placeholder={props.searchPlaceholder || props.emptyLabel}
        emptyLabel={props.noResultsLabel}
        aria-label={props.searchPlaceholder || props.emptyLabel}
        onChange={props.onChange}
      />
    )
  }
  const options = props.options.length > 0 ? props.options : [{ value: '', label: props.emptyLabel ?? '' }]
  return (
    <Select
      className={className}
      value={props.value}
      options={options}
      disabled={props.disabled}
      onChange={(event) => props.onChange(event.currentTarget.value)}
    />
  )
}

function formatHotkeyRegistrationStatus(
  shortcut: ReturnType<typeof useAppStore.getState>['settings']['globalPinnedLauncherShortcut'],
  t: ReturnType<typeof useT>,
): string {
  if (!shortcut) return t('hotkeyStatusPending')
  if (shortcut.registrationError) {
    if (shortcut.registrationError.includes('Accessibility permission is required')) return t('hotkeyAccessibilityRequired')
    if (shortcut.registrationError === 'Shortcut is already registered' ||
        shortcut.registrationError === 'Shortcut is already used by Global Launcher') {
      return t('hotkeyRegistrationFailed', { message: t('hotkeyShortcutConflict') })
    }
    return t('hotkeyRegistrationFailed', { message: shortcut.registrationError })
  }
  if (shortcut.kind === 'disabled') return t('hotkeyStatusDisabled')
  const status = shortcut.registrationStatus
  if (!status) return t('hotkeyStatusPending')
  if (status === 'Registered') return t('hotkeyStatusRegistered')
  if (status === 'Disabled') return t('hotkeyStatusDisabled')
  if (status === 'Unregistered') return t('hotkeyStatusUnregistered')
  if (shortcut.kind === 'double-modifier' && status.toLowerCase().includes('registered')) {
    return t('hotkeyStatusDoubleRegistered', { modifier: shortcut.modifier })
  }
  if (status.toLowerCase().includes('accessibility')) return t('hotkeyAccessibilityRequired')
  return t('hotkeyStatusDetail', { status })
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'no-update' | 'downloading' | 'ready' | 'error'

function UpdateChecker({ compact = false }: { compact?: boolean }) {
  const t = useT('update')
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [version, setVersion] = useState('')
  const [error, setError] = useState('')
  const [errorFull, setErrorFull] = useState('')
  const [copiedError, setCopiedError] = useState(false)
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null)
  const settingsT = useT('settings')

  const handleCheck = async () => {
    setStatus('checking')
    setError('')
    setErrorFull('')
    setCopiedError(false)
    try {
      const update = await check()
      if (update) {
        setVersion(update.version)
        setStatus('available')
        updateRef.current = update
      } else {
        setStatus('no-update')
      }
    } catch (err) {
      const formatted = formatUserFacingError(err)
      setError(formatted.short)
      setErrorFull(formatted.full)
      setStatus('error')
    }
  }

  const handleDownloadAndInstall = async () => {
    const update = updateRef.current
    if (!update) return
    setStatus('downloading')
    try {
      await update.downloadAndInstall()
      setStatus('ready')
    } catch (err) {
      const formatted = formatUserFacingError(err)
      setError(formatted.short)
      setErrorFull(formatted.full)
      setStatus('error')
    }
  }

  const copyErrorDetail = async (detail: string) => {
    try {
      await navigator.clipboard.writeText(detail)
      setCopiedError(true)
      window.setTimeout(() => setCopiedError(false), 1500)
    } catch {
      // ignore clipboard failures
    }
  }

  const statusText = () => {
    switch (status) {
      case 'checking': return t('checking')
      case 'available': return t('available', { version })
      case 'no-update': return t('noUpdate')
      case 'downloading': return t('downloading')
      case 'ready': return t('readyRestart')
      case 'error': return `${t('error')}: ${error}`
      default: return ''
    }
  }

  const updateResult = status !== 'idle' && status !== 'checking' && status !== 'downloading' && (
    <span role="status" style={{ fontSize: 'var(--text-sm)', overflowWrap: 'anywhere', textAlign: compact ? 'right' : undefined, color: status === 'error' ? 'var(--color-error-text)' : status === 'no-update' ? 'var(--text-3)' : 'var(--accent)' }}>
      {statusText()}
      {status === 'error' && errorFull && (
        <button
          type="button"
          className="scripts-btn"
          style={{ marginLeft: 8, padding: '2px 6px', fontSize: 11 }}
          onClick={() => void copyErrorDetail(errorFull)}
        >
          {copiedError ? settingsT('errorCopied') : settingsT('copyError')}
        </button>
      )}
    </span>
  )

  if (compact) {
    return (
      <div className="flex flex-col items-end gap-1" style={{ maxWidth: 'min(320px, 55vw)' }}>
        <div className="flex items-center gap-2">
          {status === 'available' && <button className="scripts-btn" onClick={handleDownloadAndInstall}><Download size={11} /> {version}</button>}
          {status === 'ready' && <button className="scripts-btn scripts-btn-primary" onClick={() => relaunch()}>{t('restart')}</button>}
          {(status === 'idle' || status === 'no-update' || status === 'error') && (
            <button className="scripts-btn" onClick={handleCheck}><RefreshCw size={11} /> {t('checkUpdate')}</button>
          )}
          {(status === 'checking' || status === 'downloading') && (
            <span className="flex items-center gap-1 px-2.5 py-1" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
              <RefreshCw size={11} className="animate-spin" /> {statusText()}
            </span>
          )}
        </div>
        {updateResult}
        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
          {t('builtinManagedByApp')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)' }}>{t('checkUpdate')}</span>
        <div className="flex items-center gap-2">
          {status === 'available' && <button className="scripts-btn" onClick={handleDownloadAndInstall}><Download size={11} /> {version}</button>}
          {status === 'ready' && <button className="scripts-btn scripts-btn-primary" onClick={() => relaunch()}>{t('restart')}</button>}
          {(status === 'idle' || status === 'no-update' || status === 'error') && (
            <button className="scripts-btn" onClick={handleCheck}><RefreshCw size={11} /> {t('checkUpdate')}</button>
          )}
          {(status === 'checking' || status === 'downloading') && (
            <span className="flex items-center gap-1 px-2.5 py-1" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
              <RefreshCw size={11} className="animate-spin" /> {statusText()}
            </span>
          )}
        </div>
      </div>
      {updateResult}
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
        {t('builtinManagedByApp')}
      </span>
    </div>
  )
}
