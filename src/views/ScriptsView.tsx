import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Archive, Download, ExternalLink, FolderOpen, Globe, Loader2, Package, Plus, Power, RefreshCw, Search, Trash2, Upload } from 'lucide-react'
import { useT, t } from '../i18n'
import type { Locale } from '../i18n'
import { localized, useAppStore } from '../store'
import { checkBuiltinPluginsUpdate, getConfigDir } from '../configInit'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { usePluginStore } from '../workspace/pluginStore'
import {
  createDevPluginScaffold,
  checkInstalledPluginUpdate,
  disablePlugin,
  enablePlugin,
  importDevPluginDirectory,
  importGithubDirectory,
  importLocalPluginDirectory,
  importPluginZip,
  importPluginZipUrl,
  isPluginZipUrl,
  listPluginDirs,
  openPluginDir,
  pickLocalPluginFolder,
  pickPluginZipFile,
  rejectSingleFileRemoteImport,
  reloadDevPlugin,
  reloadPlugin,
  removeDevPlugin,
  updateInstalledPlugin,
  uninstallPlugin,
  unwatchDevPlugin,
  watchDevPlugin,
} from '../workspace/pluginRuntime'
import type { PluginPackageSummary } from '../workspace/pluginRuntime'
import type { DevPlugin, InstalledPlugin } from '../workspace/pluginTypes'

type TabId = 'builtin' | 'installed' | 'dev'
type BusyMap = Record<string, boolean>
type ErrorMap = Record<string, string>

function isTauri() {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

function textMatches(value: string | undefined, query: string) {
  return (value ?? '').toLowerCase().includes(query)
}

function sourceLabel(plugin: InstalledPlugin | DevPlugin, locale: 'zh' | 'en') {
  const source = plugin.source ?? 'local'
  if (source === 'github') return t(locale, 'scripts.source.github')
  if (source === 'zip') return t(locale, 'scripts.source.zip')
  if (source === 'builtin') return t(locale, 'scripts.source.builtin')
  return t(locale, 'scripts.source.local')
}

function statusLabel(status: string, locale: 'zh' | 'en') {
  if (status === 'enabled') return t(locale, 'scripts.status.enabled')
  if (status === 'disabled') return t(locale, 'scripts.status.disabled')
  if (status === 'error') return t(locale, 'scripts.status.error')
  if (status === 'loading') return t(locale, 'scripts.status.loading')
  if (status === 'active') return t(locale, 'scripts.status.active')
  return t(locale, 'scripts.status.available')
}

function packagePath(plugin: InstalledPlugin | DevPlugin) {
  return plugin.packagePath ?? plugin.folderPath ?? ''
}

function capabilitiesOf(plugin: InstalledPlugin | DevPlugin | PluginPackageSummary) {
  return Array.isArray(plugin.capabilities) ? plugin.capabilities : []
}

function pluginDisplayName(
  plugin: Pick<InstalledPlugin | DevPlugin | PluginPackageSummary, 'pluginId' | 'displayName' | 'displayNameI18n'>,
  locale: Locale,
) {
  return localized(plugin.displayName || plugin.pluginId, plugin.displayNameI18n, locale)
}

export function ScriptsView() {
  const locale = useAppStore((s) => s.locale)
  const openPluginEditor = useAppStore((s) => s.openPluginEditor)
  const plugins = usePluginStore((s) => s.plugins)
  const devPlugins = usePluginStore((s) => s.devPlugins)
  const [activeTab, setActiveTab] = useState<TabId>('builtin')
  const [query, setQuery] = useState('')
  const [builtinPlugins, setBuiltinPlugins] = useState<PluginPackageSummary[]>([])
  const [installedPackages, setInstalledPackages] = useState<PluginPackageSummary[]>([])
  const [busy, setBusy] = useState<BusyMap>({})
  const [errors, setErrors] = useState<ErrorMap>({})
  const [listError, setListError] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteOpen, setRemoteOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'done' | 'error'>('idle')
  const isImeComposingRef = useRef(false)

  const installedList = useMemo(() => {
    const byId = new Map<string, InstalledPlugin>()
    for (const plugin of Object.values(plugins).filter(Boolean)) {
      byId.set(plugin.pluginId, plugin)
    }
    for (const pkg of installedPackages) {
      const existing = byId.get(pkg.pluginId)
      if (existing) {
        if (pkg.error) {
          byId.set(pkg.pluginId, {
            ...existing,
            displayName: pkg.displayName,
            displayNameI18n: pkg.displayNameI18n,
            version: pkg.version,
            entry: pkg.entry,
            capabilities: pkg.capabilities,
            folderPath: pkg.folderPath,
            packagePath: pkg.folderPath,
            status: 'error',
            error: pkg.error,
          })
        }
        continue
      }
      byId.set(pkg.pluginId, {
        pluginId: pkg.pluginId,
        displayName: pkg.displayName,
        displayNameI18n: pkg.displayNameI18n,
        version: pkg.version,
        entry: pkg.entry,
        capabilities: pkg.capabilities,
        folderPath: pkg.folderPath,
        packagePath: pkg.folderPath,
        source: 'local',
        status: pkg.error ? 'error' : 'disabled',
        error: pkg.error,
        update: { status: 'idle' },
        installedAt: 0,
        updatedAt: 0,
      })
    }
    return Array.from(byId.values())
  }, [plugins, installedPackages])
  const devList = useMemo(() => Object.values(devPlugins).filter(Boolean), [devPlugins])
  const normalizedQuery = query.trim().toLowerCase()

  useEffect(() => {
    let cancelled = false
    async function loadDirectoryPlugins() {
      if (!isTauri()) return
      const configDir = await getConfigDir()
      if (!configDir || cancelled) return
      try {
        setListError('')
        const [builtinSummaries, installedSummaries] = await Promise.all([
          listPluginDirs(`${configDir}/plugins/builtin`),
          listPluginDirs(`${configDir}/plugins/installed`),
        ])
        if (!cancelled) {
          setBuiltinPlugins(builtinSummaries)
          setInstalledPackages(installedSummaries)
          const store = usePluginStore.getState()
          for (const pkg of installedSummaries) {
            if (pkg.error) continue
            if (store.plugins[pkg.pluginId]) {
              store.updatePluginMetadata(pkg.pluginId, {
                displayName: pkg.displayName,
                displayNameI18n: pkg.displayNameI18n,
                version: pkg.version,
                entry: pkg.entry,
                capabilities: pkg.capabilities,
                folderPath: pkg.folderPath,
                packagePath: pkg.folderPath,
              })
              continue
            }
            store.installPlugin({
              pluginId: pkg.pluginId,
              displayName: pkg.displayName,
              displayNameI18n: pkg.displayNameI18n,
              version: pkg.version,
              entry: pkg.entry,
              capabilities: pkg.capabilities,
              folderPath: pkg.folderPath,
              packagePath: pkg.folderPath,
              source: 'local',
              status: 'disabled',
              update: { status: 'idle' },
              installedAt: Date.now(),
              updatedAt: Date.now(),
            })
          }
        }
      } catch (error) {
        if (!cancelled) setBuiltinPlugins([])
        if (!cancelled) setInstalledPackages([])
        if (!cancelled) setListError(error instanceof Error ? error.message : String(error))
      }
    }
    void loadDirectoryPlugins()
    return () => { cancelled = true }
  }, [updateStatus])

  const filteredBuiltin = useMemo(() => {
    if (!normalizedQuery) return builtinPlugins
    return builtinPlugins.filter((plugin) =>
      textMatches(plugin.pluginId, normalizedQuery) ||
      textMatches(pluginDisplayName(plugin, locale), normalizedQuery) ||
      textMatches(plugin.folderPath, normalizedQuery),
    )
  }, [builtinPlugins, locale, normalizedQuery])

  const filteredInstalled = useMemo(() => {
    if (!normalizedQuery) return installedList
    return installedList.filter((plugin) =>
      textMatches(plugin.pluginId, normalizedQuery) ||
      textMatches(pluginDisplayName(plugin, locale), normalizedQuery) ||
      textMatches(plugin.folderPath, normalizedQuery) ||
      textMatches(plugin.sourceUrl, normalizedQuery),
    )
  }, [installedList, locale, normalizedQuery])

  const filteredDev = useMemo(() => {
    if (!normalizedQuery) return devList
    return devList.filter((plugin) =>
      textMatches(plugin.pluginId, normalizedQuery) ||
      textMatches(pluginDisplayName(plugin, locale), normalizedQuery) ||
      textMatches(plugin.folderPath, normalizedQuery),
    )
  }, [devList, locale, normalizedQuery])

  const setItemBusy = (key: string, value: boolean) =>
    setBusy((prev) => ({ ...prev, [key]: value }))
  const setItemError = (key: string, message: string) =>
    setErrors((prev) => ({ ...prev, [key]: message }))
  const clearItemError = (key: string) =>
    setErrors((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })

  async function runTask(key: string, task: () => Promise<void>) {
    if (!isTauri()) {
      setItemError(key, t(locale, 'scripts.desktopRequired'))
      return
    }
    setItemBusy(key, true)
    clearItemError(key)
    try {
      await task()
    } catch (error) {
      setItemError(key, error instanceof Error ? error.message : String(error))
    } finally {
      setItemBusy(key, false)
    }
  }

  async function handleInstallDirectory() {
    const folder = await pickLocalPluginFolder()
    if (!folder) return
    await runTask('_install-folder', async () => {
      await importLocalPluginDirectory(folder)
      setActiveTab('installed')
    })
  }

  async function handleInstallZip() {
    const zipPath = await pickPluginZipFile()
    if (!zipPath) return
    await runTask('_install-zip', async () => {
      await importPluginZip(zipPath)
      setActiveTab('installed')
    })
  }

  async function handleSideloadDev() {
    const folder = await pickLocalPluginFolder()
    if (!folder) return
    await runTask('_dev-folder', async () => {
      await importDevPluginDirectory(folder)
      setActiveTab('dev')
    })
  }

  async function handleCreatePlugin() {
    await runTask('_new-plugin', async () => {
      const plugin = await createDevPluginScaffold()
      setActiveTab('dev')
      await openPluginDir(plugin.folderPath)
    })
  }

  async function handleRemoteInstall() {
    const url = remoteUrl.trim()
    if (!url) return
    await runTask('_remote', async () => {
      rejectSingleFileRemoteImport(url)
      if (isPluginZipUrl(url)) {
        await importPluginZipUrl(url)
      } else {
        await importGithubDirectory(url)
      }
      setRemoteOpen(false)
      setRemoteUrl('')
      setActiveTab('installed')
    })
  }

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

  async function handlePackageUpdateCheck() {
    setUpdateStatus('checking')
    try {
      await checkBuiltinPluginsUpdate()
      setUpdateStatus('done')
    } catch {
      setUpdateStatus('error')
    }
  }

  function renderInstalled(plugin: InstalledPlugin) {
    const key = plugin.pluginId
    const loading = !!busy[key]
    const localError = errors[key]
    return (
      <PluginCard
        key={plugin.pluginId}
        title={pluginDisplayName(plugin, locale)}
        subtitle={plugin.pluginId}
        version={plugin.version || '0.0.0'}
        source={sourceLabel(plugin, locale)}
        status={statusLabel(plugin.status, locale)}
        folderPath={packagePath(plugin)}
        sourceUrl={plugin.sourceUrl}
        capabilities={capabilitiesOf(plugin)}
          error={plugin.error || localError || plugin.update?.error}
        loading={loading}
        actions={
          <>
            <IconButton
              title={t(locale, 'scripts.actionOpenEditor')}
              onClick={() => openPluginEditor({ pluginId: plugin.pluginId, folderPath: plugin.folderPath, source: 'installed' })}
            >
              <FolderOpen size={13} />
            </IconButton>
            {plugin.status !== 'enabled' && (
              <IconButton title={t(locale, 'scripts.actionEnable')} onClick={() => runTask(key, () => enablePlugin(plugin.pluginId))}>
                <Power size={13} />
              </IconButton>
            )}
            {plugin.status === 'enabled' && (
              <IconButton title={t(locale, 'scripts.actionDisable')} onClick={() => disablePlugin(plugin.pluginId)}>
                <Power size={13} />
              </IconButton>
            )}
            <IconButton title={t(locale, 'scripts.actionReload')} onClick={() => runTask(key, () => reloadPlugin(plugin.pluginId))}>
              <RefreshCw size={13} />
            </IconButton>
              {plugin.source === 'github' && (
                <IconButton
                  title={t(locale, 'scripts.actionCheckPluginUpdate')}
                  onClick={() => runTask(`${key}:check-update`, () => checkInstalledPluginUpdate(plugin.pluginId).then(() => undefined))}
                >
                  <Download size={13} />
                </IconButton>
              )}
              {plugin.source === 'github' && plugin.update?.status === 'available' && (
                <IconButton
                  title={t(locale, 'scripts.actionUpdatePlugin').replace('{version}', plugin.update.latestVersion || '')}
                  onClick={() => runTask(`${key}:update`, () => updateInstalledPlugin(plugin.pluginId).then(() => undefined))}
                >
                  <RefreshCw size={13} />
                </IconButton>
              )}
            <IconButton title={t(locale, 'scripts.actionUninstall')} onClick={() => runTask(key, async () => {
              await uninstallPlugin(plugin.pluginId)
              setUpdateStatus('checking')
              setUpdateStatus('done')
            })}>
              <Trash2 size={13} />
            </IconButton>
          </>
        }
      />
    )
  }

  function renderDev(plugin: DevPlugin) {
    const key = `dev:${plugin.pluginId}`
    return (
      <PluginCard
        key={plugin.pluginId}
        title={pluginDisplayName(plugin, locale)}
        subtitle={plugin.pluginId}
        version={plugin.version || '0.0.0'}
        source={sourceLabel(plugin, locale)}
        status={statusLabel(plugin.status, locale)}
        folderPath={packagePath(plugin)}
        sourceUrl={plugin.sourceUrl}
        capabilities={capabilitiesOf(plugin)}
        error={plugin.error || errors[key]}
        loading={!!busy[key]}
        actions={
          <>
            <IconButton
              title={t(locale, 'scripts.actionOpenEditor')}
              onClick={() => openPluginEditor({ pluginId: plugin.pluginId, folderPath: plugin.folderPath, source: 'dev' })}
            >
              <FolderOpen size={13} />
            </IconButton>
            <IconButton
              title={t(locale, 'scripts.actionOpenExternal')}
              onClick={() => runTask(key, () => openPluginDir(plugin.folderPath))}
            >
              <ExternalLink size={13} />
            </IconButton>
            {plugin.watching ? (
              <IconButton title={t(locale, 'scripts.actionStopWatching')} onClick={() => unwatchDevPlugin(plugin.pluginId)}>
                <Power size={13} />
              </IconButton>
            ) : (
              <IconButton title={t(locale, 'scripts.actionWatchDev')} onClick={() => runTask(key, () => watchDevPlugin(plugin.pluginId))}>
                <Power size={13} />
              </IconButton>
            )}
            <IconButton title={t(locale, 'scripts.actionReloadDev')} onClick={() => runTask(key, () => reloadDevPlugin(plugin.pluginId))}>
              <RefreshCw size={13} />
            </IconButton>
            <IconButton title={t(locale, 'scripts.actionRemoveDev')} onClick={() => removeDevPlugin(plugin.pluginId)}>
              <Trash2 size={13} />
            </IconButton>
          </>
        }
      />
    )
  }

  function renderBuiltin(plugin: PluginPackageSummary) {
    return (
      <PluginCard
        key={plugin.pluginId}
        title={pluginDisplayName(plugin, locale)}
        subtitle={plugin.pluginId}
        version={plugin.version || '0.0.0'}
        source={t(locale, 'scripts.source.builtin')}
        status={t(locale, 'scripts.status.available')}
        folderPath={plugin.folderPath || ''}
        capabilities={capabilitiesOf(plugin)}
        error={plugin.error}
        actions={
          <>
            <IconButton
              title={t(locale, 'scripts.actionOpenEditor')}
              onClick={() => openPluginEditor({ pluginId: plugin.pluginId, folderPath: plugin.folderPath, source: 'builtin', readOnly: true })}
            >
              <FolderOpen size={13} />
            </IconButton>
            <span className="script-badge">{t(locale, 'scripts.readOnly')}</span>
          </>
        }
      />
    )
  }

  const activeItems = activeTab === 'builtin' ? filteredBuiltin : activeTab === 'installed' ? filteredInstalled : filteredDev
  const totalCount = filteredBuiltin.length + filteredInstalled.length + filteredDev.length

  return (
    <div className="scripts-content">
      <div className="scripts-header">
        <span className="scripts-title">{t(locale, 'scripts.title')}</span>
        <div className="scripts-header-actions">
          <button data-testid="plugin-new-button" onClick={handleCreatePlugin} className="scripts-btn scripts-btn-primary">
            <Plus size={14} /> {t(locale, 'scripts.new')}
          </button>
          <button onClick={() => setRemoteOpen(true)} className="scripts-btn">
            <Globe size={14} /> {t(locale, 'scripts.importGithub')}
          </button>
          <button onClick={handleInstallZip} className="scripts-btn">
            <Archive size={14} /> {t(locale, 'scripts.importZip')}
          </button>
          <button onClick={handleInstallDirectory} className="scripts-btn">
            <Upload size={14} /> {t(locale, 'scripts.importFolder')}
          </button>
          <button onClick={handleSideloadDev} className="scripts-btn scripts-btn-primary">
            <FolderOpen size={14} /> {t(locale, 'scripts.importDev')}
          </button>
        </div>
      </div>

      <div className="scripts-search-bar">
        <Search size={14} />
        <input
          className="scripts-search-input"
          type="text"
          placeholder={t(locale, 'scripts.searchPlaceholder')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <span className={`scripts-search-count ${query ? 'has-query' : ''}`}>{totalCount}</span>
      </div>

      <div className="scripts-tabs">
        <button className={`scripts-tab ${activeTab === 'builtin' ? 'active' : ''}`} onClick={() => setActiveTab('builtin')}>
          {t(locale, 'scripts.tabBuiltin')}
          <span className={`scripts-tab-count ${activeTab === 'builtin' ? 'active' : ''}`}>{builtinPlugins.length}</span>
        </button>
        <button className={`scripts-tab ${activeTab === 'installed' ? 'active' : ''}`} onClick={() => setActiveTab('installed')}>
          {t(locale, 'scripts.tabInstalled')}
          <span className={`scripts-tab-count ${activeTab === 'installed' ? 'active' : ''}`}>{installedList.length}</span>
        </button>
        <button className={`scripts-tab ${activeTab === 'dev' ? 'active' : ''}`} onClick={() => setActiveTab('dev')}>
          {t(locale, 'scripts.tabDev')}
          <span className={`scripts-tab-count ${activeTab === 'dev' ? 'active' : ''}`}>{devList.length}</span>
        </button>
      </div>

      <div className="flex items-center justify-between mb-2 px-1">
        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>
          {activeTab === 'builtin'
            ? t(locale, 'scripts.sectionBuiltin')
            : activeTab === 'installed'
              ? t(locale, 'scripts.sectionInstalled')
              : t(locale, 'scripts.sectionDev')}
        </span>
        <button onClick={handlePackageUpdateCheck} className="scripts-btn" style={{ fontSize: 'var(--text-xs)', padding: '2px 8px' }}>
          {updateStatus === 'checking' ? <Loader2 size={11} className="animate-spin" /> : <Download size={11} />}
          {t(locale, 'scripts.checkPackageUpdates')}
        </button>
      </div>
      {updateStatus === 'error' && (
        <div className="text-[11px] mb-2" style={{ color: 'var(--color-error-text)' }}>{t(locale, 'scripts.packageUpdateError')}</div>
      )}
      {listError && (
        <div className="text-[11px] mb-2 flex items-center gap-1" style={{ color: 'var(--color-error-text)' }}>
          <AlertTriangle size={12} /> {listError}
        </div>
      )}

      <div className="scripts-search-results">
        {activeItems.length === 0 ? (
          <div className="scripts-empty">
            <Package size={40} strokeWidth={1.5} />
            <div className="scripts-empty-text">
              {activeTab === 'installed'
                ? t(locale, 'scripts.emptyInstalled')
                : activeTab === 'builtin'
                  ? t(locale, 'scripts.emptyBuiltin')
                  : t(locale, 'scripts.emptyDev')}
            </div>
          </div>
        ) : (
          activeTab === 'builtin'
            ? filteredBuiltin.map(renderBuiltin)
            : activeTab === 'installed'
            ? filteredInstalled.map(renderInstalled)
            : filteredDev.map(renderDev)
        )}
      </div>

      {(errors['_install-folder'] || errors['_install-zip'] || errors['_dev-folder'] || errors['_new-plugin']) && (
        <div className="mt-2 flex items-center gap-1" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error-text)' }}>
          <AlertTriangle size={12} />
          {errors['_install-folder'] || errors['_install-zip'] || errors['_dev-folder'] || errors['_new-plugin']}
        </div>
      )}

      {remoteOpen && (
        <div className="modal-overlay open" onClick={() => { if (!busy['_remote']) setRemoteOpen(false) }}>
          <div className="modal-panel" onClick={(event) => event.stopPropagation()}>
            <div className="modal-header">
              <div className="modal-title">
                <Globe size={16} />
                  {t(locale, 'scripts.remoteImportDirectoryTitle')}
              </div>
              <button onClick={() => setRemoteOpen(false)} className="modal-close">x</button>
            </div>
            <div className="modal-body">
              <div className="modal-desc">
                  {t(locale, 'scripts.remoteImportDirectoryDesc')}
              </div>
              <div className="modal-url-row">
                <input
                  type="text"
                  className="modal-url-input"
                  value={remoteUrl}
                  onChange={(event) => {
                    setRemoteUrl(event.target.value)
                    clearItemError('_remote')
                  }}
                  onKeyDown={(event) => {
                    if (shouldIgnoreImeKeyDown(event, isImeComposingRef)) return
                    if (event.key === 'Enter' && !busy['_remote']) void handleRemoteInstall()
                  }}
                  onCompositionStart={handleCompositionStart}
                  onCompositionEnd={handleCompositionEnd}
                  placeholder="https://github.com/owner/repo/tree/main/plugin or https://example.com/plugin.zip"
                  autoFocus
                  disabled={busy['_remote']}
                />
                <button onClick={handleRemoteInstall} disabled={busy['_remote'] || !remoteUrl.trim()} className="scripts-btn scripts-btn-primary">
                  {busy['_remote'] ? <Loader2 size={12} className="animate-spin" /> : t(locale, 'scripts.confirm')}
                </button>
              </div>
              {errors['_remote'] && (
                <div className="mt-2 flex items-center gap-1" style={{ fontSize: 'var(--text-sm)', color: 'var(--color-error-text)' }}>
                  <AlertTriangle size={12} /> {errors['_remote']}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function IconButton({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button onClick={onClick} className="script-action-btn" title={title}>
      {children}
    </button>
  )
}

function PluginCard({
  title,
  subtitle,
  version,
  source,
  status,
  folderPath,
  sourceUrl,
  capabilities,
  error,
  loading,
  actions,
}: {
  title: string
  subtitle: string
  version: string
  source: string
  status: string
  folderPath: string
  sourceUrl?: string
  capabilities?: string[]
  error?: string
  loading?: boolean
  actions: ReactNode
}) {
  return (
    <div className="script-card anim-card-in" style={{ borderColor: error ? 'var(--color-error)' : undefined }}>
      <div className="script-icon">
        {loading ? <Loader2 size={16} className="animate-spin" /> : <Package size={16} />}
      </div>
      <div className="script-info">
        <div className="script-name">
          {title}
          <span className="script-badge ml-2">{source}</span>
          <span className="script-badge ml-1">{status}</span>
        </div>
        <div className="script-desc truncate">v{version} · {subtitle}</div>
        <div className="script-desc truncate">{folderPath}</div>
        {sourceUrl && <div className="script-desc truncate">{sourceUrl}</div>}
        {(capabilities ?? []).length > 0 && (
          <div className="flex items-center gap-1 mt-1 flex-wrap">
            {(capabilities ?? []).map((capability) => (
              <span key={capability} className="script-badge">{capability}</span>
            ))}
          </div>
        )}
        {error && (
          <div className="flex items-center gap-1 mt-1" style={{ color: 'var(--color-error-text)', fontSize: 'var(--text-sm)' }}>
            <AlertTriangle size={12} /> {error}
          </div>
        )}
      </div>
      {actions}
    </div>
  )
}
