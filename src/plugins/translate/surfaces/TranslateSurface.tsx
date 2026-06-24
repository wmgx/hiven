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

const TARGET_LANGUAGE_OPTIONS: Array<SelectOption<TargetLanguageCode>> = [
  { label: 'Smart', value: 'smart', sub: 'auto target' },
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
  { label: 'Français', value: 'fr' },
  { label: 'Deutsch', value: 'de' },
  { label: 'Español', value: 'es' },
]

const SOURCE_LANGUAGE_OPTIONS: Array<SelectOption<SourceLanguageCode>> = [
  { label: 'Auto-detect', value: 'auto' },
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
  { label: 'Français', value: 'fr' },
  { label: 'Deutsch', value: 'de' },
  { label: 'Español', value: 'es' },
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

function statusLabel(status: TranslateStatus): string {
  if (status.kind === 'waiting') return 'Waiting to translate...'
  if (status.kind === 'translating') return 'Translating...'
  if (status.kind === 'success') return 'Translated'
  if (status.kind === 'error') return `Translation failed - ${status.message}`
  if (status.kind === 'quota-exceeded') return 'Monthly quota reached'
  return 'Idle'
}

function optionLabel<T extends string>(options: Array<SelectOption<T>>, value: T): string {
  return options.find((option) => option.value === value)?.label ?? value
}

function formatLimit(value: number): string {
  if (value <= 0) return '∞'
  if (value >= 1000) return `${Math.round(value / 100) / 10}k`
  return value.toLocaleString()
}

function TranslateSelect<T extends string>({
  value,
  options,
  onChange,
  width,
}: {
  value: T
  options: Array<SelectOption<T>>
  onChange: (value: T) => void
  width?: number
}) {
  const selected = options.find((option) => option.value === value) ?? options[0]
  return (
    <label className="translate-select" style={width ? { width } : undefined}>
      <select
        className="translate-select__control"
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        aria-label={selected?.label}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.sub ? `${option.label} · ${option.sub}` : option.label}
          </option>
        ))}
      </select>
      <span className="translate-select__trigger" aria-hidden="true">
        <span className="translate-select__value">
          {selected?.label}
          {selected?.sub && <span className="translate-surface__menu-sub"> · {selected.sub}</span>}
        </span>
        <ChevronDown className="translate-select__chev" size={14} strokeWidth={2} />
      </span>
      <Check className="translate-surface__menu-check" size={0} aria-hidden="true" />
    </label>
  )
}

export function TranslateSurface(props: PluginSurfaceProps<TranslateSettings>) {
  const { host, settings } = props
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
          <span className="translate-surface__title">Translate</span>
        </div>
        <div className="translate-surface__header-spacer" />
        <span className="translate-kbd" title="Recommended global shortcut"><kbd>⌘</kbd><kbd>⇧</kbd><kbd>T</kbd></span>
        <button className="translate-iconbtn" type="button" aria-label="Settings" onClick={() => host.openSettings()}>
          <Settings size={16} strokeWidth={1.75} />
        </button>
        <button className="translate-iconbtn" type="button" aria-label="Close" onClick={() => host.close()}>
          <X size={16} strokeWidth={1.9} />
        </button>
      </header>

      <div className="translate-surface__controls">
        <div className="translate-pair">
          <TranslateSelect value={sourceLang} options={SOURCE_LANGUAGE_OPTIONS} onChange={setSourceLang} width={154} />
          <span className="translate-pair__arrow"><ArrowRight size={15} strokeWidth={1.9} /></span>
          <TranslateSelect value={targetLang} options={TARGET_LANGUAGE_OPTIONS} onChange={setTargetLang} width={136} />
        </div>
        <div className="grow" />
        <span className="translate-controls-label">Profile</span>
        <TranslateSelect value={profileId} options={profileOptions} onChange={setProfileId} width={222} />
      </div>

      <div className="translate-surface__body">
        <div className={`translate-pane translate-pane--source ${inputFocused ? 'is-focused' : ''}`}>
          <div className="translate-pane__eyebrow">
            Original
            <span className="detected">· {sourceLang === 'auto' ? 'auto-detect' : optionLabel(SOURCE_LANGUAGE_OPTIONS, sourceLang)}</span>
          </div>
          <textarea
            ref={inputRef}
            className="translate-input"
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            onFocus={() => setInputFocused(true)}
            onBlur={() => setInputFocused(false)}
            placeholder="Type or paste text to translate..."
            spellCheck={false}
          />
        </div>
        <div className="translate-pane translate-pane--target">
          <div className="translate-pane__eyebrow">
            Translation
            <span className="detected">· {optionLabel(TARGET_LANGUAGE_OPTIONS, resolvedTarget)}</span>
          </div>
          <div className={`translate-output ${outputText ? '' : 'is-empty'} ${status.kind === 'translating' ? 'is-stale' : ''}`} aria-live="polite">
            {outputText || 'Translation appears here.'}
          </div>
        </div>
      </div>

      <footer className="translate-surface__status">
        <div className="translate-status" data-state={statusState}>
          <span className="translate-status__dot" />
          <LoaderCircle className="translate-status__spin" size={13} strokeWidth={2.2} />
          <AlertTriangle className="translate-status__alert" size={13} strokeWidth={1.9} />
          <span className="translate-status__label">{statusLabel(status)}</span>
        </div>
        <div className="grow" />
        <div className="translate-meta">
          <span>{inputChars.toLocaleString()} {inputChars === 1 ? 'character' : 'characters'}</span>
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
