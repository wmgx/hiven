import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { AlertTriangle, Download, ExternalLink, FolderOpen, Globe, Keyboard, Loader2, Package, Power, RefreshCw, Search, Settings, Trash2 } from 'lucide-react'
import { t } from '../i18n'
import type { Locale } from '../i18n'
import { localized, useAppStore } from '../store'
import { checkBuiltinPluginsUpdate, getConfigDir } from '../configInit'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { usePluginStore } from '../workspace/pluginStore'
import { usePluginSettingsStore } from '../workspace/pluginSettingsStore'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'
import { describePluginPermission, getPluginPermissionSnapshot, missingPluginPermissions, usePluginPermissionStore } from '../workspace/pluginPermissions'
import { runPluginStartupHooks } from '../workspace/pluginHookManager'
import { requestOpenPluginSurfaceTool } from '../workspace/pluginSurfaceOpenRequest'
import { pluginSurfaceShortcutKey, usePluginSurfaceShortcutStore } from '../workspace/pluginSurfaceShortcuts'
import { ShortcutRecorder } from '../components/ShortcutRecorder'
import { PluginSettingsInline } from '../components/PluginSettingsInline'
import {
  checkInstalledPluginUpdate,
  disablePlugin,
  enablePlugin,
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
import { searchableFieldsMatch, type SearchableFields } from '../workspace/searchRanking'

type TabId = 'builtin' | 'installed' | 'dev'
type BusyMap = Record<string, boolean>
type ErrorMap = Record<string, string>
type PluginDetailRow = {
  key: string
  kind: TabId
  pluginId: string
  title: string
  subtitle: string
  version: string
  source: string
  status: string
  folderPath: string
  sourceUrl?: string
  capabilities: string[]
  error?: string
  loading?: boolean
  settingsSource: PluginSettingsSource
  plugin: InstalledPlugin | DevPlugin | PluginPackageSummary
}

function isTauri() {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
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
  if (status === 'blocked') return t(locale, 'scripts.status.blocked')
  return t(locale, 'scripts.status.available')
}

function surfaceShortcutStatusLabel(status: string, locale: 'zh' | 'en') {
  if (status === 'registered') return t(locale, 'scripts.surfaceShortcutRegistered')
  if (status === 'conflict') return t(locale, 'scripts.surfaceShortcutConflict')
  if (status === 'failed') return t(locale, 'scripts.surfaceShortcutFailed')
  if (status === 'disabled') return t(locale, 'scripts.surfaceShortcutDisabled')
  return t(locale, 'scripts.surfaceShortcutPending')
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

function pluginSearchFields(
  plugin: Pick<InstalledPlugin | DevPlugin | PluginPackageSummary, 'pluginId' | 'displayName' | 'displayNameI18n' | 'folderPath' | 'capabilities'> & { sourceUrl?: string },
): SearchableFields {
  return {
    id: plugin.pluginId,
    title: plugin.displayName || plugin.pluginId,
    titleI18n: plugin.displayNameI18n,
    aliases: [
      plugin.folderPath,
      plugin.sourceUrl,
      ...(Array.isArray(plugin.capabilities) ? plugin.capabilities : []),
    ].filter((value): value is string => Boolean(value)),
  }
}

function pluginMatchesQuery(
  plugin: Pick<InstalledPlugin | DevPlugin | PluginPackageSummary, 'pluginId' | 'displayName' | 'displayNameI18n' | 'folderPath' | 'capabilities'> & { sourceUrl?: string },
  query: string,
  locale: Locale,
) {
  return searchableFieldsMatch(pluginSearchFields(plugin), query, locale)
}

export function ScriptsView() {
  const locale = useAppStore((s) => s.locale)
  const openPluginEditor = useAppStore((s) => s.openPluginEditor)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const pluginSurfaceShortcuts = usePluginSurfaceShortcutStore((s) => s.shortcuts)
  const setPluginSurfaceShortcut = usePluginSurfaceShortcutStore((s) => s.setShortcut)
  const clearPluginSurfaceShortcut = usePluginSurfaceShortcutStore((s) => s.clearShortcut)
  const pluginPermissionVersion = usePluginPermissionStore((s) => s.version)
  const grantPluginPermissions = usePluginPermissionStore((s) => s.grantPermissions)
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
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'checking' | 'done' | 'error'>('idle')
  const [selectedPluginKey, setSelectedPluginKey] = useState('')
  const isImeComposingRef = useRef(false)

  const installedList = useMemo(() => {
    void pluginRegistryVersion
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
  }, [pluginRegistryVersion, plugins, installedPackages])
  const devList = useMemo(() => {
    void pluginRegistryVersion
    return Object.values(devPlugins).filter(Boolean)
  }, [devPlugins, pluginRegistryVersion])
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
    return builtinPlugins.filter((plugin) => pluginMatchesQuery(plugin, normalizedQuery, locale))
  }, [builtinPlugins, locale, normalizedQuery])

  const filteredInstalled = useMemo(() => {
    if (!normalizedQuery) return installedList
    return installedList.filter((plugin) => pluginMatchesQuery(plugin, normalizedQuery, locale))
  }, [installedList, locale, normalizedQuery])

  const filteredDev = useMemo(() => {
    if (!normalizedQuery) return devList
    return devList.filter((plugin) => pluginMatchesQuery(plugin, normalizedQuery, locale))
  }, [devList, locale, normalizedQuery])

  const pluginDetailRows = useMemo<PluginDetailRow[]>(() => {
    void pluginPermissionVersion
    if (activeTab === 'builtin') {
      return filteredBuiltin.map((plugin) => ({
        key: `builtin:${plugin.pluginId}`,
        kind: 'builtin',
        pluginId: plugin.pluginId,
        title: pluginDisplayName(plugin, locale),
        subtitle: plugin.pluginId,
        version: plugin.version || '0.0.0',
        source: t(locale, 'scripts.source.builtin'),
        status: statusLabel(isPluginBlocked(plugin.pluginId, 'builtin') ? 'blocked' : 'available', locale),
        folderPath: plugin.folderPath || '',
        capabilities: capabilitiesOf(plugin),
        error: plugin.error,
        settingsSource: 'builtin',
        plugin,
      }))
    }
    if (activeTab === 'installed') {
      return filteredInstalled.map((plugin) => {
        const key = plugin.pluginId
        return {
          key,
          kind: 'installed',
          pluginId: plugin.pluginId,
          title: pluginDisplayName(plugin, locale),
          subtitle: plugin.pluginId,
          version: plugin.version || '0.0.0',
          source: sourceLabel(plugin, locale),
          status: statusLabel(isPluginBlocked(plugin.pluginId, 'installed') ? 'blocked' : plugin.status, locale),
          folderPath: packagePath(plugin),
          sourceUrl: plugin.sourceUrl,
          capabilities: capabilitiesOf(plugin),
          error: plugin.error || errors[key] || plugin.update?.error,
          loading: !!busy[key],
          settingsSource: 'installed',
          plugin,
        }
      })
    }
    return filteredDev.map((plugin) => {
      const key = `dev:${plugin.pluginId}`
      return {
        key,
        kind: 'dev',
        pluginId: plugin.pluginId,
        title: pluginDisplayName(plugin, locale),
        subtitle: plugin.pluginId,
        version: plugin.version || '0.0.0',
        source: sourceLabel(plugin, locale),
        status: statusLabel(isPluginBlocked(plugin.pluginId, 'dev') ? 'blocked' : plugin.status, locale),
        folderPath: packagePath(plugin),
        sourceUrl: plugin.sourceUrl,
        capabilities: capabilitiesOf(plugin),
        error: plugin.error || errors[key],
        loading: !!busy[key],
        settingsSource: 'dev',
        plugin,
      }
    })
  }, [activeTab, busy, errors, filteredBuiltin, filteredDev, filteredInstalled, locale, pluginPermissionVersion])

  useEffect(() => {
    if (pluginDetailRows.length === 0) {
      if (selectedPluginKey) setSelectedPluginKey('')
      return
    }
    if (!pluginDetailRows.some((row) => row.key === selectedPluginKey)) {
      setSelectedPluginKey(pluginDetailRows[0].key)
    }
  }, [pluginDetailRows, selectedPluginKey])

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
    void pluginPermissionVersion
    const key = plugin.pluginId
    const loading = !!busy[key]
    const localError = errors[key]
    const settingsContribution = pluginRegistry.getPluginDefinition(plugin.pluginId, 'production')?.settings
    const hasSchemaSettings = !!settingsContribution?.schema
    const hasLegacySettings = !!settingsContribution && !settingsContribution.schema
    return (
      <PluginCard
        key={plugin.pluginId}
        title={pluginDisplayName(plugin, locale)}
        subtitle={plugin.pluginId}
        version={plugin.version || '0.0.0'}
        source={sourceLabel(plugin, locale)}
        status={statusLabel(isPluginBlocked(plugin.pluginId, 'installed') ? 'blocked' : plugin.status, locale)}
        folderPath={packagePath(plugin)}
        sourceUrl={plugin.sourceUrl}
        capabilities={capabilitiesOf(plugin)}
          error={plugin.error || localError || plugin.update?.error}
        loading={loading}
        details={
          <>
            {renderPluginPermissions(plugin.pluginId, 'installed')}
            {hasSchemaSettings && (
              <div className="plugin-settings-inline-detail">
                <PluginSettingsInline pluginId={plugin.pluginId} source="installed" locale={locale} />
              </div>
            )}
            {renderSurfaceShortcuts(plugin.pluginId, 'installed')}
          </>
        }
        actions={
          <>
            {hasLegacySettings && (
              <IconButton
                title={t(locale, 'scripts.settings')}
                onClick={() => usePluginSettingsStore.getState().openSettingsDialog({ pluginId: plugin.pluginId, source: 'installed' })}
              >
                <Settings size={13} />
              </IconButton>
            )}
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
    void pluginPermissionVersion
    const key = `dev:${plugin.pluginId}`
    const settingsContribution = pluginRegistry.getPluginDefinition(plugin.pluginId, 'dev')?.settings
    const hasSchemaSettings = !!settingsContribution?.schema
    const hasLegacySettings = !!settingsContribution && !settingsContribution.schema
    return (
      <PluginCard
        key={plugin.pluginId}
        title={pluginDisplayName(plugin, locale)}
        subtitle={plugin.pluginId}
        version={plugin.version || '0.0.0'}
        source={sourceLabel(plugin, locale)}
        status={statusLabel(isPluginBlocked(plugin.pluginId, 'dev') ? 'blocked' : plugin.status, locale)}
        folderPath={packagePath(plugin)}
        sourceUrl={plugin.sourceUrl}
        capabilities={capabilitiesOf(plugin)}
        error={plugin.error || errors[key]}
        loading={!!busy[key]}
        details={
          <>
            {renderPluginPermissions(plugin.pluginId, 'dev')}
            {hasSchemaSettings && (
              <div className="plugin-settings-inline-detail">
                <PluginSettingsInline pluginId={plugin.pluginId} source="dev" locale={locale} />
              </div>
            )}
            {renderSurfaceShortcuts(plugin.pluginId, 'dev')}
          </>
        }
        actions={
          <>
            {hasLegacySettings && (
              <IconButton
                title={t(locale, 'scripts.settings')}
                onClick={() => usePluginSettingsStore.getState().openSettingsDialog({ pluginId: plugin.pluginId, source: 'dev' })}
              >
                <Settings size={13} />
              </IconButton>
            )}
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
    void pluginPermissionVersion
    const settingsContribution = pluginRegistry.getPluginDefinition(plugin.pluginId, 'production')?.settings
    const hasSchemaSettings = !!settingsContribution?.schema
    const hasLegacySettings = !!settingsContribution && !settingsContribution.schema
    return (
      <PluginCard
        key={plugin.pluginId}
        title={pluginDisplayName(plugin, locale)}
        subtitle={plugin.pluginId}
        version={plugin.version || '0.0.0'}
        source={t(locale, 'scripts.source.builtin')}
        status={statusLabel(isPluginBlocked(plugin.pluginId, 'builtin') ? 'blocked' : 'available', locale)}
        folderPath={plugin.folderPath || ''}
        capabilities={capabilitiesOf(plugin)}
        error={plugin.error}
        details={
          <>
            {renderPluginPermissions(plugin.pluginId, 'builtin')}
            {hasSchemaSettings && (
              <div className="plugin-settings-inline-detail">
                <PluginSettingsInline pluginId={plugin.pluginId} source="builtin" locale={locale} />
              </div>
            )}
            {renderSurfaceShortcuts(plugin.pluginId, 'builtin')}
          </>
        }
        actions={
          <>
            {hasLegacySettings && (
              <IconButton
                title={t(locale, 'scripts.settings')}
                onClick={() => usePluginSettingsStore.getState().openSettingsDialog({ pluginId: plugin.pluginId, source: 'builtin' })}
              >
                <Settings size={13} />
              </IconButton>
            )}
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

  function isPluginBlocked(pluginId: string, source: PluginSettingsSource) {
    const definition = pluginRegistry.getPluginDefinition(pluginId, source)
    if (!definition?.background) return false
    const requested = pluginRegistry.getPluginPermissions(pluginId, source)
    if (requested.length === 0) return false
    const snapshot = getPluginPermissionSnapshot(source, pluginId, requested)
    return missingPluginPermissions(snapshot, requested).length > 0
  }

  function renderPluginPermissions(pluginId: string, source: PluginSettingsSource) {
    const requested = pluginRegistry.getPluginPermissions(pluginId, source)
    if (requested.length === 0) return null
    const snapshot = getPluginPermissionSnapshot(source, pluginId, requested)
    const missingPermissions = missingPluginPermissions(snapshot, requested)
    const permissionLabels = requested.map((permission) => describePluginPermission(permission, locale)).join(', ')
    const missingPermissionLabels = missingPermissions.map((permission) => describePluginPermission(permission, locale)).join(', ')
    return (
      <div className={`plugin-permissions mt-2 ${missingPermissions.length > 0 ? 'is-missing' : ''}`}>
        <div className="flex items-center gap-2 flex-wrap text-[11px]" style={{ color: 'var(--color-text-secondary)' }}>
          {missingPermissions.length > 0 ? (
            <>
              <span className="plugin-permissions-title">
                <AlertTriangle size={12} />
                {t(locale, 'scripts.permissionsBlockedTitle')}
              </span>
              <span className="plugin-permissions-detail">
                {t(locale, 'scripts.permissionsBlockedDetail', { count: missingPermissions.length })}
              </span>
              <span className="truncate max-w-[420px]" title={missingPermissionLabels}>
                {missingPermissionLabels}
              </span>
            </>
          ) : (
            <>
              <span className="script-badge">{t(locale, 'scripts.permissionsAllGranted')}</span>
              <span className="truncate max-w-[420px]" title={permissionLabels}>
                {permissionLabels}
              </span>
            </>
          )}
          {missingPermissions.length > 0 && (
            <button
              className="scripts-btn plugin-permissions-grant"
              onClick={() => {
                grantPluginPermissions(source, pluginId, missingPermissions)
                runPluginStartupHooks()
              }}
            >
              {t(locale, 'scripts.actionGrantPermissions')}
            </button>
          )}
        </div>
      </div>
    )
  }

  function renderSurfaceShortcuts(pluginId: string, source: PluginSettingsSource) {
    const definition = pluginRegistry.getPluginDefinition(pluginId, source)
    const surfaces = definition?.ui?.surfaces?.filter((surface) => surface.entry?.shortcutBindable !== false) ?? []
    if (surfaces.length === 0) return null

    return (
      <div className="plugin-surface-shortcuts">
        {surfaces.map((surface) => {
          const target = { source, pluginId, surfaceId: surface.id }
          const key = pluginSurfaceShortcutKey(target)
          const shortcut = pluginSurfaceShortcuts[key]
          const status = shortcut?.registrationStatus ?? (shortcut ? 'pending' : '')
          return (
            <div key={key} className="plugin-surface-shortcut-row">
              <div className="plugin-surface-shortcut-title">
                <Keyboard size={12} />
                <span>{localized(surface.title, surface.titleI18n, locale)}</span>
                <span className="script-badge">{source}:{surface.id}</span>
              </div>
              <div className="plugin-surface-shortcut-controls">
                <button className="scripts-btn" onClick={() => { void requestOpenPluginSurfaceTool(target) }}>
                  {t(locale, 'scripts.surfaceOpen')}
                </button>
                <ShortcutRecorder
                  value={shortcut ? { kind: 'accelerator', accelerator: shortcut.accelerator } : { kind: 'disabled' }}
                  emptyLabel={surface.entry?.recommendedShortcut ?? t(locale, 'scripts.surfaceShortcutPending')}
                  status={status ? <span className="script-badge">{surfaceShortcutStatusLabel(status, locale)}</span> : undefined}
                  clearLabel={t(locale, 'scripts.surfaceClearShortcut')}
                  onRecord={(recorded) => {
                    if (recorded.kind !== 'accelerator') return
                    const requested = pluginRegistry.getPluginPermissions(pluginId, source)
                    if (requested.includes('globalShortcut.register')) {
                      grantPluginPermissions(source, pluginId, ['globalShortcut.register'])
                    }
                    setPluginSurfaceShortcut(target, recorded.accelerator)
                  }}
                  onClear={shortcut ? () => clearPluginSurfaceShortcut(target) : undefined}
                />
              </div>
              {shortcut?.registrationError && (
                <div className="plugin-surface-shortcut-error">
                  <AlertTriangle size={12} /> {shortcut.registrationError}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }

  function renderPluginDetailActions(row: PluginDetailRow) {
    const settingsContribution = pluginRegistry.getPluginDefinition(row.pluginId, row.settingsSource)?.settings
    const hasLegacySettings = !!settingsContribution && !settingsContribution.schema

    if (row.kind === 'builtin') {
      const plugin = row.plugin as PluginPackageSummary
      return (
        <>
          {hasLegacySettings && (
            <IconButton
              title={t(locale, 'scripts.settings')}
              onClick={() => usePluginSettingsStore.getState().openSettingsDialog({ pluginId: plugin.pluginId, source: 'builtin' })}
            >
              <Settings size={13} />
            </IconButton>
          )}
          <IconButton
            title={t(locale, 'scripts.actionOpenEditor')}
            onClick={() => openPluginEditor({ pluginId: plugin.pluginId, folderPath: plugin.folderPath, source: 'builtin', readOnly: true })}
          >
            <FolderOpen size={13} />
          </IconButton>
          <span className="script-badge">{t(locale, 'scripts.readOnly')}</span>
        </>
      )
    }

    if (row.kind === 'installed') {
      const plugin = row.plugin as InstalledPlugin
      const key = plugin.pluginId
      return (
        <>
          {hasLegacySettings && (
            <IconButton
              title={t(locale, 'scripts.settings')}
              onClick={() => usePluginSettingsStore.getState().openSettingsDialog({ pluginId: plugin.pluginId, source: 'installed' })}
            >
              <Settings size={13} />
            </IconButton>
          )}
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
      )
    }

    const plugin = row.plugin as DevPlugin
    const key = `dev:${plugin.pluginId}`
    return (
      <>
        {hasLegacySettings && (
          <IconButton
            title={t(locale, 'scripts.settings')}
            onClick={() => usePluginSettingsStore.getState().openSettingsDialog({ pluginId: plugin.pluginId, source: 'dev' })}
          >
            <Settings size={13} />
          </IconButton>
        )}
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
    )
  }

  function renderPluginDetail(row: PluginDetailRow) {
    const settingsContribution = pluginRegistry.getPluginDefinition(row.pluginId, row.settingsSource)?.settings
    const hasSchemaSettings = !!settingsContribution?.schema
    const hasLegacySettings = !!settingsContribution && !settingsContribution.schema
    const permissions = pluginRegistry.getPluginPermissions(row.pluginId, row.settingsSource)
    const surfaces = pluginRegistry.getPluginDefinition(row.pluginId, row.settingsSource)?.ui?.surfaces ?? []
    const hasDetailBlocks = permissions.length > 0 || hasSchemaSettings || surfaces.length > 0
    const pluginDetailDescription = getPluginDetailDescription(row.pluginId, row.settingsSource, locale)

    return (
      <section className={`a-detail plugin-detail-panel ${row.error ? 'has-error' : ''}`}>
        <div className="d-head plugin-detail-header">
          <div className="d-ico plugin-detail-icon">
            {row.loading ? <Loader2 size={18} className="animate-spin" /> : <Package size={18} />}
          </div>
          <div className="d-htext plugin-detail-title-group">
            <div className="d-name plugin-detail-title-row">
              {row.title}
            </div>
            <div className="d-meta plugin-detail-subtitle">{row.source}://{row.pluginId} · v{row.version}</div>
          </div>
        </div>

        {pluginDetailDescription && (
          <p className="d-desc plugin-detail-description">
            {pluginDetailDescription}
          </p>
        )}

        <div className="plugin-detail-meta">
          {row.folderPath && <div className="plugin-detail-path truncate">{row.folderPath}</div>}
          {row.sourceUrl && <div className="plugin-detail-path truncate">{row.sourceUrl}</div>}
          {row.error && (
            <div className="plugin-detail-error">
              <AlertTriangle size={13} /> {row.error}
            </div>
          )}
        </div>

        <div className="plugin-detail-sections">
          {renderPluginPermissions(row.pluginId, row.settingsSource)}
          {hasSchemaSettings && (
            <div className="plugin-settings-inline-detail">
              <PluginSettingsInline pluginId={row.pluginId} source={row.settingsSource} locale={locale} />
            </div>
          )}
          {renderSurfaceShortcuts(row.pluginId, row.settingsSource)}
          {!hasDetailBlocks && (
            <div className="plugin-detail-empty-note">{t(locale, 'scripts.noDetails')}</div>
          )}
        </div>
        {row.capabilities.length > 0 && (
          <div className="d-caps plugin-detail-capabilities">
            {row.capabilities.map((capability) => (
              <span key={capability} className="d-cap script-badge">{capability}</span>
            ))}
          </div>
        )}
      </section>
    )
  }

  function renderPluginListRow(row: PluginDetailRow) {
    const selected = row.key === selectedPluginKey
    const shortcutHint = surfaceShortcutHintForPlugin(row.pluginId, row.settingsSource)
    return (
      <button
        key={row.key}
        type="button"
        className={`prow plugin-master-row ${selected ? 'sel is-selected' : ''} ${row.error ? 'has-error' : ''}`}
        onClick={() => setSelectedPluginKey(row.key)}
      >
        <span className="p-ico plugin-master-row-icon">
          {row.loading ? <Loader2 size={15} className="animate-spin" /> : <Package size={15} />}
        </span>
        <span className="p-name plugin-master-row-main">
          {row.title}
        </span>
        {shortcutHint && <span className="p-hint">{shortcutHint}</span>}
      </button>
    )
  }

  function getPluginDetailDescription(pluginId: string, source: PluginSettingsSource, currentLocale: Locale) {
    const definition = pluginRegistry.getPluginDefinition(pluginId, source)
    const schemaSection = definition?.settings?.schema?.sections.find((section) => section.description || section.descriptionI18n)
    if (schemaSection) return localized(schemaSection.description ?? '', schemaSection.descriptionI18n, currentLocale)
    const surface = definition?.ui?.surfaces?.[0]
    if (surface) return localized(surface.title, surface.titleI18n, currentLocale)
    const command = definition?.commands?.find((item) => item.description || item.descriptionI18n)
    if (command) return localized(command.description ?? '', command.descriptionI18n, currentLocale)
    return ''
  }

  function surfaceShortcutHintForPlugin(pluginId: string, source: PluginSettingsSource) {
    const definition = pluginRegistry.getPluginDefinition(pluginId, source)
    const surfaces = definition?.ui?.surfaces?.filter((surface) => surface.entry?.shortcutBindable !== false) ?? []
    for (const surface of surfaces) {
      const shortcut = pluginSurfaceShortcuts[pluginSurfaceShortcutKey({ source, pluginId, surfaceId: surface.id })]
      if (shortcut?.accelerator) return shortcut.accelerator
    }
    return ''
  }

  const selectedPluginRow = pluginDetailRows.find((row) => row.key === selectedPluginKey) ?? pluginDetailRows[0]
  const activeItems = activeTab === 'builtin' ? filteredBuiltin : activeTab === 'installed' ? filteredInstalled : filteredDev
  const totalCount = filteredBuiltin.length + filteredInstalled.length + filteredDev.length

  return (
    <div className="scripts-content body">
      <div className="phead">
        <span className="ptitle">{t(locale, 'scripts.title')}</span>
        <span className="pcount">{totalCount}</span>
      </div>

      <div className="ptools">
        <div className="psearch scripts-search-bar">
          <Search size={14} />
          <input
            className="scripts-search-input"
            type="text"
            placeholder={t(locale, 'scripts.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <div className="menu-wrap">
          <button
            data-testid="plugin-new-button"
            type="button"
            onClick={(event) => {
              event.stopPropagation()
              setAddMenuOpen((value) => !value)
            }}
            className="btn primary split"
          >
            <span className="bi">＋</span>{locale === 'zh' ? '添加插件' : 'Add Plugin'}<span className="chev">▾</span>
          </button>
          {addMenuOpen && (
            <div className="menu open" onClick={(event) => event.stopPropagation()}>
              <div className="m-label">{locale === 'zh' ? '从来源安装' : 'Install from'}</div>
              <button className="m-item" type="button" onClick={() => { setAddMenuOpen(false); setRemoteOpen(true) }}>
                <span className="m-ico">⎋</span><span className="m-main"><span className="m-name">{t(locale, 'scripts.importGithub')}</span><span className="m-desc">GitHub URL</span></span>
              </button>
              <button className="m-item" type="button" onClick={() => { setAddMenuOpen(false); void handleInstallZip() }}>
                <span className="m-ico">⊟</span><span className="m-main"><span className="m-name">{t(locale, 'scripts.importZip')}</span><span className="m-desc">.zip</span></span>
              </button>
              <button className="m-item" type="button" onClick={() => { setAddMenuOpen(false); void handleInstallDirectory() }}>
                <span className="m-ico">▢</span><span className="m-main"><span className="m-name">{t(locale, 'scripts.importFolder')}</span><span className="m-desc">{locale === 'zh' ? '选择已解压的插件目录' : 'Choose an unpacked directory'}</span></span>
              </button>
            </div>
          )}
        </div>
      </div>

      <div className="ptabs scripts-tabs">
        <button className={`ptab scripts-tab ${activeTab === 'builtin' ? 'on active' : ''}`} onClick={() => setActiveTab('builtin')}>
          {t(locale, 'scripts.tabBuiltin')}
          <span className="pt-n scripts-tab-count">{builtinPlugins.length}</span>
        </button>
        <button className={`ptab scripts-tab ${activeTab === 'installed' ? 'on active' : ''}`} onClick={() => setActiveTab('installed')}>
          {t(locale, 'scripts.tabInstalled')}
          <span className="pt-n scripts-tab-count">{installedList.length}</span>
        </button>
        <button className={`ptab scripts-tab ${activeTab === 'dev' ? 'on active' : ''}`} onClick={() => setActiveTab('dev')}>
          {t(locale, 'scripts.tabDev')}
          <span className="pt-n scripts-tab-count">{devList.length}</span>
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
          <div className="splitwrap plugin-master-detail">
            <div className="a-list plugin-master-list" role="listbox" aria-label={t(locale, 'scripts.title')}>
              {pluginDetailRows.map(renderPluginListRow)}
            </div>
            {selectedPluginRow && renderPluginDetail(selectedPluginRow)}
          </div>
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
  details,
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
  details?: ReactNode
  actions: ReactNode
}) {
  return (
    <div className={`card script-card anim-card-in ${error ? 'has-error' : ''}`} style={{ borderColor: error ? 'var(--color-error)' : undefined }}>
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
        {details}
      </div>
      {actions}
    </div>
  )
}
