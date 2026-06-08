import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, ReactNode } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { Check, ChevronDown, Download, Info, Keyboard, Languages, Layout, Minus, Plug, Plus, RefreshCw, SlidersHorizontal } from 'lucide-react'
import { useAppStore, type GlobalPinnedLauncherShortcut } from '../store'
import { t } from '../i18n'
import { checkBuiltinPluginsUpdate } from '../configInit'

export function SettingsView() {
  const { settings, updateSetting } = useAppStore()
  const setActiveView = useAppStore((s) => s.setActiveView)
  const locale = useAppStore((s) => s.locale)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    getVersion().then((v) => setAppVersion(v)).catch(() => setAppVersion('dev'))
  }, [])

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="flex items-center justify-between mb-5">
        <span className="font-medium" style={{ fontSize: '1.15em', color: 'var(--color-text-primary)' }}>{t(locale, 'settings.title')}</span>
        <span className="px-1.5 py-0.5 rounded" style={{ fontSize: '0.75em', background: 'var(--color-accent-light)', color: 'var(--color-accent-hover)' }}>v{appVersion}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <SettingCard icon={<Languages size={16} />} title={t(locale, 'settings.language')}>
          <SettingRow label={t(locale, 'settings.language')}>
            <LocaleSelect
              value={locale}
              options={[
                { value: 'en', label: t(locale, 'settings.langEn') },
                { value: 'zh', label: t(locale, 'settings.langZh') },
              ]}
              onChange={(value) => {
                updateSetting('locale', value)
                setTimeout(() => window.location.reload(), 100)
              }}
            />
          </SettingRow>
        </SettingCard>

        <SettingCard icon={<Layout size={16} />} title={t(locale, 'settings.editor')}>
          <SettingRow label={t(locale, 'settings.fontSize')}>
            <div className="flex items-center gap-1.5">
              <button className="w-5 h-5 flex items-center justify-center rounded cursor-pointer" style={smallButtonStyle} onClick={() => updateSetting('fontSize', Math.max(10, settings.fontSize - 1))}>
                <Minus size={10} />
              </button>
              <span className="w-7 text-center" style={{ fontSize: '0.9em', color: 'var(--color-text-primary)' }}>{settings.fontSize}</span>
              <button className="w-5 h-5 flex items-center justify-center rounded cursor-pointer" style={smallButtonStyle} onClick={() => updateSetting('fontSize', Math.min(24, settings.fontSize + 1))}>
                <Plus size={10} />
              </button>
            </div>
          </SettingRow>
          <SettingRow label={t(locale, 'settings.wordWrap')}>
            <Toggle value={settings.wordWrap} onChange={(value) => updateSetting('wordWrap', value)} />
          </SettingRow>
          <SettingRow label={t(locale, 'settings.lineNumbers')}>
            <Toggle value={settings.lineNumbers} onChange={(value) => updateSetting('lineNumbers', value)} />
          </SettingRow>
        </SettingCard>

        <SettingCard icon={<SlidersHorizontal size={16} />} title={t(locale, 'settings.behavior')}>
          <SettingRow label={t(locale, 'settings.persistParams')} info={t(locale, 'settings.persistParamsInfo')}>
            <Toggle value={settings.persistParams} onChange={(value) => updateSetting('persistParams', value)} />
          </SettingRow>
          <SettingRow label={t(locale, 'settings.persistPinnedInput')} info={t(locale, 'settings.persistPinnedInputInfo')}>
            <Toggle value={settings.persistPinnedInput} onChange={(value) => updateSetting('persistPinnedInput', value)} />
          </SettingRow>
          <SettingRow label={t(locale, 'settings.persistPinnedTombstone')} info={t(locale, 'settings.persistPinnedTombstoneInfo')}>
            <Toggle value={settings.persistPinnedTombstone} onChange={(value) => updateSetting('persistPinnedTombstone', value)} />
          </SettingRow>
        </SettingCard>

        <SettingCard icon={<Keyboard size={16} />} title={t(locale, 'settings.hotkeys')}>
          <HotkeySettings
            shortcut={settings.globalPinnedLauncherShortcut ?? { kind: 'double-modifier', modifier: 'Command' }}
            onChange={(value) => updateSetting('globalPinnedLauncherShortcut', value)}
            locale={locale}
          />
        </SettingCard>

        <SettingCard icon={<Download size={16} />} title={t(locale, 'update.title')}>
          <UpdateChecker locale={locale} />
        </SettingCard>

        <SettingCard icon={<Plug size={16} />} title={t(locale, 'scripts.title')}>
          <div className="flex items-center justify-between py-1.5">
            <span style={{ fontSize: '0.9em', color: 'var(--color-text-secondary)' }}>
              {t(locale, 'settings.pluginsInfo')}
            </span>
            <button className="scripts-btn" onClick={() => setActiveView('scripts')}>{t(locale, 'settings.openPlugins')}</button>
          </div>
        </SettingCard>
      </div>
    </div>
  )
}

const smallButtonStyle = {
  background: 'var(--color-background-tertiary)',
  border: '0.5px solid var(--color-border-tertiary)',
  color: 'var(--color-text-secondary)',
}

function SettingCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="p-3.5 px-4 rounded-xl" style={{ border: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-primary)' }}>
      <div className="font-medium flex items-center gap-1.5 mb-3" style={{ fontSize: '1em', color: 'var(--color-text-primary)' }}>
        <span style={{ color: 'var(--color-accent)' }}>{icon}</span>
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function SettingRow({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)

  return (
    <div className="flex items-center justify-between py-1.5" style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}>
      <span className="flex items-center gap-1" style={{ fontSize: '0.9em', color: 'var(--color-text-secondary)' }}>
        {label}
        {info && (
          <div className="relative inline-flex" ref={infoRef}>
            <Info
              size={12}
              className="cursor-pointer shrink-0 opacity-40 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            />
            {showTooltip && (
              <div className="absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 px-2.5 py-1.5 rounded-md text-[11px] leading-relaxed whitespace-normal z-50 pointer-events-none" style={{
                background: 'var(--color-background-tertiary)',
                color: 'var(--color-text-primary)',
                border: '0.5px solid var(--color-border-secondary)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                width: 'min(200px, 60vw)',
              }}>
                {info}
              </div>
            )}
          </div>
        )}
      </span>
      {children}
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <div className="w-7 h-4 rounded-full relative cursor-pointer shrink-0" style={{ background: value ? 'var(--color-accent)' : 'var(--color-border-tertiary)' }} onClick={() => onChange(!value)}>
      <div className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-[left] duration-150" style={{ left: value ? '14px' : '2px' }} />
    </div>
  )
}

function HotkeySettings({
  shortcut,
  onChange,
  locale,
}: {
  shortcut: GlobalPinnedLauncherShortcut
  onChange: (value: GlobalPinnedLauncherShortcut) => void
  locale: 'zh' | 'en'
}) {
  const [isRecording, setIsRecording] = useState(false)
  const [error, setError] = useState('')
  const recorderRef = useRef<HTMLDivElement>(null)
  const registrationStatus = shortcut.registrationError
    ? `${t(locale, 'settings.hotkeyStatus')}: ${shortcut.registrationError}`
    : shortcut.registrationStatus ?? t(locale, 'settings.hotkeyStatusPending')

  const displayValue = () => {
    if (shortcut.kind === 'accelerator') return shortcut.accelerator
    if (shortcut.kind === 'double-modifier') return t(locale, 'settings.hotkeyDoubleCmd')
    return t(locale, 'settings.hotkeyDisabled')
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!isRecording) return
    event.preventDefault()
    event.stopPropagation()

    if (event.key === 'Escape') {
      setError('')
      setIsRecording(false)
      return
    }

    const accelerator = eventToAccelerator(event)
    if (!accelerator) {
      setError(isModifierKey(event.key) ? '' : t(locale, 'settings.hotkeyRecordError'))
      return
    }
    setError('')
    setIsRecording(false)
    onChange({ kind: 'accelerator', accelerator })
  }

  useEffect(() => {
    if (!isRecording) return
    const timer = window.setTimeout(() => {
      setIsRecording(false)
      setError('')
    }, 10_000)
    return () => window.clearTimeout(timer)
  }, [isRecording])

  const startRecording = () => {
    setError('')
    setIsRecording(true)
    requestAnimationFrame(() => recorderRef.current?.focus())
  }

  return (
    <div className="flex flex-col gap-2">
      <SettingRow label={t(locale, 'settings.globalPinnedLauncherShortcut')} info={t(locale, 'settings.globalPinnedLauncherShortcutInfo')}>
        <div
          ref={recorderRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          className="min-w-[170px] px-2.5 py-1 rounded-md text-right outline-none"
          style={{
            fontSize: '0.85em',
            background: isRecording ? 'var(--color-accent-light)' : 'var(--color-background-tertiary)',
            border: isRecording ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-tertiary)',
            color: 'var(--color-text-primary)',
          }}
        >
          {isRecording ? t(locale, 'settings.hotkeyRecording') : displayValue()}
        </div>
      </SettingRow>
      <div className="flex flex-wrap gap-2 justify-end">
        <button className="scripts-btn" onClick={startRecording}>{t(locale, 'settings.hotkeyRecord')}</button>
        <button className="scripts-btn" onClick={() => { setError(''); setIsRecording(false); onChange({ kind: 'double-modifier', modifier: 'Command' }) }}>
          {t(locale, 'settings.hotkeyDoubleCmd')}
        </button>
        <button className="scripts-btn" onClick={() => { setError(''); setIsRecording(false); onChange({ kind: 'disabled' }) }}>
          {t(locale, 'settings.hotkeyDisabled')}
        </button>
      </div>
      <span style={{ fontSize: '0.8em', color: error ? 'var(--color-error-text)' : 'var(--color-text-tertiary)' }}>
        {error || registrationStatus}
      </span>
      {shortcut.kind === 'double-modifier' && (
        <span style={{ fontSize: '0.78em', color: 'var(--color-text-tertiary)' }}>
          {t(locale, 'settings.hotkeyAccessibilityHint')}
        </span>
      )}
    </div>
  )
}

function eventToAccelerator(event: KeyboardEvent<HTMLDivElement>): string | null {
  const key = normalizeKey(event.key)
  const hasModifier = event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
  if (!key || !hasModifier) return null

  const parts: string[] = []
  if (event.metaKey) parts.push('Cmd')
  if (event.ctrlKey) parts.push('Ctrl')
  if (event.altKey) parts.push('Alt')
  if (event.shiftKey) parts.push('Shift')
  parts.push(key)
  return parts.join('+')
}

function normalizeKey(key: string): string | null {
  if (isModifierKey(key)) return null
  if (key.length === 1) return key.toUpperCase()
  if (key === ' ') return 'Space'
  if (key.startsWith('Arrow')) return key.replace('Arrow', '')
  return key
}

function isModifierKey(key: string): boolean {
  return key === 'Meta' || key === 'Control' || key === 'Alt' || key === 'Shift'
}

function LocaleSelect({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find((option) => option.value === value)

  return (
    <div className="relative min-w-[100px]" ref={ref}>
      <div className="flex items-center justify-between px-2.5 py-1 rounded-md cursor-pointer gap-2" style={{
        fontSize: '0.85em',
        background: 'var(--color-background-primary)',
        border: open ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
        color: 'var(--color-text-primary)',
      }} onClick={() => setOpen(!open)}>
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 rounded-md overflow-hidden z-50 anim-dropdown" style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
        }}>
          {options.map((option) => (
            <div key={option.value} className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors" style={{
              fontSize: '0.85em',
              background: value === option.value ? 'var(--color-accent-light)' : 'transparent',
              color: 'var(--color-text-primary)',
            }} onClick={() => { onChange(option.value); setOpen(false) }}>
              <span className="w-3.5 shrink-0 flex items-center justify-center">
                {value === option.value && <Check size={10} style={{ color: 'var(--color-accent)' }} />}
              </span>
              <span>{option.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

type UpdateStatus = 'idle' | 'checking' | 'available' | 'no-update' | 'downloading' | 'ready' | 'error'

function UpdateChecker({ locale }: { locale: 'zh' | 'en' }) {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [version, setVersion] = useState('')
  const [error, setError] = useState('')
  const [pluginStatus, setPluginStatus] = useState<'idle' | 'checking' | 'updated' | 'up-to-date' | 'error'>('idle')
  const [pluginVersion, setPluginVersion] = useState(0)
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null)

  const handleCheck = async () => {
    setStatus('checking')
    setPluginStatus('checking')
    setError('')
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
      } else {
        setPluginStatus(result.error ? 'error' : 'up-to-date')
      }
    } catch {
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
      case 'checking': return t(locale, 'update.checking')
      case 'available': return t(locale, 'update.available').replace('{version}', version)
      case 'no-update': return t(locale, 'update.noUpdate')
      case 'downloading': return t(locale, 'update.downloading')
      case 'ready': return t(locale, 'update.readyRestart')
      case 'error': return `${t(locale, 'update.error')}: ${error}`
      default: return ''
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span style={{ fontSize: '0.9em', color: 'var(--color-text-secondary)' }}>{t(locale, 'update.checkUpdate')}</span>
        <div className="flex items-center gap-2">
          {status === 'available' && <button className="scripts-btn" onClick={handleDownloadAndInstall}><Download size={11} /> {version}</button>}
          {status === 'ready' && <button className="scripts-btn scripts-btn-primary" onClick={() => relaunch()}>{t(locale, 'update.restart')}</button>}
          {(status === 'idle' || status === 'no-update' || status === 'error') && (
            <button className="scripts-btn" onClick={handleCheck}><RefreshCw size={11} /> {t(locale, 'update.checkUpdate')}</button>
          )}
          {(status === 'checking' || status === 'downloading') && (
            <span className="flex items-center gap-1 px-2.5 py-1" style={{ fontSize: '0.8em', color: 'var(--color-text-tertiary)' }}>
              <RefreshCw size={11} className="animate-spin" /> {statusText()}
            </span>
          )}
        </div>
      </div>
      {status !== 'idle' && status !== 'checking' && status !== 'downloading' && (
        <span style={{ fontSize: '0.8em', color: status === 'error' ? 'var(--color-error-text)' : status === 'no-update' ? 'var(--color-text-tertiary)' : 'var(--color-success-text)' }}>
          {statusText()}
        </span>
      )}
      {pluginStatus !== 'idle' && pluginStatus !== 'checking' && (
        <span style={{ fontSize: '0.8em', color: pluginStatus === 'updated' ? 'var(--color-success-text)' : pluginStatus === 'error' ? 'var(--color-error-text)' : 'var(--color-text-tertiary)' }}>
          {pluginStatus === 'updated'
            ? t(locale, 'update.pluginsUpdated').replace('{version}', String(pluginVersion))
            : pluginStatus === 'up-to-date'
              ? t(locale, 'update.pluginsUpToDate')
              : t(locale, 'update.pluginsUpdateError')}
        </span>
      )}
    </div>
  )
}
