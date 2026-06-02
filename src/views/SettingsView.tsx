import { useAppStore } from '../store'
import type { ActionDef } from '../store'
import { parseScriptToAction } from '../store'
import { t } from '../i18n'
import { Layout, SlidersHorizontal, Languages, ChevronDown, Check, Minus, Plus, Info, RefreshCw, Download, Plug, Package, AlertCircle } from 'lucide-react'
import { useState, useRef, useEffect } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { getVersion } from '@tauri-apps/api/app'
import { checkBuiltinScriptsUpdate } from '../configInit'
import { usePluginStore } from '../workspace/pluginStore'
import {
  installLocalPlugin,
  enablePlugin,
  disablePlugin,
  reloadPlugin,
  uninstallPlugin as doUninstallPlugin,
  sideloadDevPlugin,
  reloadDevPlugin,
  removeDevPlugin as doRemoveDevPlugin,
  pickLocalPluginFolder,
  watchDevPlugin,
  unwatchDevPlugin,
} from '../workspace/pluginRuntime'
import { showToast } from '../workspace/toast'
import type { InstalledPlugin, DevPlugin } from '../workspace/pluginTypes'

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
        </SettingCard>

        {/* Update */}
        <SettingCard icon={<Download size={16} />} title={t(locale, 'update.title')}>
          <UpdateChecker locale={locale} />
        </SettingCard>
        {/* Plugins */}
        <PluginsCard />
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
        if (typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window) {
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

function PluginsCard() {
  const plugins = usePluginStore((s) => s.plugins)
  const devPlugins = usePluginStore((s) => s.devPlugins)
  const [loading, setLoading] = useState<Record<string, boolean>>({})
  const [error, setError] = useState<Record<string, string>>({})

  const setItemLoading = (key: string, v: boolean) =>
    setLoading((prev) => ({ ...prev, [key]: v }))

  const setItemError = (key: string, msg: string) =>
    setError((prev) => ({ ...prev, [key]: msg }))

  const clearItemError = (key: string) =>
    setError((prev) => { const n = { ...prev }; delete n[key]; return n })

  async function handleInstall() {
    const folder = await pickLocalPluginFolder()
    if (!folder) return
    setItemLoading('_install', true)
    clearItemError('_install')
    try {
      const plugin = await installLocalPlugin(folder)
      showToast(`Plugin "${plugin.displayName}" installed (disabled by default)`, 'success')
    } catch (err: unknown) {
      setItemError('_install', err instanceof Error ? err.message : String(err))
    } finally {
      setItemLoading('_install', false)
    }
  }

  async function handleSideload() {
    const folder = await pickLocalPluginFolder()
    if (!folder) return
    setItemLoading('_sideload', true)
    clearItemError('_sideload')
    try {
      await sideloadDevPlugin(folder)
    } catch (err: unknown) {
      setItemError('_sideload', err instanceof Error ? err.message : String(err))
    } finally {
      setItemLoading('_sideload', false)
    }
  }

  async function handleEnable(pluginId: string) {
    setItemLoading(pluginId, true)
    clearItemError(pluginId)
    try {
      await enablePlugin(pluginId)
    } catch (err: unknown) {
      setItemError(pluginId, err instanceof Error ? err.message : String(err))
    } finally {
      setItemLoading(pluginId, false)
    }
  }

  function handleDisable(pluginId: string) {
    disablePlugin(pluginId)
  }

  async function handleReload(pluginId: string) {
    setItemLoading(pluginId, true)
    clearItemError(pluginId)
    try {
      await reloadPlugin(pluginId)
    } catch (err: unknown) {
      setItemError(pluginId, err instanceof Error ? err.message : String(err))
    } finally {
      setItemLoading(pluginId, false)
    }
  }

  function handleUninstall(pluginId: string) {
    doUninstallPlugin(pluginId)
  }

  async function handleReloadDev(pluginId: string) {
    const key = 'dev:' + pluginId
    setItemLoading(key, true)
    clearItemError(key)
    try {
      await reloadDevPlugin(pluginId)
    } catch (err: unknown) {
      setItemError(key, err instanceof Error ? err.message : String(err))
    } finally {
      setItemLoading(key, false)
    }
  }

  function handleRemoveDev(pluginId: string) {
    doRemoveDevPlugin(pluginId)
  }

  async function handleWatch(pluginId: string) {
    const key = 'dev:watch:' + pluginId
    setItemLoading(key, true)
    clearItemError(key)
    try {
      await watchDevPlugin(pluginId)
    } catch (err: unknown) {
      setItemError(key, err instanceof Error ? err.message : String(err))
    } finally {
      setItemLoading(key, false)
    }
  }

  function handleUnwatch(pluginId: string) {
    unwatchDevPlugin(pluginId)
  }

  const prodPlugins = Object.values(plugins)
  const devPluginList = Object.values(devPlugins)

  return (
    <div className="col-span-2 p-3.5 px-4 rounded-xl" style={{ border: '0.5px solid var(--color-border-tertiary)', background: 'var(--color-background-primary)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="font-medium flex items-center gap-1.5" style={{ fontSize: '1em', color: 'var(--color-text-primary)' }}>
          <span style={{ color: 'var(--color-accent)' }}><Plug size={16} /></span>
          Plugins
        </div>
        <div className="flex items-center gap-2">
          <ActionButton onClick={handleInstall} loading={loading['_install']} label="Install Local Plugin" />
          <ActionButton onClick={handleSideload} loading={loading['_sideload']} label="Side-load [DEV]" accent />
        </div>
      </div>
      {error['_install'] && <div className="text-[11px] mb-2" style={{ color: 'var(--color-error-text)' }}>{error['_install']}</div>}
      {error['_sideload'] && <div className="text-[11px] mb-2" style={{ color: 'var(--color-error-text)' }}>{error['_sideload']}</div>}

      {/* Production plugins */}
      {prodPlugins.length > 0 && (
        <div className="mb-3">
          <div className="text-[11px] mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Installed Plugins</div>
          <div className="flex flex-col gap-1.5">
            {prodPlugins.map((plugin) => (
              <PluginRow
                key={plugin.pluginId}
                plugin={plugin}
                loading={!!loading[plugin.pluginId]}
                localError={error[plugin.pluginId]}
                onEnable={() => handleEnable(plugin.pluginId)}
                onDisable={() => handleDisable(plugin.pluginId)}
                onReload={() => handleReload(plugin.pluginId)}
                onUninstall={() => handleUninstall(plugin.pluginId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Dev plugins */}
      {devPluginList.length > 0 && (
        <div>
          <div className="text-[11px] mb-1.5" style={{ color: 'var(--color-text-tertiary)' }}>Dev Plugins (session-scoped)</div>
          <div className="flex flex-col gap-1.5">
            {devPluginList.map((plugin) => (
              <DevPluginRow
                key={plugin.pluginId}
                plugin={plugin}
                loading={!!loading['dev:' + plugin.pluginId]}
                watchLoading={!!loading['dev:watch:' + plugin.pluginId]}
                localError={error['dev:' + plugin.pluginId]}
                onReload={() => handleReloadDev(plugin.pluginId)}
                onRemove={() => handleRemoveDev(plugin.pluginId)}
                onWatch={() => handleWatch(plugin.pluginId)}
                onUnwatch={() => handleUnwatch(plugin.pluginId)}
              />
            ))}
          </div>
        </div>
      )}

      {prodPlugins.length === 0 && devPluginList.length === 0 && (
        <div className="py-4 text-center" style={{ fontSize: '0.85em', color: 'var(--color-text-tertiary)' }}>
          No plugins installed. Use "Install Local Plugin" or "Side-load [DEV]" to add plugins.
        </div>
      )}
    </div>
  )
}

function ActionButton({ onClick, loading, label, accent }: { onClick: () => void; loading?: boolean; label: string; accent?: boolean }) {
  return (
    <button
      className="flex items-center gap-1 px-2.5 py-1 rounded-md cursor-pointer text-[11px]"
      style={{
        background: accent ? 'var(--color-accent-light)' : 'var(--color-background-tertiary)',
        color: accent ? 'var(--color-accent)' : 'var(--color-text-secondary)',
        border: '0.5px solid var(--color-border-tertiary)',
        opacity: loading ? 0.6 : 1,
        pointerEvents: loading ? 'none' : 'auto',
      }}
      onClick={onClick}
      disabled={loading}
    >
      {loading ? '...' : label}
    </button>
  )
}

function StatusBadge({ status }: { status: InstalledPlugin['status'] }) {
  const color = status === 'enabled' ? 'var(--color-success-text)' : status === 'error' ? 'var(--color-error-text)' : status === 'loading' ? 'var(--color-accent)' : 'var(--color-text-tertiary)'
  const bg = status === 'enabled' ? 'var(--color-success-bg)' : status === 'error' ? 'var(--color-error-bg)' : status === 'loading' ? 'var(--color-accent-light)' : 'var(--color-background-tertiary)'
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: bg, color }}>
      {status}
    </span>
  )
}

function PluginRow({
  plugin, loading, localError,
  onEnable, onDisable, onReload, onUninstall,
}: {
  plugin: InstalledPlugin
  loading: boolean
  localError?: string
  onEnable: () => void
  onDisable: () => void
  onReload: () => void
  onUninstall: () => void
}) {
  const [showCaps, setShowCaps] = useState(false)
  return (
    <div className="p-2.5 rounded-lg" style={{ background: 'var(--color-background-secondary)', border: '0.5px solid var(--color-border-tertiary)' }}>
      <div className="flex items-center gap-2">
        <Package size={14} style={{ color: 'var(--color-text-tertiary)', flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[12px] font-medium" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{plugin.displayName}</span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>v{plugin.version}</span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>· {plugin.pluginId}</span>
          </div>
          {(plugin.error || localError) && (
            <div className="flex items-center gap-1 mt-0.5">
              <AlertCircle size={10} style={{ color: 'var(--color-error-text)', flexShrink: 0 }} />
              <span className="text-[10px]" style={{ color: 'var(--color-error-text)' }}>{plugin.error || localError}</span>
            </div>
          )}
          {plugin.capabilities && plugin.capabilities.length > 0 && (
            <div className="flex items-center gap-1 mt-0.5 flex-wrap">
              {plugin.capabilities.slice(0, showCaps ? undefined : 3).map((cap) => (
                <span key={cap} className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--color-background-tertiary)', color: 'var(--color-text-tertiary)' }}>{cap}</span>
              ))}
              {!showCaps && plugin.capabilities.length > 3 && (
                <button className="text-[9px]" style={{ color: 'var(--color-accent)' }} onClick={() => setShowCaps(true)}>+{plugin.capabilities.length - 3} more</button>
              )}
            </div>
          )}
        </div>
        <StatusBadge status={plugin.status} />
        <div className="flex items-center gap-1 shrink-0">
          {loading && <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>...</span>}
          {!loading && plugin.status === 'disabled' && <ActionButton onClick={onEnable} label="Enable" />}
          {!loading && plugin.status === 'enabled' && <ActionButton onClick={onDisable} label="Disable" />}
          {!loading && (plugin.status === 'enabled' || plugin.status === 'error') && <ActionButton onClick={onReload} label="Reload" />}
          {!loading && <ActionButton onClick={onUninstall} label="Uninstall" />}
        </div>
      </div>
    </div>
  )
}

function DevPluginRow({
  plugin, loading, watchLoading, localError, onReload, onRemove, onWatch, onUnwatch,
}: {
  plugin: DevPlugin
  loading: boolean
  watchLoading?: boolean
  localError?: string
  onReload: () => void
  onRemove: () => void
  onWatch: () => void
  onUnwatch: () => void
}) {
  return (
    <div className="p-2.5 rounded-lg" style={{ background: 'var(--color-accent-light)', border: '0.5px solid var(--color-border-tertiary)' }}>
      <div className="flex items-center gap-2">
        <Plug size={14} style={{ color: 'var(--color-accent)', flexShrink: 0 }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[11px] font-medium px-1 py-0.5 rounded" style={{ background: 'var(--color-accent)', color: '#fff' }}>[DEV]</span>
            <span className="text-[12px] font-medium" style={{ color: 'var(--color-text-primary)', fontFamily: 'var(--font-mono)' }}>{plugin.displayName}</span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>v{plugin.version}</span>
            <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>· {plugin.pluginId}</span>
            {plugin.watching && (
              <span className="text-[9px] px-1 py-0.5 rounded" style={{ background: 'var(--color-accent)', color: '#fff' }}>watching</span>
            )}
          </div>
          {(plugin.error || localError) && (
            <div className="flex items-center gap-1 mt-0.5">
              <AlertCircle size={10} style={{ color: 'var(--color-error-text)', flexShrink: 0 }} />
              <span className="text-[10px]" style={{ color: 'var(--color-error-text)' }}>{plugin.error || localError}</span>
            </div>
          )}
        </div>
        <span className="text-[10px] px-1.5 py-0.5 rounded shrink-0" style={{ background: plugin.status === 'active' ? 'var(--color-success-bg)' : 'var(--color-error-bg)', color: plugin.status === 'active' ? 'var(--color-success-text)' : 'var(--color-error-text)' }}>
          {plugin.status}
        </span>
        <div className="flex items-center gap-1 shrink-0">
          {(loading || watchLoading) && <span className="text-[10px]" style={{ color: 'var(--color-text-tertiary)' }}>...</span>}
          {!loading && !watchLoading && !plugin.watching && (
            <ActionButton onClick={onWatch} label="Watch" accent />
          )}
          {!loading && !watchLoading && plugin.watching && (
            <ActionButton onClick={onUnwatch} label="Unwatch" />
          )}
          {!loading && <ActionButton onClick={onReload} label="Reload" />}
          {!loading && <ActionButton onClick={onRemove} label="Remove" />}
        </div>
      </div>
    </div>
  )
}
