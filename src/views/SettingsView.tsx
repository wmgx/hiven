import { useAppStore } from '../store'
import type { ActionDef } from '../store'
import { parseScriptToAction } from '../store'
import { t } from '../i18n'
import { Puzzle, Layout, SlidersHorizontal, Languages, ChevronDown, Check, Minus, Plus, Info, RefreshCw, Download } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { checkBuiltinScriptsUpdate } from '../configInit'

export function SettingsView() {
  const { settings, updateSetting } = useAppStore()
  const locale = useAppStore((s) => s.locale)
  const [appVersion, setAppVersion] = useState('')

  useEffect(() => {
    getVersion().then((v) => setAppVersion(v))
  }, [])

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="flex items-center justify-between mb-5">
        <span className="font-medium" style={{ fontSize: '1.15em', color: 'var(--color-text-primary)' }}>{t(locale, 'settings.title')}</span>
        <span className="px-1.5 py-0.5 rounded" style={{ fontSize: '0.75em', background: 'var(--color-accent-light)', color: 'var(--color-accent-hover)' }}>v{appVersion}</span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        {/* Language */}
        <SettingCard icon={<Languages size={16} />} title={t(locale, 'settings.language')} delay={0.05}>
          <SettingRow label={t(locale, 'settings.language')}>
            <LocaleSelect
              value={locale}
              options={[
                { value: 'en', label: t(locale, 'settings.langEn') },
                { value: 'zh', label: t(locale, 'settings.langZh') },
              ]}
              onChange={(v) => {
                updateSetting('locale', v)
                // Monaco Editor 的语言在加载时确定，切换后需要刷新页面
                setTimeout(() => window.location.reload(), 100)
              }}
            />
          </SettingRow>
        </SettingCard>

        {/* Scripts */}
        <SettingCard icon={<Puzzle size={16} />} title={t(locale, 'settings.scripts')}>
          <SettingRow label={t(locale, 'settings.autoReload')} info={t(locale, 'settings.autoReloadInfo')}>
            <Toggle value={settings.autoReload} onChange={(v) => updateSetting('autoReload', v)} />
          </SettingRow>
        </SettingCard>

        {/* Editor */}
        <SettingCard icon={<Layout size={16} />} title={t(locale, 'settings.editor')} delay={0.15}>
          <SettingRow label={t(locale, 'settings.fontSize')}>
            <div className="flex items-center gap-1.5">
              <button
                className="w-5 h-5 flex items-center justify-center rounded cursor-pointer"
                style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)' }}
                onClick={() => updateSetting('fontSize', Math.max(10, settings.fontSize - 1))}
              >
                <Minus size={10} />
              </button>
              <span className="w-7 text-center" style={{ fontSize: '0.9em', color: 'var(--color-text-primary)' }}>{settings.fontSize}</span>
              <button
                className="w-5 h-5 flex items-center justify-center rounded cursor-pointer"
                style={{ background: 'var(--color-background-tertiary)', border: '0.5px solid var(--color-border-tertiary)', color: 'var(--color-text-secondary)' }}
                onClick={() => updateSetting('fontSize', Math.min(24, settings.fontSize + 1))}
              >
                <Plus size={10} />
              </button>
            </div>
          </SettingRow>
          <SettingRow label={t(locale, 'settings.wordWrap')}>
            <Toggle value={settings.wordWrap} onChange={(v) => updateSetting('wordWrap', v)} />
          </SettingRow>
          <SettingRow label={t(locale, 'settings.lineNumbers')}>
            <Toggle value={settings.lineNumbers} onChange={(v) => updateSetting('lineNumbers', v)} />
          </SettingRow>
        </SettingCard>

        {/* Behavior */}
        <SettingCard icon={<SlidersHorizontal size={16} />} title={t(locale, 'settings.behavior')}>
          <SettingRow label={t(locale, 'settings.persistParams')} info={t(locale, 'settings.persistParamsInfo')}>
            <Toggle value={settings.persistParams} onChange={(v) => updateSetting('persistParams', v)} />
          </SettingRow>
          <SettingRow label={t(locale, 'settings.autoCopy')} info={t(locale, 'settings.autoCopyInfo')}>
            <Toggle value={settings.autoCopyOutput} onChange={(v) => updateSetting('autoCopyOutput', v)} />
          </SettingRow>
          <SettingRow label={t(locale, 'settings.realtimePreview')} info={t(locale, 'settings.realtimePreviewInfo')}>
            <Toggle value={settings.realtimePreview} onChange={(v) => updateSetting('realtimePreview', v)} />
          </SettingRow>
        </SettingCard>

        {/* Update */}
        <SettingCard icon={<Download size={16} />} title={t(locale, 'update.title')}>
          <UpdateChecker locale={locale} />
        </SettingCard>
      </div>
    </div>
  )
}

function SettingCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
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

function SettingRow({ label, info, children }: { label: string; info?: string; children: React.ReactNode }) {
  const [showTooltip, setShowTooltip] = useState(false)
  const infoRef = useRef<HTMLDivElement>(null)

  return (
    <div
      className="flex items-center justify-between py-1.5"
      style={{ borderBottom: '0.5px solid var(--color-border-tertiary)' }}
    >
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
              <div
                className="absolute left-1/2 bottom-full mb-1.5 -translate-x-1/2 px-2.5 py-1.5 rounded-md text-[11px] leading-relaxed whitespace-normal z-50 pointer-events-none"
                style={{
                  background: 'var(--color-background-tertiary)',
                  color: 'var(--color-text-primary)',
                  border: '0.5px solid var(--color-border-secondary)',
                  boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                  width: 'min(200px, 60vw)',
                }}
              >
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

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="w-7 h-4 rounded-full relative cursor-pointer shrink-0"
      style={{ background: value ? 'var(--color-accent)' : 'var(--color-border-tertiary)' }}
      onClick={() => onChange(!value)}
    >
      <div
        className="w-3 h-3 rounded-full bg-white absolute top-0.5 transition-[left] duration-150"
        style={{ left: value ? '14px' : '2px' }}
      />
    </div>
  )
}

function LocaleSelect({ options, value, onChange }: { options: { value: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const selected = options.find((o) => o.value === value)

  return (
    <div className="relative min-w-[100px]" ref={ref}>
      <div
        className="flex items-center justify-between px-2.5 py-1 rounded-md cursor-pointer gap-2"
        style={{
          fontSize: '0.85em',
          background: 'var(--color-background-primary)',
          border: open ? '0.5px solid var(--color-accent)' : '0.5px solid var(--color-border-secondary)',
          color: 'var(--color-text-primary)',
        }}
        onClick={() => setOpen(!open)}
      >
        <span>{selected?.label ?? value}</span>
        <ChevronDown size={12} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 150ms' }} />
      </div>
      {open && (
        <div
          className="absolute left-0 right-0 top-full mt-1 rounded-md overflow-hidden z-50 anim-dropdown"
          style={{
            background: 'var(--color-background-primary)',
            border: '0.5px solid var(--color-border-secondary)',
            boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
          }}
        >
          {options.map((opt) => (
            <div
              key={opt.value}
              className="flex items-center gap-2 px-2.5 py-1.5 cursor-pointer transition-colors"
              style={{
                fontSize: '0.85em',
                background: value === opt.value ? 'var(--color-accent-light)' : 'transparent',
                color: 'var(--color-text-primary)',
              }}
              onClick={() => { onChange(opt.value); setOpen(false) }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--color-accent-light)' }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = value === opt.value ? 'var(--color-accent-light)' : 'transparent' }}
            >
              <span className="w-3.5 shrink-0 flex items-center justify-center">
                {value === opt.value && <Check size={10} style={{ color: 'var(--color-accent)' }} />}
              </span>
              <span>{opt.label}</span>
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
  const [scriptsStatus, setScriptsStatus] = useState<'idle' | 'checking' | 'updated' | 'up-to-date' | 'error'>('idle')
  const [scriptsVersion, setScriptsVersion] = useState(0)
  const updateRef = useRef<Awaited<ReturnType<typeof check>> | null>(null)

  const handleCheck = async () => {
    setStatus('checking')
    setError('')
    setScriptsStatus('checking')
    try {
      const update = await check()
      if (update) {
        setVersion(update.version)
        setStatus('available')
        updateRef.current = update
      } else {
        setStatus('no-update')
      }
    } catch (e) {
      setError(String(e))
      setStatus('error')
    }

    // 同时检查内置脚本更新
    try {
      const result = await checkBuiltinScriptsUpdate()
      if (result.updated) {
        setScriptsStatus('updated')
        setScriptsVersion(result.version || 0)
        // 更新后自动重载到内存
        if ((window as any).__TAURI_INTERNALS__) {
          try {
            const { invoke } = await import('@tauri-apps/api/core')
            const watchDir = useAppStore.getState().settings.watchDirectory
            const scripts = await invoke<{ name: string; path: string; content: string; builtin?: boolean }[]>('read_scripts_dir', { path: watchDir })
            const builtinsFromDisk = scripts
              .filter(s => s.builtin)
              .map(s => parseScriptToAction(s.content))
              .filter((a): a is ActionDef => a !== null)
            if (builtinsFromDisk.length > 0) {
              useAppStore.getState().setBuiltinActionsFromDisk(builtinsFromDisk)
            }
          } catch (e) {
            console.error('[FluxText] Failed to reload scripts after update:', e)
          }
        }
      } else {
        setScriptsStatus(result.error ? 'error' : 'up-to-date')
      }
    } catch {
      setScriptsStatus('error')
    }
  }

  const handleDownloadAndInstall = async () => {
    const update = updateRef.current
    if (!update) return
    setStatus('downloading')
    try {
      await update.downloadAndInstall()
      setStatus('ready')
    } catch (e) {
      setError(String(e))
      setStatus('error')
    }
  }

  const handleRestart = async () => {
    await relaunch()
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
        <span style={{ fontSize: '0.9em', color: 'var(--color-text-secondary)' }}>
          {t(locale, 'update.checkUpdate')}
        </span>
        <div className="flex items-center gap-2">
          {status === 'available' && (
            <button
              className="flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                fontSize: '0.8em',
                background: 'var(--color-success-bg)',
                color: 'var(--color-success-text)',
                border: 'none',
                fontFamily: 'var(--font-mono)',
              }}
              onClick={handleDownloadAndInstall}
            >
              <Download size={11} />
              {version}
            </button>
          )}
          {status === 'ready' && (
            <button
              className="flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                fontSize: '0.8em',
                background: 'var(--color-accent)',
                color: '#fff',
                border: 'none',
                fontFamily: 'var(--font-mono)',
              }}
              onClick={handleRestart}
            >
              {t(locale, 'update.restart')}
            </button>
          )}
          {(status === 'idle' || status === 'no-update' || status === 'error') && (
            <button
              className="flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer"
              style={{
                fontSize: '0.8em',
                background: 'var(--color-background-tertiary)',
                color: 'var(--color-text-secondary)',
                border: '0.5px solid var(--color-border-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
              onClick={handleCheck}
            >
              <RefreshCw size={11} />
              {t(locale, 'update.checkUpdate')}
            </button>
          )}
          {(status === 'checking' || status === 'downloading') && (
            <span
              className="flex items-center gap-1 px-2.5 py-1"
              style={{ fontSize: '0.8em', color: 'var(--color-text-tertiary)' }}
            >
              <RefreshCw size={11} className="animate-spin" />
              {statusText()}
            </span>
          )}
        </div>
      </div>
      {status !== 'idle' && status !== 'checking' && status !== 'downloading' && (
        <span style={{
          fontSize: '0.8em',
          color: status === 'error' ? 'var(--color-error-text)' : status === 'no-update' ? 'var(--color-text-tertiary)' : 'var(--color-success-text)',
        }}>
          {statusText()}
        </span>
      )}
      {scriptsStatus !== 'idle' && scriptsStatus !== 'checking' && (
        <span style={{
          fontSize: '0.8em',
          color: scriptsStatus === 'updated' ? 'var(--color-success-text)' : scriptsStatus === 'error' ? 'var(--color-error-text)' : 'var(--color-text-tertiary)',
        }}>
          {scriptsStatus === 'updated'
            ? t(locale, 'update.scriptsUpdated').replace('{version}', String(scriptsVersion))
            : scriptsStatus === 'up-to-date'
              ? t(locale, 'update.scriptsUpToDate')
              : ''}
        </span>
      )}
    </div>
  )
}
