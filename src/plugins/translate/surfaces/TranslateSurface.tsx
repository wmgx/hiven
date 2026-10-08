import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { Button, IconButton, Select } from '@hiven/plugin-ui'
import { BackIcon, CloseIcon, SettingsIcon } from '@hiven/plugin-ui/icons'
import { AlertTriangle, ArrowRight, LoaderCircle } from 'lucide-react'
import type { SourceLanguageCode, TargetLanguageCode, TranslateProfile, TranslateSettings } from '../settings/model'
import { currentUsageMonth } from '../settings/model'
import { profileExecutionKey } from '../settings/executionKey'
import { AiGlossaryValidationError, validateAiGlossary } from '../ai/glossary'
import { useAiTranslationReadiness } from '../ai/useReadiness'
import { AiReadinessNotice } from '../ai/AiReadinessNotice'
import { AiTranslationError, estimateBilledChars, isAutoTranslateReady, resolveSmartTargetLang, translateText } from '../providers/adapters'
import { isCurrentTranslationOutput, type TranslationOutput } from './outputEligibility'

const AUTO_TRANSLATE_DEBOUNCE_MS = 800

type TranslateStatus =
  | { kind: 'idle' }
  | { kind: 'unconfigured' }
  | { kind: 'waiting'; dueAt: number }
  | { kind: 'translating'; requestId: number }
  | { kind: 'success'; translatedAt: number }
  | { kind: 'stopped' }
  | { kind: 'settings-paused' }
  | { kind: 'error'; message: string; messageKey?: string }
  | { kind: 'quota-exceeded'; usedChars: number; limitChars: number }

type TranslationView = {
  identity: string
  outputText: string
  status: TranslateStatus
}

type TranslationRun = {
  id: number
  identity: string
  controller: AbortController
  timer?: number
  aiRevision?: number
}

type CacheEntry = {
  text: string
  billedChars: number
}

type SelectOption<T extends string> = {
  label: string
  value: T
  sub?: string
}

type OptionConfig<T extends string> = {
  labelKey: string
  fallback: string
  value: T
  subKey?: string
  subFallback?: string
}

const TARGET_LANGUAGE_OPTIONS: Array<OptionConfig<TargetLanguageCode>> = [
  { labelKey: 'language.smart', fallback: 'Smart', value: 'smart', subKey: 'language.smart.sub', subFallback: 'auto target' },
  { labelKey: 'language.zh', fallback: 'Chinese', value: 'zh' },
  { labelKey: 'language.en', fallback: 'English', value: 'en' },
  { labelKey: 'language.ja', fallback: 'Japanese', value: 'ja' },
  { labelKey: 'language.ko', fallback: 'Korean', value: 'ko' },
  { labelKey: 'language.fr', fallback: 'French', value: 'fr' },
  { labelKey: 'language.de', fallback: 'German', value: 'de' },
  { labelKey: 'language.es', fallback: 'Spanish', value: 'es' },
]

const SOURCE_LANGUAGE_OPTIONS: Array<OptionConfig<SourceLanguageCode>> = [
  { labelKey: 'language.auto', fallback: 'Auto-detect', value: 'auto' },
  { labelKey: 'language.zh', fallback: 'Chinese', value: 'zh' },
  { labelKey: 'language.en', fallback: 'English', value: 'en' },
  { labelKey: 'language.ja', fallback: 'Japanese', value: 'ja' },
  { labelKey: 'language.ko', fallback: 'Korean', value: 'ko' },
  { labelKey: 'language.fr', fallback: 'French', value: 'fr' },
  { labelKey: 'language.de', fallback: 'German', value: 'de' },
  { labelKey: 'language.es', fallback: 'Spanish', value: 'es' },
]

function enabledProfiles(settings: TranslateSettings): TranslateProfile[] {
  return settings.profiles.filter((profile) => profile.enabled)
}

function selectInitialProfile(settings: TranslateSettings): TranslateProfile | undefined {
  return enabledProfiles(settings).find((profile) => profile.id === settings.defaultProfileId) ?? enabledProfiles(settings)[0]
}

function resetUsageMonth(profile: TranslateProfile, month: string): TranslateProfile {
  if (profile.usedCharsMonth === month) return profile
  return { ...profile, usedCharsMonth: month, usedChars: 0 }
}

function stateName(status: TranslateStatus): 'idle' | 'waiting' | 'translating' | 'failed' | 'quota' {
  if (status.kind === 'waiting') return 'waiting'
  if (status.kind === 'translating') return 'translating'
  if (status.kind === 'error') return 'failed'
  if (status.kind === 'quota-exceeded') return 'quota'
  return 'idle'
}

function statusLabel(status: TranslateStatus, t: (key: string) => string): string {
  if (status.kind === 'unconfigured') return t('status.noProfile')
  if (status.kind === 'waiting') return t('status.waiting')
  if (status.kind === 'translating') return t('status.translating')
  if (status.kind === 'success') return localizedText(t, 'status.success', 'Translated')
  if (status.kind === 'stopped') return t('status.stopped')
  if (status.kind === 'settings-paused') return t('status.settingsPaused')
  if (status.kind === 'error') {
    return t('status.error').replace('{message}', status.messageKey ? t(status.messageKey) : status.message)
  }
  if (status.kind === 'quota-exceeded') return localizedText(t, 'status.quota', 'Monthly quota reached')
  return localizedText(t, 'status.idle', 'Idle')
}

function optionLabel<T extends string>(options: Array<SelectOption<T>>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value
}

function localizedText(t: (key: string) => string, key: string, fallback: string): string {
  const label = t(key)
  return label === key ? fallback : label
}

function localizedOptions<T extends string>(t: (key: string) => string, options: Array<OptionConfig<T>>): Array<SelectOption<T>> {
  return options.map((option) => ({
    label: localizedText(t, option.labelKey, option.fallback),
    value: option.value,
    sub: option.subKey ? localizedText(t, option.subKey, option.subFallback ?? '') : undefined,
  }))
}

function formatLimit(value: number): string {
  if (value <= 0) return '∞'
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`
  return value.toLocaleString()
}

function SchemaSelect<T extends string>({
  value,
  options,
  onChange,
  width,
  ariaLabel,
}: {
  value: T
  options: Array<SelectOption<T>>
  onChange: (value: T) => void
  width?: number
  ariaLabel: string
}) {
  return (
    <div className="translate-select" style={width ? { width } : undefined}>
      <Select
        aria-label={ariaLabel}
        value={value}
        options={options.map((option) => ({
          value: option.value,
          label: option.sub ? `${option.label} · ${option.sub}` : option.label,
        }))}
        onChange={(event) => onChange(event.currentTarget.value as T)}
      />
    </div>
  )
}

export function TranslateSurface(props: PluginSurfaceProps<TranslateSettings>) {
  const { host, settings, t } = props
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const requestIdRef = useRef(0)
  const runRef = useRef<TranslationRun | null>(null)
  const cacheRef = useRef(new Map<string, CacheEntry>())
  const hostRef = useRef(host)
  hostRef.current = host
  const mountedRef = useRef(false)
  const settingsVisitRef = useRef<object | null>(null)
  const autoTranslatePausedRef = useRef(false)
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)

  useLayoutEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      settingsVisitRef.current = null
    }
  }, [])

  const initialProfile = useMemo(() => selectInitialProfile(settings), [settings])
  const [profileId, setProfileId] = useState(initialProfile?.id ?? '')
  const [sourceLang, setSourceLang] = useState<SourceLanguageCode>(initialProfile?.defaultSourceLang ?? 'auto')
  const [targetLang, setTargetLang] = useState<TargetLanguageCode>(initialProfile?.defaultTargetLang ?? settings.defaultTargetLang ?? 'smart')
  const initialText = props.initialText?.trim()
  const [inputText, setInputText] = useState(initialText ?? '')
  const [view, setView] = useState<TranslationView>({ identity: '', outputText: '', status: { kind: 'idle' } })
  const [usageByProfile, setUsageByProfile] = useState(() => new Map(settings.profiles.map((profile) => [profile.id, profile.usedChars])))
  const usageRef = useRef(usageByProfile)
  usageRef.current = usageByProfile

  useEffect(() => {
    let cancelled = false
    void hostRef.current.storage.kv.get<Record<string, number>>('usage.currentMonth').then((stored) => {
      if (cancelled || !stored) return
      setUsageByProfile((current) => {
        const next = new Map(Object.entries(stored))
        if (next.size === current.size && [...next].every(([key, value]) => current.get(key) === value)) {
          return current
        }
        return next
      })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  const profiles = useMemo(() => enabledProfiles(settings), [settings])
  const sourceOptions = useMemo(() => localizedOptions(t, SOURCE_LANGUAGE_OPTIONS), [t])
  const targetOptions = useMemo(() => localizedOptions(t, TARGET_LANGUAGE_OPTIONS), [t])
  const profileOptions = useMemo<Array<SelectOption<string>>>(
    () => profiles.map((profile) => ({ label: profile.name, value: profile.id, sub: profile.provider })),
    [profiles],
  )
  const activeProfile = useMemo(
    () => profiles.find((profile) => profile.id === profileId) ?? initialProfile,
    [profiles, profileId, initialProfile],
  )
  const { controller: readinessController, readiness } = useAiTranslationReadiness(host.ai, activeProfile)
  const profileRef = useRef(activeProfile)
  profileRef.current = activeProfile
  const translateProfileKey = profileExecutionKey(activeProfile)
  const requestIdentity = JSON.stringify([inputText, sourceLang, targetLang, translateProfileKey, settings.defaultTargetLang, activeProfile?.provider === 'ai' ? readiness.revision : null])
  const identityRef = useRef(requestIdentity)
  identityRef.current = requestIdentity
  // Render-time identity also blocks stale output actions before effect cleanup runs.
  const outputText = view.identity === requestIdentity ? view.outputText : ''
  const status: TranslateStatus = view.identity === requestIdentity
    ? view.status
    : autoTranslatePausedRef.current
      ? { kind: 'settings-paused' }
      : !activeProfile
        ? { kind: 'unconfigured' }
        : activeProfile.provider === 'ai' && !readinessController.execution(host.ai, activeProfile)
          ? { kind: 'idle' }
          : isAutoTranslateReady(inputText)
            ? { kind: 'waiting', dueAt: Date.now() + AUTO_TRANSLATE_DEBOUNCE_MS }
            : { kind: 'idle' }
  const availableOutput: TranslationOutput | null = status.kind === 'success' && outputText.trim()
    ? { view, aiRevision: activeProfile?.provider === 'ai' ? readiness.revision : undefined }
    : null
  const outputRef = useRef<TranslationOutput | null>(null)
  outputRef.current = availableOutput
  const outputActionRef = useRef<TranslationOutput['view'] | null>(null)
  const [outputActionView, setOutputActionView] = useState<TranslationOutput['view'] | null>(null)

  const cancelCurrentRun = useCallback(() => {
    const run = runRef.current
    runRef.current = null
    outputRef.current = null
    if (!run) return
    if (run.timer !== undefined) window.clearTimeout(run.timer)
    run.controller.abort()
  }, [])

  useLayoutEffect(() => () => cancelCurrentRun(), [requestIdentity, cancelCurrentRun])

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!activeProfile) return
    setSourceLang(activeProfile.defaultSourceLang)
    setTargetLang(activeProfile.defaultTargetLang === 'smart' ? settings.defaultTargetLang : activeProfile.defaultTargetLang)
  }, [activeProfile?.id, settings.defaultTargetLang])

  const translateCurrentText = useCallback(async (run: TranslationRun, profile: TranslateProfile, text: string, source: SourceLanguageCode, target: TargetLanguageCode) => {
    const isCurrent = () => !autoTranslatePausedRef.current && !settingsVisitRef.current && runRef.current === run && identityRef.current === run.identity && !run.controller.signal.aborted
      && (profile.provider !== 'ai' || (readinessController.getSnapshot().revision === run.aiRevision && readinessController.matches(hostRef.current.ai, profile)))
    if (!isCurrent()) return
    run.timer = undefined
    const aiSelection = profile.provider === 'ai' ? readinessController.execution(hostRef.current.ai, profile) : undefined
    if (profile.provider === 'ai' && !aiSelection) {
      runRef.current = null
      setView({ identity: run.identity, outputText: '', status: { kind: 'idle' } })
      return
    }
    const month = currentUsageMonth()
    const normalizedProfile = resetUsageMonth(profile, month)
    const effectiveTarget = target === 'smart' ? resolveSmartTargetLang(text) : target
    const billedChars = estimateBilledChars(text)
    const currentUsed = usageRef.current.get(profile.id) ?? normalizedProfile.usedChars
    const monthlyLimit = Number(normalizedProfile.monthlyLimitChars) || 0
    if (monthlyLimit > 0 && currentUsed + billedChars > monthlyLimit) {
      setView({ identity: run.identity, outputText: '', status: { kind: 'quota-exceeded', usedChars: currentUsed, limitChars: monthlyLimit } })
      runRef.current = null
      return
    }

    const cacheKey = JSON.stringify([profileExecutionKey(profile), source, effectiveTarget, text])
    // The host can change an inherited AI provider/model without a plugin settings update.
    const cached = profile.provider === 'ai' ? undefined : cacheRef.current.get(cacheKey)
    if (cached) {
      setView({ identity: run.identity, outputText: cached.text, status: { kind: 'success', translatedAt: Date.now() } })
      runRef.current = null
      return
    }

    let preview = ''
    setView({ identity: run.identity, outputText: '', status: { kind: 'translating', requestId: run.id } })
    try {
      const result = await translateText({ text, sourceLang: source, targetLang: effectiveTarget }, normalizedProfile, hostRef.current.network, hostRef.current.ai, {
        signal: run.controller.signal,
        aiSelection,
        onText: (text) => {
          if (!isCurrent()) return
          preview = text
          setView({ identity: run.identity, outputText: text, status: { kind: 'translating', requestId: run.id } })
        },
      })
      if (!isCurrent()) return
      if (profile.provider !== 'ai') cacheRef.current.set(cacheKey, { text: result.text, billedChars: result.billedChars })
      setView({ identity: run.identity, outputText: result.text, status: { kind: 'success', translatedAt: Date.now() } })
      setUsageByProfile((current) => {
        const next = new Map(current)
        next.set(profile.id, (next.get(profile.id) ?? normalizedProfile.usedChars) + result.billedChars)
        void hostRef.current.storage.kv.set('usage.currentMonth', Object.fromEntries(next)).catch(() => {})
        return next
      })
    } catch (error) {
      if (!isCurrent()) return
      const nextStatus: TranslateStatus = error instanceof Error && error.name === 'AbortError'
        ? { kind: 'stopped' }
        : { kind: 'error', message: error instanceof Error ? error.message : '', messageKey: error instanceof AiGlossaryValidationError ? 'ai.glossary.invalidSaved' : error instanceof AiTranslationError ? `error.ai.${error.code}` : error instanceof Error ? undefined : 'error.unknown' }
      setView({ identity: run.identity, outputText: preview, status: nextStatus })
    } finally {
      if (runRef.current === run) runRef.current = null
    }
  }, [readinessController])

  useEffect(() => {
    const trimmed = inputText.trim()
    cancelCurrentRun()
    const profile = profileRef.current

    if (autoTranslatePausedRef.current || settingsVisitRef.current) {
      setView({ identity: requestIdentity, outputText: '', status: { kind: 'settings-paused' } })
      return
    }

    if (!profile || !isAutoTranslateReady(trimmed)) {
      setView({ identity: requestIdentity, outputText: '', status: { kind: profile ? 'idle' : 'unconfigured' } })
      return
    }

    if (profile.provider === 'ai' && (readinessController.getSnapshot().revision !== readiness.revision || !readinessController.execution(hostRef.current.ai, profile))) {
      setView({ identity: requestIdentity, outputText: '', status: { kind: 'idle' } })
      return
    }

    const run: TranslationRun = { id: ++requestIdRef.current, identity: requestIdentity, controller: new AbortController(), aiRevision: readiness.revision }
    runRef.current = run
    setView({ identity: requestIdentity, outputText: '', status: { kind: 'waiting', dueAt: Date.now() + AUTO_TRANSLATE_DEBOUNCE_MS } })
    run.timer = window.setTimeout(() => {
      void translateCurrentText(run, profile, trimmed, sourceLang, targetLang)
    }, AUTO_TRANSLATE_DEBOUNCE_MS)
    return cancelCurrentRun
  }, [requestIdentity, inputText, sourceLang, targetLang, translateCurrentText, cancelCurrentRun, readinessController])

  const stopTranslation = () => {
    cancelCurrentRun()
    setView((current) => ({ identity: requestIdentity, outputText: current.identity === requestIdentity ? current.outputText : '', status: { kind: 'stopped' } }))
  }

  const retryTranslation = () => {
    if (settingsVisitRef.current || identityRef.current !== requestIdentity) return
    if (activeProfile?.provider === 'ai' && readinessController.getSnapshot().revision !== readiness.revision) return
    cancelCurrentRun()
    if (!activeProfile || !isAutoTranslateReady(inputText)) return
    if (activeProfile.provider === 'ai' && !readinessController.execution(hostRef.current.ai, activeProfile)) return
    autoTranslatePausedRef.current = false
    const run: TranslationRun = { id: ++requestIdRef.current, identity: requestIdentity, controller: new AbortController(), aiRevision: readiness.revision }
    runRef.current = run
    void translateCurrentText(run, activeProfile, inputText.trim(), sourceLang, targetLang)
  }

  const openSettings = () => {
    const pauseAiTranslation = activeProfile?.provider === 'ai'
    if (pauseAiTranslation) autoTranslatePausedRef.current = true
    cancelCurrentRun()
    setView({ identity: requestIdentity, outputText: '', status: { kind: pauseAiTranslation ? 'settings-paused' : 'idle' } })
    host.openSettings()
  }

  const openAiSettings = async () => {
    const open = hostRef.current.openAppSettings
    if (!open || settingsVisitRef.current || !mountedRef.current) return
    const visit = {}
    settingsVisitRef.current = visit
    autoTranslatePausedRef.current = true
    cancelCurrentRun()
    setAppSettingsOpen(true)
    setView({ identity: identityRef.current, outputText: '', status: { kind: 'settings-paused' } })
    try {
      await open({ section: 'ai' })
      if (!mountedRef.current || settingsVisitRef.current !== visit) return
      settingsVisitRef.current = null
      setAppSettingsOpen(false)
      // Returning only checks metadata. A new account/default must not receive
      // the retained text until Retry or a real input/selection edit.
      await readinessController.refresh(true)
    } catch (error) {
      if (mountedRef.current && settingsVisitRef.current === visit && !(error instanceof Error && error.name === 'AbortError')) {
        hostRef.current.showMessage(t('ai.settingsOpenFailed'), 'error')
      }
    } finally {
      if (mountedRef.current && settingsVisitRef.current === visit) {
        settingsVisitRef.current = null
        setAppSettingsOpen(false)
      }
    }
  }

  const beginInputEdit = () => {
    if (settingsVisitRef.current) return false
    autoTranslatePausedRef.current = false
    cancelCurrentRun()
    return true
  }

  const canRetry = !appSettingsOpen && (activeProfile?.provider !== 'ai' || Boolean(readinessController.execution(host.ai, activeProfile)))

  const canUseOutput = (output: TranslationOutput | null): output is TranslationOutput =>
    isCurrentTranslationOutput(output, outputRef.current, identityRef.current, readinessController.getSnapshot().revision)

  const copyOutput = async () => {
    const output = availableOutput
    if (!canUseOutput(output) || outputActionRef.current === output.view) return
    outputActionRef.current = output.view
    setOutputActionView(output.view)
    try {
      await host.clipboard.writeText(output.view.outputText)
      if (!canUseOutput(output)) return
      host.showMessage(localizedText(t, 'toast.copied', 'Copied'), 'success')
      host.complete()
    } catch {
      if (!canUseOutput(output)) return
      host.showMessage(localizedText(t, 'toast.copyFailed', 'Copy failed'), 'error')
    } finally {
      if (outputActionRef.current === output.view && canUseOutput(output)) {
        outputActionRef.current = null
        setOutputActionView((current) => current === output.view ? null : current)
      }
    }
  }

  const continueProcessing = () => {
    const output = availableOutput
    if (!canUseOutput(output) || outputActionRef.current === output.view) return
    outputActionRef.current = output.view
    setOutputActionView(output.view)
    try {
      host.returnToLauncherWithObject({ kind: 'text', text: output.view.outputText, source: 'tool-result' })
      cancelCurrentRun()
    } catch {
      if (outputActionRef.current === output.view) {
        outputActionRef.current = null
        setOutputActionView((current) => current === output.view ? null : current)
      }
      if (!canUseOutput(output)) return
      host.showMessage(t('toast.continueFailed'), 'error')
    }
  }

  const activeUsedChars = activeProfile ? (usageByProfile.get(activeProfile.id) ?? activeProfile.usedChars) : 0
  const monthlyLimit = activeProfile?.monthlyLimitChars ?? 0
  const quotaPercent = monthlyLimit > 0 ? Math.min(100, Math.round((activeUsedChars / monthlyLimit) * 100)) : 0
  const inputChars = estimateBilledChars(inputText)
  const resolvedTarget = targetLang === 'smart' ? resolveSmartTargetLang(inputText) : targetLang
  const glossary = activeProfile?.provider === 'ai' ? validateAiGlossary(activeProfile.aiGlossary) : undefined
  const statusState = stateName(status)

  return (
    <section className="translate-surface" aria-label={localizedText(t, 'surface.title', 'Translate')}>
      <header className="translate-surface__header">
        <IconButton type="button" label={localizedText(t, 'action.back', 'Back')} onClick={() => { cancelCurrentRun(); host.requestBack() }}>
          <BackIcon size={14} strokeWidth={2} />
        </IconButton>
        <span className="translate-surface__title">{localizedText(t, 'surface.title', 'Translate')}</span>
        <div className="translate-surface__header-spacer" />
        {activeProfile?.provider === 'ai' && (status.kind === 'waiting' || status.kind === 'translating') && (
          <Button type="button" onClick={stopTranslation}>{t('action.stop')}</Button>
        )}
        {(status.kind === 'stopped' || status.kind === 'settings-paused' || status.kind === 'error') && (
          <Button type="button" onClick={retryTranslation} disabled={!canRetry}>{t('action.retry')}</Button>
        )}
        <IconButton type="button" label={t('action.continueProcessing')} disabled={!availableOutput || outputActionView === view} onClick={continueProcessing}>
          <ArrowRight size={16} />
        </IconButton>
        <Button type="button" variant="primary" disabled={!availableOutput || outputActionView === view} onClick={() => void copyOutput()}>
          {localizedText(t, 'action.copy', 'Copy')}
        </Button>
        <IconButton type="button" label={t('action.translationSettings')} onClick={openSettings}>
          <SettingsIcon size={16} />
        </IconButton>
        <IconButton type="button" label={localizedText(t, 'action.close', 'Close')} onClick={() => { cancelCurrentRun(); host.close() }}>
          <CloseIcon size={14} strokeWidth={2} />
        </IconButton>
      </header>

      <div className="translate-surface__controls">
        <div className="translate-pair">
          <SchemaSelect value={sourceLang} options={sourceOptions} onChange={(value) => { if (value !== sourceLang && beginInputEdit()) setSourceLang(value) }} width={154} ariaLabel={localizedText(t, 'control.source', 'Source')} />
          <span className="translate-pair__arrow"><ArrowRight size={15} strokeWidth={1.9} /></span>
          <SchemaSelect value={targetLang} options={targetOptions} onChange={(value) => { if (value !== targetLang && beginInputEdit()) setTargetLang(value) }} width={136} ariaLabel={localizedText(t, 'control.target', 'Target')} />
        </div>
        <div className="grow" />
        <span className="translate-controls-label">{localizedText(t, 'control.profile', 'Profile')}</span>
        <SchemaSelect value={activeProfile?.id ?? ''} options={profileOptions} onChange={(value) => { if (value !== profileId && beginInputEdit()) setProfileId(value) }} width={222} ariaLabel={localizedText(t, 'control.profile', 'Profile')} />
      </div>

      {activeProfile?.provider === 'ai' && (
        <AiReadinessNotice readiness={readiness} profile={activeProfile} t={t} onRefresh={() => { cancelCurrentRun(); void readinessController.refresh(true) }} onSettings={openSettings} onAppSettings={host.openAppSettings ? () => { void openAiSettings() } : undefined} />
      )}
      {glossary && (!glossary.ok || glossary.value) && (
        <p className="translate-glossary-notice" role="status">
          {!glossary.ok ? t('ai.glossary.invalidSaved') : glossary.value && t(glossary.value.targetLang === resolvedTarget ? 'ai.glossary.applies' : 'ai.glossary.notApplied').replace('{language}', t(`language.${glossary.value.targetLang}`))}
        </p>
      )}

      <div className="translate-surface__body">
        <div className="translate-pane translate-pane--source">
          <div className="translate-pane__eyebrow">
            {localizedText(t, 'pane.original', 'Original')}
            <span className="detected">· {sourceLang === 'auto' ? optionLabel(sourceOptions, sourceLang) : optionLabel(sourceOptions, sourceLang)}</span>
          </div>
          <textarea
            ref={inputRef}
            className="translate-input"
            value={inputText}
            onChange={(event) => {
              if (event.target.value === inputText) return
              if (!beginInputEdit()) return
              setInputText(event.target.value)
            }}
            placeholder={localizedText(t, 'input.placeholder', 'Type or paste text to translate...')}
            spellCheck={false}
          />
        </div>
        <div className="translate-pane translate-pane--target">
          <div className="translate-pane__eyebrow">
            {localizedText(t, 'pane.translation', 'Translation')}
            <span className="detected">· {optionLabel(targetOptions, resolvedTarget)}</span>
            {outputText && status.kind !== 'success' && <span className="detected">· {t('pane.incomplete')}</span>}
          </div>
          <textarea
            className={`translate-output ${status.kind !== 'success' ? 'is-stale' : ''}`}
            value={outputText}
            placeholder={localizedText(t, 'output.placeholder', 'Translation appears here.')}
            aria-label={localizedText(t, 'pane.translation', 'Translation')}
            aria-live="polite"
            aria-busy={status.kind === 'translating'}
            readOnly
            spellCheck={false}
          />
        </div>
      </div>

      <footer className="translate-surface__status">
        <div
          className="translate-status"
          data-state={statusState}
          role={status.kind === 'error' || status.kind === 'quota-exceeded' ? 'alert' : 'status'}
        >
          <span className="translate-status__dot" />
          <LoaderCircle className="translate-status__spin" size={13} strokeWidth={2.2} />
          <AlertTriangle className="translate-status__alert" size={13} strokeWidth={1.9} />
          <span className="translate-status__label">{statusLabel(status, t)}</span>
        </div>
        <div className="grow" />
        <div className="translate-meta">
          <span>{localizedText(t, inputChars === 1 ? 'meta.character' : 'meta.characters', inputChars === 1 ? '{count} character' : '{count} characters').replace('{count}', inputChars.toLocaleString())}</span>
          {(activeProfile?.provider !== 'ai' || monthlyLimit > 0) && <>
          <span className="sep">·</span>
          <div className={`translate-quota ${status.kind === 'quota-exceeded' ? 'is-over' : ''}`}>
            <span className="translate-quota__num">{formatLimit(activeUsedChars)} / {formatLimit(monthlyLimit)}</span>
            <span className="translate-quota__bar"><span className="translate-quota__fill" style={{ width: `${quotaPercent}%` }} /></span>
          </div>
          </>}
        </div>
      </footer>
    </section>
  )
}
