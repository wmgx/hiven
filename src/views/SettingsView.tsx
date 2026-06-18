import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { Check, ChevronDown, Download, Info, Keyboard, Languages, Layout, Minus, Moon, Plus, RefreshCw, SlidersHorizontal, Sun } from 'lucide-react'
import { useAppStore, type GlobalPinnedLauncherShortcut } from '../store'
import { useT } from '../i18n'
import { checkBuiltinPluginsUpdate } from '../configInit'
import { ShortcutRecorder, doubleModifierLabel, getHotkeyPlatformLabels } from '../components/ShortcutRecorder'

export function SettingsView() {
  const { settings, updateSetting } = useAppStore()
  const locale = useAppStore((s) => s.locale)
  const t = useT('settings')
  const tUpdate = useT('update')
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    getVersion().then((v) => setAppVersion(v)).catch(() => setAppVersion('dev'))
  }, [])

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="flex items-center justify-between mb-5">
        <span className="font-medium" style={{ fontSize: 'var(--text-lg)', color: 'var(--color-text-primary)' }}>{t('title')}</span>
        <span className="px-1.5 py-0.5 rounded" style={{ fontSize: 'var(--text-xs)', background: 'var(--color-accent-light)', color: 'var(--color-accent-hover)' }}>v{appVersion}</span>
      </div>

      <div className="grid grid-cols-2 gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' }}>
        <SettingCard icon={<Languages size={16} />} title={t('language')}>
          <SettingRow label={t('language')}>
            <LocaleSelect
              value={locale}
              options={[
                { value: 'en', label: t('langEn') },
                { value: 'zh', label: t('langZh') },
              ]}
              onChange={(value) => {
                updateSetting('locale', value)
                setTimeout(() => window.location.reload(), 100)
              }}
            />
          </SettingRow>
        </SettingCard>

        <ThemeSettings />

        <SettingCard icon={<Layout size={16} />} title={t('editor')}>
          <SettingRow label={t('fontSize')}>
            <div className="flex items-center gap-1.5">
              <button className="w-5 h-5 flex items-center justify-center rounded cursor-pointer" style={smallButtonStyle} onClick={() => updateSetting('fontSize', Math.max(10, settings.fontSize - 1))}>
                <Minus size={10} />
              </button>
              <span className="w-7 text-center" style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-primary)' }}>{settings.fontSize}</span>
              <button className="w-5 h-5 flex items-center justify-center rounded cursor-pointer" style={smallButtonStyle} onClick={() => updateSetting('fontSize', Math.min(24, settings.fontSize + 1))}>
                <Plus size={10} />
              </button>
            </div>
          </SettingRow>
          <SettingRow label={t('wordWrap')}>
            <Toggle value={settings.wordWrap} onChange={(value) => updateSetting('wordWrap', value)} />
          </SettingRow>
          <SettingRow label={t('lineNumbers')}>
            <Toggle value={settings.lineNumbers} onChange={(value) => updateSetting('lineNumbers', value)} />
          </SettingRow>
        </SettingCard>

        <SettingCard icon={<SlidersHorizontal size={16} />} title={t('behavior')}>
          <SettingRow label={t('persistParams')} info={t('persistParamsInfo')}>
            <Toggle value={settings.persistParams} onChange={(value) => updateSetting('persistParams', value)} />
          </SettingRow>
          <SettingRow label={t('persistPinnedInput')} info={t('persistPinnedInputInfo')}>
            <Toggle value={settings.persistPinnedInput} onChange={(value) => updateSetting('persistPinnedInput', value)} />
          </SettingRow>
          <SettingRow label={t('persistPinnedTombstone')} info={t('persistPinnedTombstoneInfo')}>
            <Toggle value={settings.persistPinnedTombstone} onChange={(value) => updateSetting('persistPinnedTombstone', value)} />
          </SettingRow>
        </SettingCard>

        <SettingCard icon={<Keyboard size={16} />} title={t('hotkeys')}>
          <HotkeySettings
            shortcut={settings.globalPinnedLauncherShortcut ?? { kind: 'double-modifier', modifier: 'Command' }}
            onChange={(value) => updateSetting('globalPinnedLauncherShortcut', value)}
          />
        </SettingCard>

        <SettingCard icon={<Download size={16} />} title={tUpdate('title')}>
          <UpdateChecker />
        </SettingCard>
      </div>
    </div>
  )
}

const smallButtonStyle = {
  background: 'var(--color-background-tertiary)',
  border: '0.5px solid var(--color-border-tertiary)',
  color: 'var(--color-text-secondary)',
  borderRadius: 'var(--radius-sm)',
}

function SettingCard({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="setting-card card p-3.5 px-4">
      <div className="font-medium flex items-center gap-1.5 mb-3" style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-primary)' }}>
        <span style={{ color: 'var(--color-accent)' }}>{icon}</span>
        {title}
      </div>
      <div className="flex flex-col">{children}</div>
    </div>
  )
}

function ThemeSettings() {
  const { settings, updateSetting, locale } = useAppStore()
  const isDark = settings.theme === 'dark'
  const title = locale === 'zh' ? '外观' : 'Appearance'
  const label = locale === 'zh' ? '暗色主题' : 'Dark theme'

  return (
    <SettingCard icon={isDark ? <Moon size={16} /> : <Sun size={16} />} title={title}>
      <SettingRow label={label}>
        <Toggle value={isDark} onChange={(value) => updateSetting('theme', value ? 'dark' : 'light')} />
      </SettingRow>
    </SettingCard>
  )
}

function SettingRow({ label, info, children }: { label: string; info?: string; children: ReactNode }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)

  return (
    <div
      style={{
        borderBottom: '0.5px solid var(--color-border-tertiary)',
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 55%) 1fr',
        gap: '8px',
        alignItems: 'start',
        paddingTop: '6px',
        paddingBottom: '6px'
      }}
    >
      <span className="flex items-start gap-1" style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-secondary)', minWidth: 0 }}>
        {label}
        {info && (
          <div className="relative inline-flex mt-[1px]" ref={infoRef}>
            <Info
              size={12}
              className="cursor-pointer shrink-0 opacity-40 hover:opacity-70 transition-opacity"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={() => setShowTooltip(true)}
              onMouseLeave={() => setShowTooltip(false)}
            />
            {showTooltip && (
              <div className="absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 px-2.5 py-1.5 text-[11px] leading-relaxed whitespace-normal z-50 pointer-events-none" style={{
                background: 'var(--color-background-tertiary)',
                color: 'var(--color-text-primary)',
                border: '0.5px solid var(--color-border-secondary)',
                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                width: 'min(200px, 60vw)',
                borderRadius: 'var(--radius-md)',
              }}>
                {info}
              </div>
            )}
          </div>
        )}
      </span>
      <div style={{ minWidth: 0 }}>
        {children}
      </div>
    </div>
  )
}

function Toggle({ value, onChange }: { value: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      className={`toggle ${value ? 'on' : ''}`}
      aria-pressed={value}
      onClick={() => onChange(!value)}
    />
  )
}

function HotkeySettings({
  shortcut,
  onChange,
}: {
  shortcut: GlobalPinnedLauncherShortcut
  onChange: (value: GlobalPinnedLauncherShortcut) => void
}) {
  const t = useT('settings')
  const locale = useAppStore((s) => s.locale)
  const platformLabels = getHotkeyPlatformLabels()
  const registrationStatus = shortcut.registrationError
    ? t('hotkeyRegistrationFailed', { message: localizeHotkeyStatus(shortcut.registrationError, t, platformLabels) })
    : formatHotkeyRegistrationStatus(shortcut.registrationStatus, t, platformLabels)

  return (
    <div className="flex flex-col gap-2">
      <SettingRow label={t('globalPinnedLauncherShortcut')} info={t('globalPinnedLauncherShortcutInfo')}>
        <ShortcutRecorder
          value={shortcut}
          allowDoubleModifier
          status={registrationStatus}
          hint={shortcut.kind === 'double-modifier'
            ? platformLabels.isMac
              ? t('hotkeyAccessibilityHint', { modifier: doubleModifierLabel(shortcut.modifier, locale, platformLabels) })
              : t('hotkeyDoubleModifierUnsupported')
            : undefined}
          onRecord={onChange}
          onClear={() => onChange({ kind: 'disabled' })}
        />
      </SettingRow>
    </div>
  )
}

type HotkeyPlatformLabels = {
  isMac: boolean
  command: string
  option: string
}

function formatHotkeyRegistrationStatus(
  status: string | undefined,
  t: ReturnType<typeof useT>,
  platformLabels: HotkeyPlatformLabels,
): string {
  if (!status) return t('hotkeyStatusPending')
  return localizeHotkeyStatus(status, t, platformLabels)
}

function localizeHotkeyStatus(
  status: string,
  t: ReturnType<typeof useT>,
  platformLabels: HotkeyPlatformLabels,
): string {
  if (status === 'Registered') return t('hotkeyStatusRegistered')
  if (status === 'Registration pending') return t('hotkeyStatusPending')
  if (status === 'Disabled') return t('hotkeyStatusDisabled')
  if (status === 'Double modifier detector unregistered') return t('hotkeyStatusUnregistered')

  const doubleRegistered = status.match(/^Double (Cmd|Shift|Option) registered$/)
  if (doubleRegistered) {
    return t('hotkeyStatusDoubleRegistered', {
      modifier: nativeModifierLabel(doubleRegistered[1], platformLabels),
    })
  }

  const failed = status.match(/^Registration failed(?::\s*)?(.*)$/)
  if (failed) {
    return t('hotkeyRegistrationFailed', {
      message: localizeHotkeyStatusDetail(failed[1] || '', t),
    })
  }

  return t('hotkeyStatusDetail', { status })
}

function nativeModifierLabel(nativeModifier: string, platformLabels: HotkeyPlatformLabels): string {
  if (nativeModifier === 'Option') return platformLabels.option
  if (nativeModifier === 'Cmd') return platformLabels.command
  return nativeModifier
}

function localizeHotkeyStatusDetail(detail: string, t: ReturnType<typeof useT>): string {
  if (/Double modifier global hotkey is only available on macOS/i.test(detail)) {
    return t('hotkeyDoubleModifierUnsupported')
  }
  if (/Accessibility permission is required for double-modifier global shortcuts/i.test(detail)) {
    return t('hotkeyAccessibilityRequired')
  }
  return detail || t('hotkeyStatusUnknownError')
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
      <div className="flex items-center justify-between px-2.5 py-1 cursor-pointer gap-2" style={{
        fontSize: 'var(--text-sm)',
        background: 'var(--color-background-primary)',
        border: open ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
        color: 'var(--color-text-primary)',
        borderRadius: 'var(--radius-md)',
      }} onClick={() => setOpen(!open)}>
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </div>
      {open && (
        <div className="absolute left-0 right-0 top-full mt-1 overflow-hidden z-50 anim-dropdown" style={{
          background: 'var(--color-background-primary)',
          border: '0.5px solid var(--color-border-secondary)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          borderRadius: 'var(--radius-md)',
        }}>
          {options.map((option) => (
            <div key={option.value} className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors" style={{
              fontSize: 'var(--text-sm)',
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

function UpdateChecker() {
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
        <span style={{ fontSize: 'var(--text-sm)', color: status === 'error' ? 'var(--color-error-text)' : status === 'no-update' ? 'var(--color-text-tertiary)' : 'var(--color-success-text)' }}>
          {statusText()}
        </span>
      )}
      {pluginStatus !== 'idle' && pluginStatus !== 'checking' && (
        <span style={{ fontSize: 'var(--text-sm)', color: pluginStatus === 'updated' ? 'var(--color-success-text)' : pluginStatus === 'error' ? 'var(--color-error-text)' : 'var(--color-text-tertiary)' }}>
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
