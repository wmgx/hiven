import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { AlertTriangle, ArrowRight, Check, ChevronDown, Languages, LoaderCircle, Settings, X } from 'lucide-react'
import type { LanguageCode, SourceLanguageCode, TargetLanguageCode, TranslateProfile, TranslateSettings } from '../settings/model'
import { currentUsageMonth } from '../settings/model'
import { estimateBilledChars, resolveSmartTargetLang, translateText } from '../providers/adapters'

const AUTO_TRANSLATE_DEBOUNCE_MS = 800
const MIN_TRANSLATE_CHARS = 3

type TranslateStatus =
  | { kind: 'idle' }
  | { kind: 'waiting'; dueAt: number }
  | { kind: 'translating'; requestId: number }
  | { kind: 'success'; translatedAt: number }
  | { kind: 'error'; message: string }
  | { kind: 'quota-exceeded'; usedChars: number; limitChars: number }

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
  return enabledProfiles(settings).find((profile) => profile.id === settings.defaultProfileId) ?? enabledProfiles(settings)[0] ?? settings.profiles[0]
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
  if (status.kind === 'waiting') return localizedText(t, 'status.waiting', 'Waiting to translate...')
  if (status.kind === 'translating') return localizedText(t, 'status.translating', 'Translating...')
  if (status.kind === 'success') return localizedText(t, 'status.success', 'Translated')
  if (status.kind === 'error') {
    return localizedText(t, 'status.error', 'Translation failed - {message}').replace('{message}', status.message)
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
  const selected = options.find((option) => option.value === value) ?? options[0]
  const [open, setOpen] = useState(false)
  return (
    <div
      className={`schema-select-wrap translate-select ${open ? 'is-open' : ''}`}
      style={width ? { width } : undefined}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
      }}
    >
      <button
        type="button"
        className="schema-select-trigger"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span className="schema-select-label translate-select__value">
          {selected?.label}
          {selected?.sub && <span className="translate-surface__menu-sub"> · {selected.sub}</span>}
        </span>
        <ChevronDown className="schema-select-chevron" size={14} strokeWidth={1.8} />
      </button>
      {open && (
        <div className="schema-select-menu" role="listbox">
          {options.map((option) => {
            const selectedOption = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={selectedOption}
                className={`schema-select-option ${selectedOption ? 'is-selected' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span>
                  {option.label}
                  {option.sub && <span className="translate-surface__menu-sub"> · {option.sub}</span>}
                </span>
                {selectedOption && <Check className="schema-select-check" size={13} strokeWidth={2} />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function TranslateSurface(props: PluginSurfaceProps<TranslateSettings>) {
  const { host, settings, t } = props
  const inputRef = useRef<HTMLTextAreaElement>(null)
  const requestIdRef = useRef(0)
  const cacheRef = useRef(new Map<string, CacheEntry>())

  const initialProfile = useMemo(() => selectInitialProfile(settings), [settings])
  const [profileId, setProfileId] = useState(initialProfile?.id ?? '')
  const [sourceLang, setSourceLang] = useState<SourceLanguageCode>(initialProfile?.defaultSourceLang ?? 'auto')
  const [targetLang, setTargetLang] = useState<TargetLanguageCode>(initialProfile?.defaultTargetLang ?? settings.defaultTargetLang ?? 'smart')
  const [inputText, setInputText] = useState('')
  const [outputText, setOutputText] = useState('')
  const [inputFocused, setInputFocused] = useState(false)
  const [status, setStatus] = useState<TranslateStatus>({ kind: 'idle' })
  const [usageByProfile, setUsageByProfile] = useState(() => new Map(settings.profiles.map((profile) => [profile.id, profile.usedChars])))

  useEffect(() => {
    let cancelled = false
    void host.storage.kv.get<Record<string, number>>('usage.currentMonth').then((stored) => {
      if (cancelled || !stored) return
      setUsageByProfile(new Map(Object.entries(stored)))
    }).catch(() => {})
    return () => { cancelled = true }
  }, [host.storage])

  const profiles = useMemo(() => enabledProfiles(settings), [settings])
  const sourceOptions = useMemo(() => localizedOptions(t, SOURCE_LANGUAGE_OPTIONS), [t])
  const targetOptions = useMemo(() => localizedOptions(t, TARGET_LANGUAGE_OPTIONS), [t])
  const profileOptions = useMemo<Array<SelectOption<string>>>(
    () => profiles.map((profile) => ({ label: profile.name, value: profile.id, sub: profile.provider })),
    [profiles],
  )
  const activeProfile = useMemo(
    () => settings.profiles.find((profile) => profile.id === profileId) ?? initialProfile,
    [settings.profiles, profileId, initialProfile],
  )

  useEffect(() => {
    const frame = requestAnimationFrame(() => inputRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [])

  useEffect(() => {
    if (!activeProfile) return
    setSourceLang(activeProfile.defaultSourceLang)
    setTargetLang(activeProfile.defaultTargetLang === 'smart' ? settings.defaultTargetLang : activeProfile.defaultTargetLang)
  }, [activeProfile?.id, settings.defaultTargetLang])

  const translateCurrentText = useCallback(async (requestId: number, profile: TranslateProfile, text: string, source: SourceLanguageCode, target: TargetLanguageCode) => {
    const month = currentUsageMonth()
    const normalizedProfile = resetUsageMonth(profile, month)
    const effectiveTarget = target === 'smart' ? resolveSmartTargetLang(text) : target
    const billedChars = estimateBilledChars(text)
    const currentUsed = usageByProfile.get(profile.id) ?? normalizedProfile.usedChars
    const monthlyLimit = Number(normalizedProfile.monthlyLimitChars) || 0
    if (monthlyLimit > 0 && currentUsed + billedChars > monthlyLimit) {
      setStatus({ kind: 'quota-exceeded', usedChars: currentUsed, limitChars: monthlyLimit })
      return
    }

    const cacheKey = `${profile.id}\0${source}\0${effectiveTarget}\0${text}`
    const cached = cacheRef.current.get(cacheKey)
    if (cached) {
      setOutputText(cached.text)
      setStatus({ kind: 'success', translatedAt: Date.now() })
      return
    }

    setStatus({ kind: 'translating', requestId })
    try {
      const result = await translateText({ text, sourceLang: source, targetLang: effectiveTarget }, normalizedProfile, host.network)
      if (requestIdRef.current !== requestId) return
      cacheRef.current.set(cacheKey, { text: result.text, billedChars: result.billedChars })
      setOutputText(result.text)
      setUsageByProfile((current) => {
        const next = new Map(current)
        next.set(profile.id, (next.get(profile.id) ?? normalizedProfile.usedChars) + result.billedChars)
        void host.storage.kv.set('usage.currentMonth', Object.fromEntries(next)).catch(() => {})
        return next
      })
      setStatus({ kind: 'success', translatedAt: Date.now() })
    } catch (error) {
      if (requestIdRef.current !== requestId) return
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown error' })
    }
  }, [host.network, host.storage, usageByProfile])

  useEffect(() => {
    const trimmed = inputText.trim()
    requestIdRef.current += 1
    const requestId = requestIdRef.current

    if (!activeProfile || trimmed.length < MIN_TRANSLATE_CHARS) {
      setOutputText('')
      setStatus({ kind: 'idle' })
      return
    }

    setStatus({ kind: 'waiting', dueAt: Date.now() + AUTO_TRANSLATE_DEBOUNCE_MS })
    const timer = window.setTimeout(() => {
      void translateCurrentText(requestId, activeProfile, trimmed, sourceLang, targetLang)
    }, AUTO_TRANSLATE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [inputText, activeProfile, sourceLang, targetLang, translateCurrentText])

  const activeUsedChars = activeProfile ? (usageByProfile.get(activeProfile.id) ?? activeProfile.usedChars) : 0
  const monthlyLimit = activeProfile?.monthlyLimitChars ?? 0
  const quotaPercent = monthlyLimit > 0 ? Math.min(100, Math.round((activeUsedChars / monthlyLimit) * 100)) : 0
  const inputChars = estimateBilledChars(inputText)
  const resolvedTarget = targetLang === 'smart' ? resolveSmartTargetLang(inputText) : targetLang
  const statusState = stateName(status)

  return (
    <section className="translate-surface" aria-label="Translate">
      <header className="translate-surface__header">
        <div className="translate-surface__brand">
          <Languages size={15} strokeWidth={1.75} />
          <span className="translate-surface__title">{localizedText(t, 'surface.title', 'Translate')}</span>
        </div>
        <div className="translate-surface__header-spacer" />
        <button className="translate-iconbtn" type="button" aria-label={localizedText(t, 'action.openSettings', 'Open Settings')} onClick={() => host.openSettings()}>
          <Settings size={16} strokeWidth={1.75} />
        </button>
        <button className="translate-iconbtn" type="button" aria-label={localizedText(t, 'action.close', 'Close')} onClick={() => host.close()}>
          <X size={16} strokeWidth={1.9} />
        </button>
      </header>

      <div className="translate-surface__controls">
        <div className="translate-pair">
          <SchemaSelect value={sourceLang} options={sourceOptions} onChange={setSourceLang} width={154} ariaLabel={localizedText(t, 'control.source', 'Source')} />
          <span className="translate-pair__arrow"><ArrowRight size={15} strokeWidth={1.9} /></span>
          <SchemaSelect value={targetLang} options={targetOptions} onChange={setTargetLang} width={136} ariaLabel={localizedText(t, 'control.target', 'Target')} />
        </div>
        <div className="grow" />
        <span className="translate-controls-label">{localizedText(t, 'control.profile', 'Profile')}</span>
        <SchemaSelect value={profileId} options={profileOptions} onChange={setProfileId} width={222} ariaLabel={localizedText(t, 'control.profile', 'Profile')} />
      </div>

      <div className="translate-surface__body">
        <div className={`translate-pane translate-pane--source ${inputFocused ? 'is-focused' : ''}`}>
          <div className="translate-pane__eyebrow">
            {localizedText(t, 'pane.original', 'Original')}
            <span className="detected">· {sourceLang === 'auto' ? optionLabel(sourceOptions, sourceLang) : optionLabel(sourceOptions, sourceLang)}</span>
          </div>
          <textarea
            ref={inputRef}
            className="translate-input"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder={localizedText(t, 'input.placeholder', 'Type or paste text to translate...')}
            spellCheck={false}
          />
        </div>
        <div className="translate-pane translate-pane--target">
          <div className="translate-pane__eyebrow">
            {localizedText(t, 'pane.translation', 'Translation')}
            <span className="detected">· {optionLabel(targetOptions, resolvedTarget)}</span>
          </div>
          <div className={`translate-output ${outputText ? '' : 'is-empty'} ${status.kind === 'translating' ? 'is-stale' : ''}`} aria-live="polite">
            {outputText || localizedText(t, 'output.placeholder', 'Translation appears here.')}
          </div>
        </div>
      </div>

      <footer className="translate-surface__status">
        <div className="translate-status" data-state={statusState}>
          <span className="translate-status__dot" />
          <LoaderCircle className="translate-status__spin" size={13} strokeWidth={2.2} />
          <AlertTriangle className="translate-status__alert" size={13} strokeWidth={1.9} />
          <span className="translate-status__label">{statusLabel(status, t)}</span>
        </div>
        <div className="grow" />
        <div className="translate-meta">
          <span>{localizedText(t, inputChars === 1 ? 'meta.character' : 'meta.characters', inputChars === 1 ? '{count} character' : '{count} characters').replace('{count}', inputChars.toLocaleString())}</span>
          <span className="sep">·</span>
          <div className={`translate-quota ${status.kind === 'quota-exceeded' ? 'is-over' : ''}`}>
            <span className="translate-quota__num">{formatLimit(activeUsedChars)} / {formatLimit(monthlyLimit)}</span>
            <span className="translate-quota__bar"><span className="translate-quota__fill" style={{ width: `${quotaPercent}%` }} /></span>
          </div>
        </div>
      </footer>
    </section>
  )
}
