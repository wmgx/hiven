import { useEffect, useState } from 'react'
import { Button, NumberField, Switch, TextArea } from '../plugin-ui'
import { useT } from '../i18n'
import { useAppStore } from '../store'
import { isNativeDesktopRuntime } from '../workspace/webNativeBridge'
import {
  screenshotDefaults,
  keyboardDefaults,
  observationStorage,
  SCREENSHOT_STATE_KEY,
  KEYBOARD_STATE_KEY,
  SCREENSHOT_TERMINAL_STATUSES,
  KEYBOARD_TERMINAL_STATUSES,
  type Observation,
  type ScreenshotObservationState,
  type KeyboardObservationEvent,
  type KeyboardObservationState,
} from './observer'
import { decodeObservationVideo } from './video'
import './style.css'

function ScreenshotSection() {
  const settings = useAppStore((state) => state.settings)
  const updateSetting = useAppStore((state) => state.updateSetting)
  const locale = useAppStore((state) => state.locale)
  const t = useT('observation')
  const value = settings.behaviorObservation ?? screenshotDefaults
  const [state, setState] = useState<ScreenshotObservationState>()
  const [selected, setSelected] = useState<Observation>()
  const [imageUrl, setImageUrl] = useState('')
  const [loadError, setLoadError] = useState(false)
  const desktop = isNativeDesktopRuntime()
  const updateValue = (patch: Partial<typeof screenshotDefaults>) => {
    updateSetting('behaviorObservation', { ...value, ...patch })
  }

  useEffect(() => {
    let active = true
    const read = async () => {
      try {
        const next = await observationStorage.kv.get<ScreenshotObservationState>(SCREENSHOT_STATE_KEY)
        if (active) { setState(next); setLoadError(false) }
      } catch {
        if (active) setLoadError(true)
      }
    }
    void read()
    const timer = setInterval(() => { void read() }, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  useEffect(() => {
    let active = true
    let ownedUrl = ''
    setImageUrl('')
    void (async () => {
      try {
        const url = selected?.video
          ? URL.createObjectURL(await decodeObservationVideo(selected.video, observationStorage.blob.get))
          : selected?.blobId ? await observationStorage.blob.url(selected.blobId) : ''
        if (!active) {
          if (selected?.video && url) URL.revokeObjectURL(url)
          return
        }
        if (selected?.video) ownedUrl = url
        setImageUrl(url)
      } catch {
        if (active) setLoadError(true)
      }
    })()
    return () => {
      active = false
      if (ownedUrl) URL.revokeObjectURL(ownedUrl)
    }
  }, [selected?.id])

  const formatTime = (at: number) => new Date(at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
  const stale = state && Date.now() - state.updatedAt > 20000
  const status = !value.enabled ? 'off' : !desktop ? 'desktop-required' : !state ? 'waiting'
    : SCREENSHOT_TERMINAL_STATUSES.includes(state.status) || ['complete', 'full'].includes(state.status)
      ? state.status : stale ? 'inactive' : state.status
  const canRetry = value.enabled && desktop && SCREENSHOT_TERMINAL_STATUSES.includes(status)
  const retry = () => updateValue({ retryNonce: Date.now() })

  return (
    <section className="behavior-observer-section" aria-label={t('title')}>
      <header><h2>{t('title')}</h2><p className="behavior-observer-muted">{t('description')}</p></header>
      <div className="behavior-observer-toggle">
        <div><strong>{t('settings.enabled')}</strong><p>{t('settings.notice')}</p></div>
        <Switch checked={value.enabled} disabled={!value.enabled && !desktop}
          aria-label={t('settings.enabled')} onCheckedChange={(enabled) => updateValue({ enabled })} />
      </div>
      <p role="status" aria-live="polite">
        {t(`status.${status}`, { max: value.maxStorageMB ?? screenshotDefaults.maxStorageMB })}
      </p>
      {!desktop && status !== 'desktop-required' && <p>{t('status.desktop-required')}</p>}
      {canRetry && <div className="behavior-observer-retry">
        {state?.lastErrorDetail && <p className="behavior-observer-error-detail">{t('error.detail', { detail: state.lastErrorDetail })}</p>}
        <Button variant="secondary" onClick={retry}>{t('retry')}</Button>
      </div>}
      <p className="behavior-observer-muted">{t('settings.scope')}</p>
      <label className="behavior-observer-toggle">
        <span>{t('settings.interval')}</span>
        <NumberField value={value.intervalSeconds} min={15} max={300} step={15}
          aria-label={t('settings.interval')} onChange={(intervalSeconds) => updateValue({ intervalSeconds })} />
      </label>
      <label className="behavior-observer-toggle">
        <span>{t('settings.maxStorage')}</span>
        <NumberField value={value.maxStorageMB ?? screenshotDefaults.maxStorageMB} min={100} max={5000} step={100}
          aria-label={t('settings.maxStorage')} onChange={(maxStorageMB) => updateValue({ maxStorageMB })} />
      </label>
      <label className="behavior-observer-toggle">
        <span>{t('settings.maxDays')}</span>
        <NumberField value={value.maxDays ?? screenshotDefaults.maxDays} min={1} max={30} step={1}
          aria-label={t('settings.maxDays')} onChange={(maxDays) => updateValue({ maxDays })} />
      </label>
      <label className="behavior-observer-field">
        <span>{t('settings.excluded')}</span>
        <TextArea value={value.excludedApps} rows={3} aria-label={t('settings.excluded')}
          onChange={(event) => updateValue({ excludedApps: event.target.value })} />
      </label>
      <p className="behavior-observer-muted">{t('settings.privacy')}</p>
      {state && <p>{t('summary', { count: state.count, size: (state.bytes / 1024 / 1024).toFixed(1), end: formatTime(state.endsAt) })}</p>}
      {loadError && <p role="alert">{t('error.load')}</p>}
      <h3>{t('recent.title')}</h3>
      <p className="behavior-observer-muted">{t('recent.storage')}</p>
      <p className="behavior-observer-muted">{t('recent.compression')}</p>
      {!state?.recent.length && <p>{t('recent.empty')}</p>}
      <ul className="behavior-observer-records">
        {state?.recent.map((item) => (
          <li key={item.id}>
            <Button variant="ghost" onClick={() => setSelected(item)}>
              {formatTime(item.capturedAt)} · {item.appName}
            </Button>
          </li>
        ))}
      </ul>
      {selected && <div className="behavior-observer-preview">
        <div className="behavior-observer-toggle">
          <strong>{selected.windowTitle || selected.appName}</strong>
          <Button variant="ghost" onClick={() => setSelected(undefined)}>{t('preview.close')}</Button>
        </div>
        {imageUrl && <img src={imageUrl} alt={t('preview.image')} />}
        <pre>{selected.text || t('preview.noText')}</pre>
      </div>}
    </section>
  )
}

function KeyboardSection() {
  const settings = useAppStore((state) => state.settings)
  const updateSetting = useAppStore((state) => state.updateSetting)
  const locale = useAppStore((state) => state.locale)
  const t = useT('observation')
  const value = settings.keyboardObservation ?? keyboardDefaults
  const [state, setState] = useState<KeyboardObservationState>()
  const [loadError, setLoadError] = useState(false)
  const desktop = isNativeDesktopRuntime()
  const updateValue = (patch: Partial<typeof keyboardDefaults>) => {
    updateSetting('keyboardObservation', { ...value, ...patch })
  }

  useEffect(() => {
    let active = true
    const read = async () => {
      try {
        const next = await observationStorage.kv.get<KeyboardObservationState>(KEYBOARD_STATE_KEY)
        if (active) { setState(next); setLoadError(false) }
      } catch {
        if (active) setLoadError(true)
      }
    }
    void read()
    const timer = setInterval(() => { void read() }, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [])

  const formatTime = (at: number) => new Date(at).toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
  const stale = state && Date.now() - state.updatedAt > 20000
  const status = !value.enabled ? 'off' : !desktop ? 'desktop-required' : !state ? 'waiting'
    : KEYBOARD_TERMINAL_STATUSES.includes(state.status) || ['complete', 'full'].includes(state.status)
      ? state.status : stale ? 'inactive' : state.status
  const canRetry = value.enabled && desktop && KEYBOARD_TERMINAL_STATUSES.includes(status)
  const retry = () => updateValue({ retryNonce: Date.now() })
  const formatShortcut = (event: KeyboardObservationEvent) => {
    const symbol: Record<string, string> = { Meta: '⌘', Control: '⌃', Alt: '⌥', Shift: '⇧', Fn: 'fn' }
    const modifiers = event.modifiers.filter((modifier) => modifier !== event.key).map((modifier) => symbol[modifier] ?? modifier)
    return [...modifiers, event.key || `KeyCode ${event.keyCode}`].join(' + ')
  }

  return (
    <section className="behavior-observer-section" aria-label={t('keyboard.title')}>
      <header><h2>{t('keyboard.title')}</h2></header>
      <div className="behavior-observer-toggle">
        <div><strong>{t('keyboard.enabled')}</strong><p>{t('keyboard.notice')}</p></div>
        <Switch checked={Boolean(value.enabled)} disabled={!value.enabled && !desktop}
          aria-label={t('keyboard.enabled')} onCheckedChange={(enabled) => updateValue({ enabled })} />
      </div>
      <p role="status" aria-live="polite">{t(`keyboard.status.${status}`)}</p>
      {canRetry && <div className="behavior-observer-retry">
        <Button variant="secondary" onClick={retry}>{t('retry')}</Button>
      </div>}
      <label className="behavior-observer-field">
        <span>{t('settings.excluded')}</span>
        <TextArea value={value.excludedApps} rows={3} aria-label={t('settings.excluded')}
          onChange={(event) => updateValue({ excludedApps: event.target.value })} />
      </label>
      <p className="behavior-observer-muted">{t('keyboard.scope')}</p>
      {state && <p>{t('keyboard.summary', { count: state.count })}</p>}
      {loadError && <p role="alert">{t('error.load')}</p>}
      <h3>{t('keyboard.recent.title')}</h3>
      {!state?.recent.length && <p>{t('keyboard.recent.empty')}</p>}
      <ul className="behavior-observer-records">
        {state?.recent.slice(0, 50).map((event, index) => (
          <li key={`${event.at}-${event.keyCode}-${event.repeat}-${index}`}>
            {formatTime(event.at)} · {event.appName} · <kbd>{formatShortcut(event)}</kbd>{event.repeat && ` · ${t('keyboard.repeat')}`}
          </li>
        ))}
      </ul>
    </section>
  )
}

export function ObservationSettings() {
  return (
    <div className="sscroll behavior-observer">
      <ScreenshotSection />
      <KeyboardSection />
    </div>
  )
}
