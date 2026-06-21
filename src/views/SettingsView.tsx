import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { Check, Download, RefreshCw } from 'lucide-react'
import { useAppStore } from '../store'
import { useT } from '../i18n'
import { checkBuiltinPluginsUpdate } from '../configInit'
import { ShortcutRecorder } from '../components/ShortcutRecorder'

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
    <div className="settings-page body">
      <div className="sscroll">
        <SettingGroup title={t('general')}>
          <SettingsListRow icon="文" name={t('language')} desc={t('languageInfo')}>
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
          </SettingsListRow>
          <SettingsListRow icon="◐" name={t('darkTheme')} desc={t('darkThemeInfo')}>
            <Toggle value={settings.theme === 'dark'} onChange={(value) => updateSetting('theme', value ? 'dark' : 'light')} />
          </SettingsListRow>
        </SettingGroup>

        <SettingGroup title={t('hotkeys')}>
          <SettingsListRow icon="⌘" name={t('globalPinnedLauncherShortcut')} desc={t('globalPinnedLauncherShortcutInfo')}>
            <ShortcutRecorder
              value={settings.globalPinnedLauncherShortcut ?? { kind: 'double-modifier', modifier: 'Command' }}
              allowDoubleModifier
              onRecord={(value) => updateSetting('globalPinnedLauncherShortcut', value)}
              onClear={() => updateSetting('globalPinnedLauncherShortcut', { kind: 'disabled' })}
            />
          </SettingsListRow>
        </SettingGroup>

        <SettingGroup title={t('editor')}>
          <SettingsListRow icon="A" name={t('fontSize')} desc={t('fontSizeInfo')}>
            <span className="num">
              <button type="button" onClick={() => updateSetting('fontSize', Math.max(10, settings.fontSize - 1))}>−</button>
              <span className="v">{settings.fontSize}</span>
              <button type="button" onClick={() => updateSetting('fontSize', Math.min(24, settings.fontSize + 1))}>＋</button>
            </span>
          </SettingsListRow>
          <SettingsListRow icon="↵" name={t('wordWrap')} desc={t('wordWrapInfo')}>
            <Toggle value={settings.wordWrap} onChange={(value) => updateSetting('wordWrap', value)} />
          </SettingsListRow>
          <SettingsListRow icon="#" name={t('lineNumbers')} desc={t('lineNumbersInfo')}>
            <Toggle value={settings.lineNumbers} onChange={(value) => updateSetting('lineNumbers', value)} />
          </SettingsListRow>
        </SettingGroup>

        <SettingGroup title={t('behavior')}>
          <SettingsListRow icon="⊡" name={t('persistParams')} desc={t('persistParamsInfo')}>
            <Toggle value={settings.persistParams} onChange={(value) => updateSetting('persistParams', value)} />
          </SettingsListRow>
          <SettingsListRow icon="📌" name={t('persistPinnedInput')} desc={t('persistPinnedInputInfo')}>
            <Toggle value={settings.persistPinnedInput} onChange={(value) => updateSetting('persistPinnedInput', value)} />
          </SettingsListRow>
          <SettingsListRow icon="☾" name={t('persistPinnedTombstone')} desc={t('persistPinnedTombstoneInfo')}>
            <Toggle value={settings.persistPinnedTombstone} onChange={(value) => updateSetting('persistPinnedTombstone', value)} />
          </SettingsListRow>
        </SettingGroup>

        <SettingGroup title={tUpdate('title')}>
          <SettingsListRow icon="↻" name={t('currentVersion')} desc={t('currentVersionInfo')}>
            <div className="settings-version-control">
              <span className="kbd">v{appVersion}</span>
              <UpdateChecker compact />
            </div>
          </SettingsListRow>
        </SettingGroup>
      </div>
    </div>
  )
}

function SettingGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="sgroup">
      <div className="sgroup-label">{title}</div>
      <div className="scard">{children}</div>
    </div>
  )
}

function SettingsListRow({ icon, name, desc, children }: { icon: ReactNode; name: string; desc?: string; children: ReactNode }) {
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
    <div className={`settings-select-wrap ${open ? 'is-open' : ''}`} ref={ref}>
      <div className={`sel-ctl ${open ? 'open' : ''}`} onClick={() => setOpen(!open)}>
        <span>{selected?.label ?? value}</span>
        <span className="chev">▾</span>
      </div>
      {open && (
        <div className="settings-select-menu">
          {options.map((option) => (
            <div key={option.value} className={`settings-select-item ${value === option.value ? 'is-selected' : ''}`} onClick={() => { onChange(option.value); setOpen(false) }}>
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
