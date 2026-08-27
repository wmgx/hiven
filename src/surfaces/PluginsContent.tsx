import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  AlertTriangle,
  Binary,
  Braces,
  Calculator,
  Calendar,
  Clipboard,
  Code2,
  Dices,
  FileCode2,
  FileDiff,
  Globe,
  Languages,
  List,
  Loader2,
  Lock,
  MoreHorizontal,
  Package,
  Regex,
  Search,
  Settings,
  Table2,
  Type,
  X,
  AlignLeft,
  CaseSensitive,
} from 'lucide-react'
import { Dialog } from '@base-ui/react/dialog'
import { t } from '../i18n'
import type { Locale } from '../i18n'
import { localized, useAppStore } from '../store'
import { getConfigDir } from '../configInit'
import { listBundledPluginPackageSummaries } from '../workspace/bundledPluginLoader'
import { finishImeComposition, shouldIgnoreImeKeyDown, startImeComposition } from '../utils/imeKeyboard'
import { LauncherEmptyWell } from '../components/launcher/LauncherEmptyWell'
import { usePluginStore } from '../workspace/pluginStore'
import { usePluginSettingsStore } from '../workspace/pluginSettingsStore'
import { pluginRegistry, usePluginRegistryVersion } from '../workspace/pluginRegistry'
import type { PluginSettingsSource } from '../workspace/pluginSettingsStore'
import {
  describePluginPermission,
  getPluginPermissionSnapshot,
  missingPluginPermissions,
  usePluginPermissionStore,
} from '../workspace/pluginPermissions'
import { requestOpenPluginSurfaceTool } from '../workspace/pluginSurfaceOpenRequest'
import { pluginSurfaceShortcutKey, usePluginSurfaceShortcutStore } from '../workspace/pluginSurfaceShortcuts'
import { ShortcutRecorder } from '../components/ShortcutRecorder'
import { Menu, Switch, TextInput } from '../plugin-ui'
import type { PluginPermission } from '../workspace/pluginTypes'
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

type PluginKind = 'builtin' | 'installed' | 'dev'
type BusyMap = Record<string, boolean>
type ErrorMap = Record<string, string>
type PluginDetailRow = {
  key: string
  kind: PluginKind
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

/** Brand blue + cool gray palette — no purple/pink (V3). */
const ICON_BG_PALETTE = [
  { bg: '#eff6ff', fg: '#1d4ed8' },
  { bg: '#e0f2fe', fg: '#0369a1' },
  { bg: '#f1f5f9', fg: '#475569' },
  { bg: '#ecfeff', fg: '#0e7490' },
  { bg: '#f8fafc', fg: '#334155' },
  { bg: '#dbeafe', fg: '#1e40af' },
]

const PLUGIN_ICON_MAP: Record<string, LucideIcon> = {
  translate: Languages,
  'clipboard-history': Clipboard,
  'web-open': Globe,
  'json-tools': Braces,
  'text-diff': FileDiff,
  calculator: Calculator,
  crypto: Lock,
  csv: Table2,
  'date-time-assistant': Calendar,
  'encode-decode': Binary,
  formatter: AlignLeft,
  'js-filter': Code2,
  'line-tools': List,
  'regex-tester': Regex,
  'text-utils': Type,
  yaml: FileCode2,
  random: Dices,
  'variable-case': CaseSensitive,
}

function pluginIconTone(pluginId: string) {
  const hash = pluginId.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0) % ICON_BG_PALETTE.length
  return ICON_BG_PALETTE[hash]
}

function pluginIconText(title: string): string {
  const firstChar = title.charAt(0)
  if (!firstChar) return '?'
  if (/[\u4e00-\u9fff]/.test(firstChar)) return firstChar
  return firstChar.toUpperCase()
}

function PluginRowIcon({ pluginId, title, loading }: { pluginId: string; title: string; loading?: boolean }) {
  const tone = pluginIconTone(pluginId)
  const Icon = PLUGIN_ICON_MAP[pluginId]
  return (
    <div className="plugins-row-icon" style={{ backgroundColor: tone.bg, color: tone.fg }}>
      {loading
        ? <Loader2 size={17} className="animate-spin" />
        : Icon
          ? <Icon size={17} strokeWidth={2} />
          : <span className="plugins-row-icon-char">{pluginIconText(title)}</span>}
    </div>
  )
}

function isTauri() {
  return !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
}

function openPluginsSurfaceSettings(pluginId: string, source: PluginSettingsSource) {
  usePluginSettingsStore.getState().openSettingsDialog({
    pluginId,
    source,
    presentation: 'dialog' as const,
    context: { surfaceId: 'global-launcher' as const },
  })
}

function sourceLabel(plugin: InstalledPlugin | DevPlugin, locale: 'zh' | 'en') {
  const source = plugin.source ?? 'local'
  if (source === 'github') return t(locale, 'scripts.source.github')
  if (source === 'zip') return t(locale, 'scripts.source.zip')
  if (source === 'builtin') return t(locale, 'scripts.source.builtin')
  return t(locale, 'scripts.source.local')
}

function kindTag(kind: PluginKind, locale: Locale): string {
  if (kind === 'builtin') return t(locale, 'scripts.kindTagBuiltin')
  if (kind === 'dev') return t(locale, 'scripts.kindTagDev')
  return t(locale, 'scripts.kindTagInstalled')
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

function formatPluginShortcutLabel(accelerator: string) {
  return accelerator
    .replace(/\bCmdOrCtrl\b/g, '⌘')
    .replace(/\bCommandOrControl\b/g, '⌘')
    .replace(/\bCommand\b/g, '⌘')
    .replace(/\bCmd\b/g, '⌘')
    .replace(/\bCtrl\b/g, 'Ctrl')
    .replace(/\bShift\b/g, '⇧')
    .replace(/\bAlt\b/g, '⌥')
    .replace(/\bOption\b/g, '⌥')
    .replace(/\+/g, '')
}

function pluginDetailStatusKey(row: PluginDetailRow) {
  if (row.status.includes('禁用') || row.status.toLowerCase().includes('disabled')) return 'is-disabled'
  if (row.status.includes('阻塞') || row.status.toLowerCase().includes('blocked')) return 'is-blocked'
  if (row.status.includes('错误') || row.status.toLowerCase().includes('error')) return 'is-error'
  return 'is-loaded'
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

export type PluginsContentProps = {
  }

export function PluginsContent({}: PluginsContentProps) {
  const locale = useAppStore((s) => s.locale)
  const pluginRegistryVersion = usePluginRegistryVersion()
  const pluginSurfaceShortcuts = usePluginSurfaceShortcutStore((s) => s.shortcuts)
  const pluginPermissionVersion = usePluginPermissionStore((s) => s.version)
  const plugins = usePluginStore((s) => s.plugins)
  const devPlugins = usePluginStore((s) => s.devPlugins)
  const [query, setQuery] = useState('')
  const [builtinPlugins, setBuiltinPlugins] = useState<PluginPackageSummary[]>([])
  const [installedPackages, setInstalledPackages] = useState<PluginPackageSummary[]>([])
  const [busy, setBusy] = useState<BusyMap>({})
  const [errors, setErrors] = useState<ErrorMap>({})
  const [listError, setListError] = useState('')
  const [remoteUrl, setRemoteUrl] = useState('')
  const [remoteOpen, setRemoteOpen] = useState(false)
  // Value itself is inert — only used to retrigger the [updateStatus] refetch effect
  // below after an uninstall completes.
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'done'>('idle')
  const [pendingDangerKey, setPendingDangerKey] = useState<string | null>(null)
  const [expandedKey, setExpandedKey] = useState<string | null>(null)
  const [recordingSurfaceKey, setRecordingSurfaceKey] = useState<string | null>(null)
  const grantPermissions = usePluginPermissionStore((s) => s.grantPermissions)
  const setSurfaceShortcut = usePluginSurfaceShortcutStore((s) => s.setShortcut)
  const clearSurfaceShortcut = usePluginSurfaceShortcutStore((s) => s.clearShortcut)
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
      if (!isTauri()) {
        setBuiltinPlugins(listBundledPluginPackageSummaries())
        setInstalledPackages([])
        return
      }
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

  // Build a single flat list: builtin → installed → dev
  const pluginDetailRows = useMemo<PluginDetailRow[]>(() => {
    void pluginPermissionVersion
    void pluginRegistryVersion

    const filteredBuiltin = normalizedQuery
      ? builtinPlugins.filter((p) => pluginMatchesQuery(p, normalizedQuery, locale))
      : builtinPlugins
    const filteredInstalled = normalizedQuery
      ? installedList.filter((p) => pluginMatchesQuery(p, normalizedQuery, locale))
      : installedList
    const filteredDev = normalizedQuery
      ? devList.filter((p) => pluginMatchesQuery(p, normalizedQuery, locale))
      : devList

    const builtinRows: PluginDetailRow[] = filteredBuiltin.map((plugin) => ({
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

    const installedRows: PluginDetailRow[] = filteredInstalled.map((plugin) => ({
      key: plugin.pluginId,
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
      error: plugin.error || errors[plugin.pluginId] || plugin.update?.error,
      loading: !!busy[plugin.pluginId],
      settingsSource: 'installed',
      plugin,
    }))

    const devRows: PluginDetailRow[] = filteredDev.map((plugin) => {
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

    return [...builtinRows, ...installedRows, ...devRows]
  }, [builtinPlugins, busy, devList, errors, installedList, locale, normalizedQuery, pluginPermissionVersion, pluginRegistryVersion])

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
      const raw = error instanceof Error ? error.message : String(error)
      const single = raw.replace(/\s+/g, ' ').trim()
      setItemError(key, single.length > 160 ? `${single.slice(0, 159)}…` : single)
    } finally {
      setItemBusy(key, false)
    }
  }

  async function handleInstallDirectory() {
    const folder = await pickLocalPluginFolder()
    if (!folder) return
    await runTask('_install-folder', async () => {
      await importLocalPluginDirectory(folder)
    })
  }

  async function handleInstallZip() {
    const zipPath = await pickPluginZipFile()
    if (!zipPath) return
    await runTask('_install-zip', async () => {
      await importPluginZip(zipPath)
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
    })
  }

  function handleCompositionStart() {
    startImeComposition(isImeComposingRef)
  }

  function handleCompositionEnd() {
    finishImeComposition(isImeComposingRef)
  }

  function getRequestedPermissions(pluginId: string, source: PluginSettingsSource): PluginPermission[] {
    return pluginRegistry.getPluginPermissions(pluginId, source)
  }

  function getMissingPermissions(pluginId: string, source: PluginSettingsSource): PluginPermission[] {
    const requested = getRequestedPermissions(pluginId, source)
    if (requested.length === 0) return []
    const snapshot = getPluginPermissionSnapshot(source, pluginId, requested)
    return missingPluginPermissions(snapshot, requested)
  }

  function getGrantedPermissionCount(pluginId: string, source: PluginSettingsSource) {
    const requested = getRequestedPermissions(pluginId, source)
    if (requested.length === 0) return 0
    return requested.length - getMissingPermissions(pluginId, source).length
  }

  function isPluginBlocked(pluginId: string, source: PluginSettingsSource) {
    const definition = pluginRegistry.getPluginDefinition(pluginId, source)
    if (!definition?.background) return false
    return getMissingPermissions(pluginId, source).length > 0
  }

  function isPluginEnabled(row: PluginDetailRow): boolean {
    if (row.kind === 'builtin') return true
    if (row.kind === 'installed') return (row.plugin as InstalledPlugin).status === 'enabled'
    if (row.kind === 'dev') return (row.plugin as DevPlugin).status === 'active'
    return false
  }

  /** Gear opens settings for schema-driven or custom-component settings bodies. */
  function hasPluginSettings(row: PluginDetailRow): boolean {
    const settingsContribution = pluginRegistry.getPluginDefinition(row.pluginId, row.settingsSource)?.settings
    if (!settingsContribution) return false
    return Boolean(settingsContribution.schema || settingsContribution.component)
  }

  function primarySurfaceForPlugin(pluginId: string, source: PluginSettingsSource) {
    const definition = pluginRegistry.getPluginDefinition(pluginId, source)
    const surfaces = definition?.ui?.surfaces ?? []
    return surfaces.find((surface) => surface.entry?.launcher !== false) ?? surfaces[0]
  }

  function shortcutBindableSurfaces(pluginId: string, source: PluginSettingsSource) {
    const definition = pluginRegistry.getPluginDefinition(pluginId, source)
    return definition?.ui?.surfaces?.filter((surface) => surface.entry?.shortcutBindable === true) ?? []
  }

  function surfaceShortcutHintForPlugin(pluginId: string, source: PluginSettingsSource) {
    const surfaces = shortcutBindableSurfaces(pluginId, source)
    for (const surface of surfaces) {
      const shortcut = pluginSurfaceShortcuts[pluginSurfaceShortcutKey({ source, pluginId, surfaceId: surface.id })]
      if (shortcut?.accelerator) return formatPluginShortcutLabel(shortcut.accelerator)
    }
    return ''
  }

  function getPluginDetailDescription(pluginId: string, source: PluginSettingsSource, currentLocale: Locale) {
    const definition = pluginRegistry.getPluginDefinition(pluginId, source)
    const schemaSection = definition?.settings?.schema?.sections.find((section) => section.description || section.descriptionI18n)
    if (schemaSection) return localized(schemaSection.description ?? '', schemaSection.descriptionI18n, currentLocale)
    // Custom settings body (e.g. browser-tabs install guide) — use settings title as blurb.
    if (definition?.settings?.component && (definition.settings.title || definition.settings.titleI18n)) {
      return localized(definition.settings.title ?? '', definition.settings.titleI18n, currentLocale)
    }
    const surface = definition?.ui?.surfaces?.[0]
    if (surface) return localized(surface.title, surface.titleI18n, currentLocale)
    const command = definition?.commands?.find((item) => item.description || item.descriptionI18n)
    if (command) return localized(command.description ?? '', command.descriptionI18n, currentLocale)
    return ''
  }

  function handleToggleEnabled(row: PluginDetailRow) {
    if (row.kind === 'builtin') return
    const key = row.kind === 'dev' ? `dev:${row.pluginId}` : row.pluginId
    if (isPluginEnabled(row)) {
      disablePlugin(row.pluginId)
    } else {
      void runTask(key, () => enablePlugin(row.pluginId))
    }
  }

  // --- Dropdown menu actions ---
  function getDropdownMenuItems(row: PluginDetailRow) {
    const key = row.kind === 'dev' ? `dev:${row.pluginId}` : row.pluginId
    const items: {
      label: string
      danger?: boolean
      /** Two-step confirm id; second click executes action */
      confirmKey?: string
      confirmLabel?: string
      action: () => void
    }[] = []

    if (row.kind === 'builtin') {
      // builtin has no menu items (open panel/editor removed)
      return items
    }

    if (row.kind === 'installed') {
      const plugin = row.plugin as InstalledPlugin
      items.push({
        label: isPluginEnabled(row) ? t(locale, 'scripts.actionDisable') : t(locale, 'scripts.actionEnable'),
        action: () => {
          if (isPluginEnabled(row)) disablePlugin(plugin.pluginId)
          else void runTask(key, () => enablePlugin(plugin.pluginId))
        },
      })
      items.push({
        label: t(locale, 'scripts.actionReload'),
        action: () => void runTask(key, () => reloadPlugin(plugin.pluginId)),
      })
      if (plugin.source === 'github') {
        items.push({
          label: t(locale, 'scripts.actionCheckPluginUpdate'),
          action: () => void runTask(`${key}:check-update`, () => checkInstalledPluginUpdate(plugin.pluginId).then(() => undefined)),
        })
      }
      if (plugin.source === 'github' && plugin.update?.status === 'available') {
        items.push({
          label: t(locale, 'scripts.actionUpdatePlugin').replace('{version}', plugin.update.latestVersion || ''),
          action: () => void runTask(`${key}:update`, () => updateInstalledPlugin(plugin.pluginId).then(() => undefined)),
        })
      }
      items.push({
        label: t(locale, 'scripts.actionUninstall'),
        danger: true,
        confirmKey: `${key}:uninstall`,
        confirmLabel: t(locale, 'scripts.actionUninstallConfirm'),
        action: () => void runTask(key, async () => {
          await uninstallPlugin(plugin.pluginId)
          setUpdateStatus('done')
        }),
      })
      return items
    }

    // dev
    const plugin = row.plugin as DevPlugin
    items.push({
      label: t(locale, 'scripts.actionOpenExternal'),
      action: () => void runTask(key, () => openPluginDir(plugin.folderPath)),
    })
    items.push({
      label: plugin.watching ? t(locale, 'scripts.actionStopWatching') : t(locale, 'scripts.actionWatchDev'),
      action: () => {
        if (plugin.watching) unwatchDevPlugin(plugin.pluginId)
        else void runTask(key, () => watchDevPlugin(plugin.pluginId))
      },
    })
    items.push({
      label: t(locale, 'scripts.actionReloadDev'),
      action: () => void runTask(key, () => reloadDevPlugin(plugin.pluginId)),
    })
    items.push({
      label: t(locale, 'scripts.actionRemoveDev'),
      danger: true,
      confirmKey: `${key}:remove-dev`,
      confirmLabel: t(locale, 'scripts.actionRemoveDevConfirm'),
      action: () => removeDevPlugin(plugin.pluginId),
    })
    return items
  }

  function rowMenuItems(row: PluginDetailRow) {
    return getDropdownMenuItems(row).map((item, index) => {
      const isPending = Boolean(item.confirmKey && pendingDangerKey === item.confirmKey)
      return {
        key: `${row.key}-${index}`,
        label: isPending ? (item.confirmLabel ?? item.label) : item.label,
        danger: item.danger,
        closeOnClick: !item.confirmKey || isPending,
        onSelect: () => {
          if (item.confirmKey) {
            if (pendingDangerKey === item.confirmKey) {
              setPendingDangerKey(null)
              item.action()
            } else {
              setPendingDangerKey(item.confirmKey)
            }
            return
          }
          setPendingDangerKey(null)
          item.action()
        },
      }
    })
  }

  function renderDrawer(row: PluginDetailRow) {
    const missing = getMissingPermissions(row.pluginId, row.settingsSource)
    const requested = getRequestedPermissions(row.pluginId, row.settingsSource)
    const grantedCount = getGrantedPermissionCount(row.pluginId, row.settingsSource)
    const surfaces = shortcutBindableSurfaces(row.pluginId, row.settingsSource)
    const primarySurface = primarySurfaceForPlugin(row.pluginId, row.settingsSource)
    const statusKey = pluginDetailStatusKey(row)

    return (
      <div className="plugins-drawer" onClick={(event) => event.stopPropagation()}>
        <div className="plugins-drawer-line">
          <div className="plugins-drawer-label">{t(locale, 'scripts.drawerPermissions')}</div>
          <div className="plugins-drawer-value">
            {requested.length === 0 ? (
              <span>{t(locale, 'scripts.permissionsNone')}</span>
            ) : (
              <>
                {missing.map((permission) => (
                  <span key={permission} className="plugins-drawer-shortcut-group">
                    <span className="plugins-drawer-perm-label">{describePluginPermission(permission, locale)}</span>
                    <button
                      type="button"
                      className="plugins-drawer-link"
                      onClick={() => grantPermissions(row.settingsSource, row.pluginId, [permission])}
                    >
                      {t(locale, 'scripts.permissionsGrant')}
                    </button>
                  </span>
                ))}
                {missing.length > 1 && (
                  <button
                    type="button"
                    className="plugins-drawer-link"
                    onClick={() => grantPermissions(row.settingsSource, row.pluginId, missing)}
                  >
                    {t(locale, 'scripts.permissionsGrantAll')}
                  </button>
                )}
                {missing.length === 0 ? (
                  <span>{t(locale, 'scripts.permissionsAllGranted')}</span>
                ) : grantedCount > 0 ? (
                  <span>
                    {t(locale, 'scripts.permissionsGrantedCount').replace('{count}', String(grantedCount))}
                  </span>
                ) : null}
              </>
            )}
          </div>
        </div>

        <div className="plugins-drawer-line">
          <div className="plugins-drawer-label">{t(locale, 'scripts.surfaceShortcutTitle')}</div>
          <div className="plugins-drawer-value">
            {surfaces.length === 0 ? (
              <span>—</span>
            ) : (
              surfaces.map((surface) => {
                const target = { source: row.settingsSource, pluginId: row.pluginId, surfaceId: surface.id }
                const surfaceKey = pluginSurfaceShortcutKey(target)
                const shortcut = pluginSurfaceShortcuts[surfaceKey]
                const title = localized(surface.title, surface.titleI18n, locale)
                const isRecording = recordingSurfaceKey === surfaceKey
                return (
                  <div key={surface.id} className="plugins-drawer-shortcut-group">
                    <span>{title}</span>
                    {shortcut?.accelerator && (
                      <kbd className="plugins-shortcut-badge">{formatPluginShortcutLabel(shortcut.accelerator)}</kbd>
                    )}
                    {isRecording ? (
                      <div className="plugins-drawer-shortcut-record">
                        <ShortcutRecorder
                          value={shortcut?.accelerator
                            ? { kind: 'accelerator', accelerator: shortcut.accelerator }
                            : { kind: 'disabled' }}
                          emptyLabel={t(locale, 'scripts.surfaceBindShortcut')}
                          onRecord={(value) => {
                            if (value.kind === 'accelerator') {
                              setSurfaceShortcut(target, value.accelerator)
                            }
                            setRecordingSurfaceKey(null)
                          }}
                          onClear={() => {
                            clearSurfaceShortcut(target)
                            setRecordingSurfaceKey(null)
                          }}
                        />
                      </div>
                    ) : (
                      <button
                        type="button"
                        className="plugins-drawer-link"
                        onClick={() => setRecordingSurfaceKey(surfaceKey)}
                      >
                        {shortcut?.accelerator
                          ? t(locale, 'scripts.surfaceRerecordShortcut')
                          : t(locale, 'scripts.surfaceBindShortcut')}
                      </button>
                    )}
                    {primarySurface?.id === surface.id && (
                      <button
                        type="button"
                        className="plugins-drawer-link"
                        onClick={() => void requestOpenPluginSurfaceTool(target)}
                      >
                        {t(locale, 'scripts.surfaceOpen')}
                      </button>
                    )}
                  </div>
                )
              })
            )}
          </div>
        </div>

        <div className="plugins-drawer-line">
          <div className="plugins-drawer-label">{t(locale, 'scripts.drawerAbout')}</div>
          <div className="plugins-drawer-value">
            {row.error ? (
              <span className="plugins-drawer-error">{row.error}</span>
            ) : (
              <>
                <span className={`plugins-drawer-status-dot ${statusKey}`} />
                <span>{row.status}</span>
                <span className="plugins-drawer-version">v{row.version}</span>
                <span>·</span>
                <span>{kindTag(row.kind, locale)}</span>
                {row.folderPath && (
                  <span className="plugins-drawer-path" title={row.folderPath}>{row.folderPath}</span>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  // --- Render a single list row ---
  function renderRow(row: PluginDetailRow) {
    const shortcutHint = surfaceShortcutHintForPlugin(row.pluginId, row.settingsSource)
    const showToggle = row.kind !== 'builtin'
    const showGear = hasPluginSettings(row)
    const menuItems = getDropdownMenuItems(row)
    const showMenu = menuItems.length > 0
    const description = getPluginDetailDescription(row.pluginId, row.settingsSource, locale)
    const missingCount = getMissingPermissions(row.pluginId, row.settingsSource).length
    const isExpanded = expandedKey === row.key

    return (
      <div
        key={row.key}
        className={`plugins-row-wrapper ${isExpanded ? 'is-expanded' : ''} ${row.error ? 'plugins-row-wrapper--error' : ''}`}
      >
        <div
          className="plugins-row"
          role="button"
          tabIndex={0}
          aria-expanded={isExpanded}
          onClick={() => setExpandedKey((prev) => (prev === row.key ? null : row.key))}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              setExpandedKey((prev) => (prev === row.key ? null : row.key))
            }
          }}
        >
          <PluginRowIcon pluginId={row.pluginId} title={row.title} loading={row.loading} />

          <div className="plugins-row-text">
            <div className="plugins-row-title-line">
              <span className="plugins-row-name">{row.title}</span>
              <span className={`plugins-row-kind-tag plugins-row-kind-tag--${row.kind}`}>{kindTag(row.kind, locale)}</span>
            </div>
            {description && <div className="plugins-row-desc">{description}</div>}
          </div>

          <div className="plugins-row-controls" onClick={(event) => event.stopPropagation()}>
            {missingCount > 0 && (
              <span className="plugins-warn-pill">
                {t(locale, 'scripts.permissionsPendingCount').replace('{count}', String(missingCount))}
              </span>
            )}
            {shortcutHint && <kbd className="plugins-shortcut-badge">{shortcutHint}</kbd>}
            {showToggle && (
              <Switch
                className="is-compact"
                checked={isPluginEnabled(row)}
                aria-label={isPluginEnabled(row) ? t(locale, 'scripts.actionDisable') : t(locale, 'scripts.actionEnable')}
                onCheckedChange={(checked) => {
                  if (checked !== isPluginEnabled(row)) handleToggleEnabled(row)
                }}
              />
            )}
            {showGear && (
              <button
                type="button"
                className="plugins-icon-btn"
                title={t(locale, 'scripts.settings')}
                onClick={() => openPluginsSurfaceSettings(row.pluginId, row.settingsSource)}
              >
                <Settings size={14} />
              </button>
            )}
            {showMenu && (
              <Menu
                align="end"
                onOpenChange={(open) => { if (!open) setPendingDangerKey(null) }}
                trigger={
                  <button type="button" className="plugins-icon-btn" title={t(locale, 'scripts.moreActions')}>
                    <MoreHorizontal size={14} />
                  </button>
                }
                items={rowMenuItems(row)}
              />
            )}
          </div>
        </div>
        {isExpanded && renderDrawer(row)}
      </div>
    )
  }

  return (
    <div className="plugins-content-inner">
      {/* Toolbar: search + add button */}
      <div className="plugins-toolbar">
        <div className="plugins-search">
          <Search size={14} />
          <input
            className="plugins-search-input"
            type="text"
            placeholder={t(locale, 'scripts.searchPlaceholder')}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Menu
          align="end"
          header={t(locale, 'scripts.installFrom')}
          trigger={
            <button data-testid="plugin-new-button" type="button" className="btn primary split">
              <span className="bi">＋</span>{t(locale, 'scripts.addPlugin')}<span className="chev">▾</span>
            </button>
          }
          items={[
            {
              key: 'github',
              label: t(locale, 'scripts.importGithub'),
              description: t(locale, 'scripts.importGithubDesc'),
              onSelect: () => setRemoteOpen(true),
            },
            {
              key: 'zip',
              label: t(locale, 'scripts.importZip'),
              description: '.zip',
              onSelect: () => { void handleInstallZip() },
            },
            {
              key: 'folder',
              label: t(locale, 'scripts.importFolder'),
              description: t(locale, 'scripts.importFolderDesc'),
              onSelect: () => { void handleInstallDirectory() },
            },
          ]}
        />
      </div>

      {/* Errors */}
      {listError && (
        <div className="plugins-error-banner">
          <AlertTriangle size={12} /> {listError}
        </div>
      )}

      {/* Plugin list */}
      <div className="plugins-list">
        {pluginDetailRows.length === 0 ? (
          <LauncherEmptyWell
            className="plugins-empty"
            testId="plugins-empty-well"
            icon={<Package size={28} strokeWidth={1.5} />}
            title={normalizedQuery ? t(locale, 'scripts.noResults') : t(locale, 'scripts.emptyPlugins')}
            hint={normalizedQuery ? t(locale, 'scripts.emptySearchHint') : undefined}
          />
        ) : (
          pluginDetailRows.map(renderRow)
        )}
      </div>

      {/* Global install errors */}
      {(errors['_install-folder'] || errors['_install-zip'] || errors['_dev-folder'] || errors['_new-plugin']) && (
        <div className="plugins-error-banner">
          <AlertTriangle size={12} />
          {errors['_install-folder'] || errors['_install-zip'] || errors['_dev-folder'] || errors['_new-plugin']}
        </div>
      )}

      {/* Remote import modal */}
      <Dialog.Root open={remoteOpen} onOpenChange={(open) => { if (!open && !busy['_remote']) setRemoteOpen(false) }}>
        <Dialog.Portal>
          <Dialog.Backdrop className="fixed inset-0 bg-black/40 z-[1200]" />
          <Dialog.Popup
            aria-labelledby="plugins-remote-import-title"
            initialFocus={() => document.querySelector<HTMLElement>('[data-remote-import-url]')}
            className="fixed left-1/2 top-1/2 z-[1201] w-[min(480px,calc(100vw-40px))] -translate-x-1/2 -translate-y-1/2 flex flex-col overflow-hidden anim-dropdown"
            style={{
              background: 'var(--panel, var(--bg-surface, #ffffff))',
              border: '1px solid var(--border, var(--color-border-secondary))',
              borderRadius: '14px',
              boxShadow: 'var(--shadow-panel, 0 20px 50px -12px rgba(18, 22, 28, 0.22), 0 0 0 1px rgba(18, 22, 28, 0.06))',
              outline: 'none',
            }}
          >
            <div
              className="flex items-center justify-between px-5 py-3.5"
              style={{ borderBottom: 'var(--hairline) solid var(--color-border-tertiary)' }}
            >
              <div
                id="plugins-remote-import-title"
                className="flex items-center gap-2 text-[14px] font-semibold"
                style={{ color: 'var(--color-text-primary)' }}
              >
                <Globe size={16} style={{ color: 'var(--color-accent)' }} />
                {t(locale, 'scripts.remoteImportDirectoryTitle')}
              </div>
              <button
                type="button"
                className="flex h-7 w-7 items-center justify-center rounded-md"
                style={{ color: 'var(--color-text-tertiary)', background: 'transparent' }}
                onClick={() => setRemoteOpen(false)}
                aria-label={t(locale, 'scripts.settingsClose')}
              >
                <X size={16} />
              </button>
            </div>
            <div className="px-5 py-4">
              <div className="mb-4 text-[12px] leading-relaxed" style={{ color: 'var(--color-text-secondary)' }}>
                {t(locale, 'scripts.remoteImportDirectoryDesc')}
              </div>
              <div className="flex gap-2">
                <TextInput
                  data-remote-import-url
                  style={{ fontFamily: 'var(--font-mono)' }}
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
                  placeholder={t(locale, 'scripts.remoteImportPlaceholder')}
                  disabled={busy['_remote']}
                />
                <button onClick={handleRemoteInstall} disabled={busy['_remote'] || !remoteUrl.trim()} className="scripts-btn scripts-btn-primary">
                  {busy['_remote'] ? <Loader2 size={12} className="animate-spin" /> : t(locale, 'scripts.confirm')}
                </button>
              </div>
              {errors['_remote'] && (
                <div className="plugins-error-banner">
                  <AlertTriangle size={12} /> {errors['_remote']}
                </div>
              )}
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </div>
  )
}
