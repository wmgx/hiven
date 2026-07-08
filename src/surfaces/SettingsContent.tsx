import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { Check, Command, Download, Hash, Languages, Moon, RefreshCw, Save, Type, WrapText } from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../i18n'
import { checkBuiltinPluginsUpdate } from '../configInit'
import { ShortcutRecorder } from '../components/ShortcutRecorder'

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
        <div style={{
          position: 'fixed',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: 'var(--color-bg-overlay, rgba(0,0,0,0.4))',
          zIndex: 9999,
          fontSize: 'var(--text-base)',
          color: 'var(--color-text-primary)',
        }}>
          {t('switchingLanguage')}
        </div>
      )}
      <SettingGroup title={t('general')}>
        <SettingsListRow icon={<Languages size={14} />} name={t('language')} desc={t('languageInfo')}>
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
        <SettingsListRow icon={<Moon size={14} />} name={t('darkTheme')} desc={t('darkThemeInfo')}>
          <Toggle value={settings.theme === 'dark'} onChange={(value) => updateSetting('theme', value ? 'dark' : 'light')} />
        </SettingsListRow>
        <SettingsListRow icon={<Save size={14} />} name={t('persistParams')} desc={t('persistParamsInfo')}>
          <Toggle value={settings.persistParams} onChange={(value) => updateSetting('persistParams', value)} />
        </SettingsListRow>
      </SettingGroup>

      <SettingGroup title={t('hotkeys')}>
        <SettingsListRow icon={<Command size={14} />} name={t('globalPinnedLauncherShortcut')} desc={t('globalPinnedLauncherShortcutInfo')}>
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
      </SettingGroup>

      <SettingGroup title={t('editor')}>
        <SettingsListRow icon={<Type size={14} />} name={t('fontSize')} desc={t('fontSizeInfo')}>
          <span className="num">
            <button type="button" onClick={() => updateSetting('fontSize', Math.max(10, settings.fontSize - 1))}>−</button>
            <span className="v">{settings.fontSize}</span>
            <button type="button" onClick={() => updateSetting('fontSize', Math.min(24, settings.fontSize + 1))}>＋</button>
          </span>
        </SettingsListRow>
        <SettingsListRow icon={<WrapText size={14} />} name={t('wordWrap')} desc={t('wordWrapInfo')}>
          <Toggle value={settings.wordWrap} onChange={(value) => updateSetting('wordWrap', value)} />
        </SettingsListRow>
        <SettingsListRow icon={<Hash size={14} />} name={t('lineNumbers')} desc={t('lineNumbersInfo')}>
          <Toggle value={settings.lineNumbers} onChange={(value) => updateSetting('lineNumbers', value)} />
        </SettingsListRow>
      </SettingGroup>

      <div className="settings-about-card">
        <div className="settings-about-left">
          <span className="settings-about-name">hiven</span>
          <span className="settings-about-version">v{appVersion}</span>
        </div>
        <div className="settings-about-right">
          <UpdateChecker compact />
        </div>
      </div>
    </div>
  )
}

export function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sgroup">
      <div className="sgroup-label">{title}</div>
      <div className="scard">{children}</div>
    </div>
  )
}

export function SettingsListRow({ icon, name, desc, children }: { icon: ReactNode; name: string; desc?: string; children: ReactNode }) {
  return (
    <div className="srow">
      <div className="s-ico">{icon}</div>
      <div className="s-main">
        <div className="s-name">{name}</div>
        {desc && <div className="s-desc">{desc}</div>}
      </div>
      <div className="s-ctl">{children}</div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      className={`sw toggle ${value ? 'on' : ''}`}
      aria-pressed={value}
      onClick={() => onChange(!value)}
    />
  )
}

function LocaleSelect({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const [focusedIndex, setFocusedIndex] = useState(-1)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  useEffect(() => {
    if (open) {
      const selectedIdx = options.findIndex((o) => o.value === value)
      const idx = selectedIdx >= 0 ? selectedIdx : 0
      setFocusedIndex(idx)
      requestAnimationFrame(() => optionRefs.current[idx]?.focus())
    } else {
      setFocusedIndex(-1)
    }
  }, [open])

  const selected = options.find((option) => option.value === value)

  const handleTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setOpen(true)
    }
  }

  const handleOptionKeyDown = (e: React.KeyboardEvent, index: number) => {
    switch (e.key) {
      case 'ArrowDown': {
        e.preventDefault()
        const next = index < options.length - 1 ? index + 1 : 0
        setFocusedIndex(next)
        optionRefs.current[next]?.focus()
        break
      }
      case 'ArrowUp': {
        e.preventDefault()
        const prev = index > 0 ? index - 1 : options.length - 1
        setFocusedIndex(prev)
        optionRefs.current[prev]?.focus()
        break
      }
      case 'Enter':
      case ' ': {
        e.preventDefault()
        onChange(options[index].value)
        setOpen(false)
        triggerRef.current?.focus()
        break
      }
      case 'Escape': {
        e.preventDefault()
        setOpen(false)
        triggerRef.current?.focus()
        break
      }
    }
  }

  return (
    <div className={`settings-select-wrap ${open ? 'is-open' : ''}`} ref={ref}>
      <button
        type="button"
        ref={triggerRef}
        className={`sel-ctl ${open ? 'open' : ''}`}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen(!open)}
        onKeyDown={handleTriggerKeyDown}
      >
        <span>{selected?.label ?? value}</span>
        <span className="chev">▾</span>
      </button>
      {open && (
        <div className="settings-select-menu" role="listbox" aria-activedescendant={focusedIndex >= 0 ? `locale-option-${options[focusedIndex].value}` : undefined}>
          {options.map((option, index) => (
            <button
              type="button"
              key={option.value}
              id={`locale-option-${option.value}`}
              ref={(el) => { optionRefs.current[index] = el }}
              role="option"
              aria-selected={value === option.value}
              className={`settings-select-item ${value === option.value ? 'is-selected' : ''} ${focusedIndex === index ? 'is-focused' : ''}`}
              onClick={() => { onChange(option.value); setOpen(false); triggerRef.current?.focus() }}
              onKeyDown={(e) => handleOptionKeyDown(e, index)}
            >
              <span className="w-3.5 shrink-0 flex items-center justify-center">
                {value === option.value && <Check size={10} style={{ color: 'var(--color-accent)' }} />}
              </span>
              <span>{option.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}


function formatHotkeyRegistrationStatus(
  shortcut: ReturnType<typeof useAppStore.getState>['settings']['globalPinnedLauncherShortcut'],
  t: ReturnType<typeof useT>,
): string {
  if (!shortcut) return t('hotkeyStatusPending')
  if (shortcut.registrationError) {
    if (shortcut.registrationError.includes('Accessibility permission is required')) return t('hotkeyAccessibilityRequired')
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
  const [pluginStatus, setPluginStatus] = useState<'idle' | 'checking' | 'updated' | 'up-to-date' | 'error'>('idle')
  const [pluginVersion, setPluginVersion] = useState(0)
  const [pluginError, setPluginError] = useState('')
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null)

  const handleCheck = async () => {
    setStatus('checking')
    setPluginStatus('checking')
    setError('')
    setPluginError('')
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
      setError(String(err))
      setStatus('error')
    }

    try {
      const result = await checkBuiltinPluginsUpdate()
      if (result.updated) {
        setPluginStatus('updated')
        setPluginVersion(result.version || 0)
      } else if (result.error) {
        setPluginError(result.error)
        setPluginStatus('error')
      } else {
        setPluginStatus('up-to-date')
      }
    } catch (err) {
      setPluginError(String(err))
      setPluginStatus('error')
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
      setError(String(err))
      setStatus('error')
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

  if (compact) {
    return (
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
      {status !== 'idle' && status !== 'checking' && status !== 'downloading' && (
        <span style={{ fontSize: 'var(--text-sm)', color: status === 'error' ? 'var(--color-error-text)' : status === 'no-update' ? 'var(--text-3)' : 'var(--accent)' }}>
          {statusText()}
        </span>
      )}
      {pluginStatus !== 'idle' && pluginStatus !== 'checking' && (
        <span style={{ fontSize: 'var(--text-sm)', color: pluginStatus === 'updated' ? 'var(--accent)' : pluginStatus === 'error' ? 'var(--color-error-text)' : 'var(--text-3)' }}>
          {pluginStatus === 'updated'
            ? t('pluginsUpdated', { version: String(pluginVersion) })
            : pluginStatus === 'up-to-date'
              ? t('pluginsUpToDate')
              : `${t('pluginsUpdateError')}: ${pluginError}`}
        </span>
      )}
    </div>
  )
}
