import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { PluginSurfaceProps } from '@hiven/plugin'
import { IconButton, Select, TextArea } from '@hiven/plugin-ui'
import { CloseIcon, SettingsIcon } from '@hiven/plugin-ui/icons'
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

const TARGET_LANGUAGE_OPTIONS: Array<{ label: string; value: TargetLanguageCode }> = [
  { label: 'Smart', value: 'smart' },
  { label: '中文', value: 'zh' },
  { label: 'English', value: 'en' },
  { label: '日本語', value: 'ja' },
  { label: '한국어', value: 'ko' },
  { label: 'Français', value: 'fr' },
  { label: 'Deutsch', value: 'de' },
  { label: 'Español', value: 'es' },
]

const SOURCE_LANGUAGE_OPTIONS: Array<{ label: string; value: SourceLanguageCode }> = [
  { label: 'Auto', value: 'auto' },
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

function displayLimit(value: number): string {
  return value > 0 ? value.toLocaleString() : '∞'
}

function statusText(status: TranslateStatus): string {
  if (status.kind === 'waiting') return 'waiting'
  if (status.kind === 'translating') return 'translating'
  if (status.kind === 'success') return 'translated'
  if (status.kind === 'error') return `failed · ${status.message}`
  if (status.kind === 'quota-exceeded') return `quota exceeded · ${status.usedChars.toLocaleString()} / ${status.limitChars.toLocaleString()}`
  return 'idle'
}

function resetUsageMonth(profile: TranslateProfile, month: string): TranslateProfile {
  if (profile.usedCharsMonth === month) return profile
  return { ...profile, usedCharsMonth: month, usedChars: 0 }
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
        const serializable = Object.fromEntries(next)
        void host.storage.kv.set('usage.currentMonth', serializable).catch(() => {})
        return next
      })
      setStatus({ kind: 'success', translatedAt: Date.now() })
    } catch (error) {
      if (requestIdRef.current !== requestId) return
      setStatus({ kind: 'error', message: error instanceof Error ? error.message : 'Unknown error' })
    }
  }, [host.storage, usageByProfile])

  useEffect(() => {
    const trimmed = inputText.trim()
    requestIdRef.current += 1
    const requestId = requestIdRef.current

    if (!activeProfile || trimmed.length < MIN_TRANSLATE_CHARS) {
      setOutputText('')
      setStatus({ kind: 'idle' })
      return
    }

    const dueAt = Date.now() + AUTO_TRANSLATE_DEBOUNCE_MS
    setStatus({ kind: 'waiting', dueAt })
    const timer = window.setTimeout(() => {
      void translateCurrentText(requestId, activeProfile, trimmed, sourceLang, targetLang)
    }, AUTO_TRANSLATE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [inputText, activeProfile, sourceLang, targetLang, translateCurrentText])

  const activeUsedChars = activeProfile ? (usageByProfile.get(activeProfile.id) ?? activeProfile.usedChars) : 0
  const inputChars = estimateBilledChars(inputText)

  return (
    <div className="translate-surface">
      <div className="translate-surface-ambient" aria-hidden="true" />
      <header className="translate-surface-header">
        <div className="translate-surface-title-block">
          <div className="translate-surface-kicker">Global utility</div>
          <h2>Translate</h2>
        </div>
        <div className="translate-surface-header-actions">
          <IconButton label="Settings" onClick={() => host.openSettings()}><SettingsIcon size={16} /></IconButton>
          <IconButton label="Close" onClick={() => host.close()}><CloseIcon size={16} /></IconButton>
        </div>
      </header>

      <section className="translate-surface-controls" aria-label="Translate controls">
        <label>
          <span>Profile</span>
          <Select
            value={profileId}
            onChange={(event) => setProfileId(event.target.value)}
            options={profiles.map((profile) => ({ label: profile.name, value: profile.id }))}
          />
        </label>
        <label>
          <span>Source</span>
          <Select value={sourceLang} onChange={(event) => setSourceLang(event.target.value as SourceLanguageCode)} options={SOURCE_LANGUAGE_OPTIONS} />
        </label>
        <div className="translate-surface-swap" aria-hidden="true">⇄</div>
        <label>
          <span>Target</span>
          <Select value={targetLang} onChange={(event) => setTargetLang(event.target.value as TargetLanguageCode)} options={TARGET_LANGUAGE_OPTIONS} />
        </label>
      </section>

      <main className="translate-surface-editor-grid">
        <section className="translate-surface-pane translate-surface-input-pane">
          <div className="translate-surface-pane-head">
            <span>Original</span>
            <span>{inputChars.toLocaleString()} chars</span>
          </div>
          <TextArea
            ref={inputRef}
            value={inputText}
            onChange={(event) => setInputText(event.target.value)}
            placeholder="Type or paste text here. Translation starts automatically after 800ms."
            spellCheck={false}
            className="translate-surface-input"
          />
        </section>
        <section className="translate-surface-pane translate-surface-output-pane">
          <div className="translate-surface-pane-head">
            <span>Translation</span>
            <span>{targetLang === 'smart' ? `smart → ${inputText.trim() ? resolveSmartTargetLang(inputText) : 'zh'}` : targetLang}</span>
          </div>
          <div className="translate-surface-output" aria-live="polite">
            {outputText ? outputText : <span className="translate-surface-output-placeholder">The translated text will appear here as selectable text.</span>}
          </div>
        </section>
      </main>

      <footer className="translate-surface-statusbar">
        <span className={`translate-surface-status translate-surface-status-${status.kind}`}>{statusText(status)}</span>
        <span>{activeProfile ? `${activeProfile.name} · ${activeProfile.provider}` : 'No profile'}</span>
        <span>{activeUsedChars.toLocaleString()} / {displayLimit(activeProfile?.monthlyLimitChars ?? 0)} monthly chars</span>
      </footer>
    </div>
  )
}
