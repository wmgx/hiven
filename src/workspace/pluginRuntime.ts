/**
 * hiven Plugin System - Plugin Runtime
 * Handles loading, installing, enabling, disabling, and side-loading plugins.
 *
 * Spike validations this module assumes:
 *   1. Tauri asset protocol + convertFileSrc can load local ESM (verified in spike)
 *   2. Plugin bundles externalize React/ReactDOM (host provides them via window)
 *   3. Dynamic import with cache-busting timestamp works for dev reload
 *
 * Loading strategy:
 *   - Production plugins: manifest.json + fixed index.* entry loaded from installed folder
 *   - Dev plugins: same, but registered to dev registry only, session-scoped
 *   - Cache busting: append ?t=<timestamp> to entry URL on every reload
 */

import { cleanupEditorPluginContributions } from './editorBridge'
import { pluginRegistry } from './pluginRegistry'
import { usePluginStore } from './pluginStore'
import { showToast } from './toast'
import { createPluginScaffoldFiles } from './pluginScaffold.ts'
import { parsePluginDefinitionSource } from './pluginDebugRunner.ts'
import { createPluginHostSdk, type PluginHostSdk } from '../pluginHostSdk.ts'
import { registerPluginMessages, unregisterPluginMessages, localizeContributions, type PluginMessages } from '../i18n/pluginI18nRegistry.ts'
import { stopPluginBackground } from './pluginBackgroundManager.ts'
import { clearPluginPrivateStorage } from './pluginStorage.ts'
import { usePluginPermissionStore } from './pluginPermissions.ts'
import { usePluginSettingsStore, type PluginSettingsSource } from './pluginSettingsStore.ts'
import { usePluginSurfaceShortcutStore } from './pluginSurfaceShortcuts.ts'
import type {
  PluginDefinition,
  PluginManifest,
  InstalledPlugin,
  DevPlugin,
  PluginFileTree,
  PluginPackageSource,
} from './pluginTypes'

declare global {
  interface Window {
    HivenPlugin?: PluginHostSdk
    FluxTextPlugin?: PluginHostSdk
  }
}

export type PluginPackageSummary = {
  pluginId: string
  displayName: string
  displayNameI18n?: PluginManifest['displayNameI18n']
  version: string
  entry: string
  capabilities: string[]
  permissions: PluginManifest['permissions']
  folderPath: string
  error?: string
}

type ResolvedPluginManifest = {
  pluginId: string
  displayName: string
  displayNameI18n?: PluginManifest['displayNameI18n']
  version: string
  entry: string
  capabilities: string[]
  permissions: PluginManifest['permissions']
}

const REMOTE_GITHUB_RAW_BASE_URLS = [
  'https://raw.githubusercontent.com',
  'https://cdn.jsdelivr.net/gh',
]

export type InstalledPluginUpdateResult = {
  status: 'available' | 'up-to-date' | 'error'
  latestVersion?: string
  error?: string
}

/** Maps pluginId → watcher unlisten fn for dev plugins */
const watcherCleanups = new Map<string, () => void>()

// A persisted status describes intent; only the registry proves this runtime loaded it.
// Package identity invalidates stale I/O; display names and update-check metadata do not.
const pluginActivations = new Map<string, { record: InstalledPlugin; promise: Promise<void> }>()
const pluginUninstalls = new Map<string, Promise<void>>()

function installPluginGlobals(): void {
  if (typeof window === 'undefined') return
  const sdk = createPluginHostSdk()
  window.HivenPlugin = sdk
  window.FluxTextPlugin = sdk
}

// ─── Tauri Helpers ────────────────────────────────────────────────────────────

/** Convert a local file path to a Tauri asset URL for dynamic import */
async function toAssetUrl(filePath: string, cacheBust = false): Promise<string> {
  try {
    const { convertFileSrc } = await import('@tauri-apps/api/core')
    const url = convertFileSrc(filePath)
    return cacheBust ? `${url}?t=${Date.now()}` : url
  } catch {
    // Fallback for non-Tauri environments (e.g., web development)
    return `file://${filePath}`
  }
}

/** Read a file as text using Tauri FS plugin */
async function readFileText(path: string): Promise<string> {
  return invokeCommand<string>('read_plugin_file', { path })
}

/**
 * Load a plugin package's locale dictionaries from `locales/{en,zh}.json`
 * and register them under the pluginId namespace. Missing files are ignored.
 */
async function loadAndRegisterPluginMessages(
  pluginId: string,
  folderPath: string,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const messages: PluginMessages = {}
  for (const locale of ['en', 'zh'] as const) {
    try {
      const raw = await readFileText(joinPath(folderPath, 'locales', `${locale}.json`))
      messages[locale] = JSON.parse(raw) as Record<string, string>
    } catch {
      // No locale file for this language; skip.
    }
    if (!isCurrent()) return
  }
  registerPluginMessages(pluginId, messages)
}

async function invokeCommand<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const { invoke } = await import('@tauri-apps/api/core')
  return invoke<T>(command, args)
}

/** Join path segments (simple cross-platform helper) */
function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

function pluginSettingsSourceForRecord(record: InstalledPlugin): 'builtin' | 'installed' {
  return record.source === 'builtin' ? 'builtin' : 'installed'
}

function clearPluginHostState(source: PluginSettingsSource, pluginId: string, options: { clearStorage: boolean }): void {
  usePluginSurfaceShortcutStore.getState().clearPluginShortcuts(source, pluginId)
  usePluginPermissionStore.getState().clearPluginPermissions(source, pluginId)
  usePluginSettingsStore.getState().removePluginSettings(source, pluginId)
  if (options.clearStorage) {
    clearPluginPrivateStorage(source, pluginId)
  }
}

function cleanupPluginEditorContributions(pluginId: string, panelIds: string[]): void {
  cleanupEditorPluginContributions({ pluginId, panelIds })
    .catch((error) => {
      console.warn(`[hiven] Failed to clean editor contributions for plugin "${pluginId}" through EditorBridge:`, error)
    })
}

function validatePackageRelativePath(value: string, label: string): void {
  const trimmed = value.trim()
  const segments = trimmed.split('/')
  if (
    !trimmed ||
    trimmed.includes('\\') ||
    trimmed.includes('?') ||
    trimmed.includes('#') ||
    trimmed.startsWith('/') ||
    /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) ||
    segments.some((segment) => !segment || segment === '.' || segment === '..')
  ) {
    throw new Error(`Invalid plugin ${label}: must be a package-relative path`)
  }
}

function isRemoteZipUrl(url: string): boolean {
  try {
    const parsed = new URL(url)
    return /^https?:$/.test(parsed.protocol) && /\.zip(?:$|\?)/i.test(parsed.pathname)
  } catch {
    return false
  }
}

export function isPluginZipUrl(url: string): boolean {
  return isRemoteZipUrl(url)
}

function comparePluginVersions(left: string, right: string): number {
  const normalize = (value: string) =>
    value
      .trim()
      .split(/[^0-9A-Za-z]+/)
      .filter(Boolean)
      .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()))
  const a = normalize(left)
  const b = normalize(right)
  const length = Math.max(a.length, b.length)
  for (let i = 0; i < length; i += 1) {
    const x = a[i] ?? 0
    const y = b[i] ?? 0
    if (x === y) continue
    if (typeof x === 'number' && typeof y === 'number') return x > y ? 1 : -1
    return String(x) > String(y) ? 1 : -1
  }
  return 0
}

export const PLUGIN_ENTRY_CANDIDATES = ['index.tsx', 'index.ts', 'index.jsx', 'index.js', 'index.mjs'] as const

async function resolveFixedPluginEntry(folderPath: string): Promise<string> {
  const tried: string[] = []
  for (const entry of PLUGIN_ENTRY_CANDIDATES) {
    validatePackageRelativePath(entry, 'entry')
    tried.push(entry)
    try {
      await readFileText(joinPath(folderPath, entry))
      return entry
    } catch {
      // Try the next fixed entry candidate.
    }
  }
  throw new Error(`Plugin package must include one fixed entry file: ${tried.join(', ')}`)
}

// ─── Manifest Loading ─────────────────────────────────────────────────────────

/**
 * Load and validate a plugin manifest from a folder.
 * Throws if manifest is missing or invalid.
 */
async function loadManifest(folderPath: string): Promise<ResolvedPluginManifest> {
  const manifestPath = joinPath(folderPath, 'manifest.json')
  const raw = await readFileText(manifestPath)
  const manifest = JSON.parse(raw) as Partial<PluginManifest>

  if (!manifest.pluginId || typeof manifest.pluginId !== 'string') {
    throw new Error(`Invalid manifest: missing pluginId in ${manifestPath}`)
  }
  const version = typeof manifest.version === 'string' && manifest.version.trim()
    ? manifest.version
    : '1.0.0'
  if (typeof manifest.displayName !== 'undefined' && typeof manifest.displayName !== 'string') {
    throw new Error(`Invalid manifest: displayName must be a string in ${manifestPath}`)
  }
  const resolvedEntry = await resolveFixedPluginEntry(folderPath)

  return {
    pluginId: manifest.pluginId,
    displayName: manifest.displayName || manifest.pluginId,
    displayNameI18n: manifest.displayNameI18n,
    version,
    entry: resolvedEntry,
    capabilities: manifest.capabilities || [],
    permissions: manifest.permissions || [],
  }
}

export async function getPluginPackageSummary(folderPath: string): Promise<PluginPackageSummary> {
  const packageMeta = await loadManifest(folderPath)
  return {
    pluginId: packageMeta.pluginId,
    displayName: packageMeta.displayName,
    displayNameI18n: packageMeta.displayNameI18n,
    version: packageMeta.version,
    entry: packageMeta.entry,
    capabilities: packageMeta.capabilities ?? [],
    permissions: packageMeta.permissions ?? [],
    folderPath,
  }
}

async function getInstalledPluginRoot(): Promise<string> {
  const configDir = await invokeCommand<string>('get_config_dir')
  return joinPath(configDir, 'plugins', 'installed')
}

async function getDevPluginRoot(): Promise<string> {
  const configDir = await invokeCommand<string>('get_config_dir')
  return joinPath(configDir, 'plugins', 'dev')
}

// ─── Plugin Entry Loading ─────────────────────────────────────────────────────

/**
 * Dynamically import a plugin entry and get its PluginDefinition.
 * Entry must export a PluginDefinition as default export.
 */
async function loadPluginEntry(folderPath: string, entryFile: string, cacheBust = false): Promise<PluginDefinition> {
  validatePackageRelativePath(entryFile, 'entry')
  const entryPath = joinPath(folderPath, entryFile)
  const url = await toAssetUrl(entryPath, cacheBust)

  installPluginGlobals()
  const mod = await import(/* @vite-ignore */ url)

  const definition: PluginDefinition | undefined = mod.default

  if (!definition) {
    throw new Error(`Plugin entry at "${entryPath}" has no default export`)
  }
  if (!isPluginDefinition(definition)) {
    throw new Error(`Plugin entry at "${entryPath}" default export is not a plugin definition (missing commands/renderers/panels)`)
  }

  return definition
}

async function loadDevPluginEntry(folderPath: string, entryFile: string): Promise<PluginDefinition> {
  validatePackageRelativePath(entryFile, 'entry')
  const entryPath = joinPath(folderPath, entryFile)
  const source = await readFileText(entryPath)
  const definition = parsePluginDefinitionSource(source)

  if (!definition) {
    throw new Error(`Dev plugin entry at "${entryPath}" is not a runnable plugin definition`)
  }
  if (!isPluginDefinition(definition)) {
    throw new Error(`Dev plugin entry at "${entryPath}" is not a plugin definition (missing commands/renderers/panels)`)
  }

  return definition
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Determine whether a value is a plugin definition (declares at least one
 * contribution kind). Package identity/metadata lives in manifest.json.
 */
function isPluginDefinition(value: unknown): value is PluginDefinition {
  if (!value || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  return (
    Array.isArray(v.commands) ||
    Array.isArray(v.renderers) ||
    Array.isArray(v.panels) ||
    Array.isArray(v.toolbar) ||
    Array.isArray(v.tools) ||
    (v.launcher != null && typeof v.launcher === 'object') ||
    (v.panel != null && typeof v.panel === 'object') ||
    v.settings != null
  )
}

/**
 * Validate that all contribution IDs in a definition are globally unique
 * within the target registry.
 */
function validateContributionIds(
  definition: PluginDefinition,
  source: 'production' | 'dev',
  currentPluginId?: string
): void {
  const registry = pluginRegistry
  const targetRegistry = source === 'production' ? registry.production : registry.dev

  const allIds = [
    ...(definition.commands?.map((c) => c.id) ?? []),
    ...(definition.renderers?.map((r) => r.id) ?? []),
    ...(definition.panels?.map((p) => p.id) ?? []),
  ]

  for (const id of allIds) {
    // Skip check for contributions owned by the same plugin (during reload)
    if (currentPluginId && id.startsWith(currentPluginId + '.')) continue

    if (
      targetRegistry.commands.has(id) ||
      targetRegistry.renderers.has(id) ||
      targetRegistry.panels.has(id)
    ) {
      throw new Error(
        `Contribution id "${id}" is already registered in ${source} registry. Use a unique id.`
      )
    }
  }
}

// ─── Production Plugin Operations ────────────────────────────────────────────

/**
 * Install a plugin from a local folder into production store (disabled state).
 * Does NOT enable the plugin.
 */
export async function installLocalPlugin(
  folderPath: string,
  options: {
    source?: PluginPackageSource
    sourceUrl?: string
    status?: InstalledPlugin['status']
  } = {},
): Promise<InstalledPlugin> {
  const packageMeta = await loadManifest(folderPath)
  const pluginId = packageMeta.pluginId

  const { plugins, installPlugin, updatePluginVersion, updatePluginMetadata } = usePluginStore.getState()

  // Check for existing plugin with same id
  if (plugins[pluginId]) {
    const existing = plugins[pluginId]
    if (existing.folderPath === folderPath) {
      // Re-installing from same folder → update version info only
      updatePluginVersion(pluginId, packageMeta.version, packageMeta.entry, packageMeta.capabilities ?? [])
      updatePluginMetadata(pluginId, {
        displayName: packageMeta.displayName,
        displayNameI18n: packageMeta.displayNameI18n,
        permissions: packageMeta.permissions ?? [],
        source: options.source ?? existing.source,
        sourceUrl: options.sourceUrl ?? existing.sourceUrl,
        folderPath,
        packagePath: folderPath,
      })
      return {
        ...existing,
        version: packageMeta.version,
        entry: packageMeta.entry,
        capabilities: packageMeta.capabilities ?? [],
        permissions: packageMeta.permissions ?? [],
        source: options.source ?? existing.source,
        sourceUrl: options.sourceUrl ?? existing.sourceUrl,
        folderPath,
        packagePath: folderPath,
        updatedAt: Date.now(),
      }
    }
    // Different folder → conflict: caller should ask user to overwrite
    throw new Error(`Plugin "${pluginId}" is already installed from "${existing.folderPath}". Uninstall it first.`)
  }

  const record: InstalledPlugin = {
    pluginId,
    displayName: packageMeta.displayName,
    displayNameI18n: packageMeta.displayNameI18n,
    version: packageMeta.version,
    entry: packageMeta.entry,
    capabilities: packageMeta.capabilities ?? [],
    permissions: packageMeta.permissions ?? [],
    folderPath,
    packagePath: folderPath,
    source: options.source ?? 'local',
    sourceUrl: options.sourceUrl,
    status: options.status ?? 'disabled',
    update: { status: 'idle' },
    installedAt: Date.now(),
    updatedAt: Date.now(),
  }

  installPlugin(record)
  return record
}

function samePluginActivationRecord(current: InstalledPlugin | undefined, expected: InstalledPlugin): boolean {
  if (!current) return false
  return current.status === expected.status
    && current.installedAt === expected.installedAt
    && current.folderPath === expected.folderPath
    && current.packagePath === expected.packagePath
    && current.entry === expected.entry
    && current.version === expected.version
    && current.source === expected.source
    && current.sourceUrl === expected.sourceUrl
    && (current.capabilities ?? []).length === (expected.capabilities ?? []).length
    && (current.capabilities ?? []).every((value, index) => value === expected.capabilities?.[index])
    && (current.permissions ?? []).length === (expected.permissions ?? []).length
    && (current.permissions ?? []).every((value, index) => value === expected.permissions?.[index])
}

/** Load once per record, with every async boundary guarded against newer intent. */
function activateInstalledPlugin(pluginId: string, reload: boolean): Promise<void> {
  if (pluginUninstalls.has(pluginId)) {
    return Promise.reject(new Error(`Plugin "${pluginId}" is being uninstalled`))
  }
  const { plugins, updatePluginStatus } = usePluginStore.getState()
  const record = plugins[pluginId]
  if (!record) return Promise.reject(new Error(`Plugin "${pluginId}" is not installed`))

  const pending = pluginActivations.get(pluginId)
  if (!reload && pending && samePluginActivationRecord(record, pending.record)) return pending.promise
  if (!reload && record.status === 'enabled' && pluginRegistry.getPluginDefinition(pluginId, 'production')) {
    return Promise.resolve()
  }
  if (reload) disablePlugin(pluginId)
  if (pluginUninstalls.has(pluginId)) {
    return Promise.reject(new Error(`Plugin "${pluginId}" is being uninstalled`))
  }

  let begin!: () => void
  let fail!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { begin = resolve; fail = reject })
  const activation = { record, promise: ready }
  const isCurrent = () => pluginActivations.get(pluginId) === activation
    && !pluginUninstalls.has(pluginId)
    && samePluginActivationRecord(usePluginStore.getState().plugins[pluginId], activation.record)
  activation.promise = ready.then(async () => {
    if (!isCurrent()) return
    const manifest = reload ? await loadManifest(record.folderPath) : undefined
    if (!isCurrent()) return
    const definition = await loadPluginEntry(record.folderPath, manifest?.entry ?? record.entry, reload)
    if (!isCurrent()) return
    await loadAndRegisterPluginMessages(pluginId, record.folderPath, isCurrent)
    if (!isCurrent()) return
    validateContributionIds(definition, 'production', reload ? pluginId : undefined)
    const localized = localizeContributions(pluginId, definition)

    if (manifest) {
      usePluginStore.getState().updatePluginVersion(pluginId, manifest.version, manifest.entry, manifest.capabilities)
      usePluginStore.getState().updatePluginMetadata(pluginId, { permissions: manifest.permissions ?? [] })
      activation.record = usePluginStore.getState().plugins[pluginId]
      if (!isCurrent()) return
    }
    pluginRegistry.registerProductionPlugin(
      pluginId,
      localized.commands,
      localized.renderers,
      localized.panels,
      localized.toolbar,
      localized.definition,
      manifest?.permissions ?? record.permissions ?? [],
    )
    // Registry subscribers may synchronously disable/uninstall the plugin.
    if (!isCurrent()) return
    updatePluginStatus(pluginId, 'enabled')

    if (manifest) {
      const oldCapabilities = record.capabilities ?? []
      const added = manifest.capabilities.filter((c) => !oldCapabilities.includes(c))
      const removed = oldCapabilities.filter((c) => !manifest.capabilities.includes(c))
      if (added.length > 0 || removed.length > 0) {
        const parts: string[] = []
        if (added.length > 0) parts.push(`added: ${added.join(', ')}`)
        if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`)
        showToast(`"${record.displayName}" capabilities changed — ${parts.join(' | ')}`, 'info')
      }
      showToast(`Plugin "${record.displayName}" reloaded`, 'success')
    }
  }).catch((error: unknown) => {
    if (!isCurrent()) return
    pluginRegistry.unregisterProductionPlugin(pluginId)
    if (!pluginRegistry.getPluginDefinition(pluginId, 'dev')) unregisterPluginMessages(pluginId)
    const errMsg = error instanceof Error ? error.message : String(error)
    updatePluginStatus(pluginId, 'error', errMsg)
    throw error
  }).finally(() => {
    if (pluginActivations.get(pluginId) === activation) pluginActivations.delete(pluginId)
  })
  pluginActivations.set(pluginId, activation)
  try {
    updatePluginStatus(pluginId, 'loading')
    activation.record = usePluginStore.getState().plugins[pluginId]
    begin()
  } catch (error) {
    fail(error)
  }
  return activation.promise
}

/** Enable persisted intent only after contributions exist in this runtime. */
export async function enablePlugin(pluginId: string): Promise<void> {
  return activateInstalledPlugin(pluginId, false)
}

/** Disable contributions and invalidate even a still-loading activation. */
export function disablePlugin(pluginId: string): void {
  pluginActivations.delete(pluginId)
  const { plugins, updatePluginStatus } = usePluginStore.getState()
  const record = plugins[pluginId]
  const panelIds = pluginRegistry.getPluginPanelIds(pluginId)
  pluginRegistry.unregisterProductionPlugin(pluginId)
  if (!pluginRegistry.getPluginDefinition(pluginId, 'dev')) unregisterPluginMessages(pluginId)
  if (!record) return

  void stopPluginBackground(pluginId, pluginSettingsSourceForRecord(record))
  cleanupPluginEditorContributions(pluginId, panelIds)
  updatePluginStatus(pluginId, 'disabled')
  if (record.status === 'enabled') showToast(`Plugin "${record.displayName}" disabled`, 'info')
}

/** Reload with a fresh activation, invalidating any preceding load. */
export async function reloadPlugin(pluginId: string): Promise<void> {
  return activateInstalledPlugin(pluginId, true)
}

/**
 * Revoke runtime access immediately. Delete only after synchronous preparation
 * succeeds; keep a disabled store record when deletion fails so users can retry.
 */
export async function uninstallPlugin(pluginId: string): Promise<void> {
  const pending = pluginUninstalls.get(pluginId)
  if (pending) return pending
  const record = usePluginStore.getState().plugins[pluginId]
  if (!record) return
  const source = pluginSettingsSourceForRecord(record)

  let begin!: () => void
  let fail!: (error: unknown) => void
  const ready = new Promise<void>((resolve, reject) => { begin = resolve; fail = reject })
  const removal = ready.then(async () => {
    if (record.source !== 'builtin') {
      const installedRoot = await getInstalledPluginRoot()
      await invokeCommand<void>('remove_plugin_dir', {
        rootPath: installedRoot,
        pluginId,
      })
      clearPluginHostState(source, pluginId, { clearStorage: true })
    }
    usePluginStore.getState().uninstallPlugin(pluginId)
  }).finally(() => {
    if (pluginUninstalls.get(pluginId) === removal) pluginUninstalls.delete(pluginId)
  })
  pluginUninstalls.set(pluginId, removal)
  try {
    disablePlugin(pluginId)
    begin()
  } catch (error) {
    fail(error)
  }
  return removal
}

// ─── Dev Plugin Operations ────────────────────────────────────────────────────

/**
 * Side-load a dev plugin from a local folder into dev registry.
 * Session-scoped, not persisted.
 */
export async function sideloadDevPlugin(folderPath: string): Promise<DevPlugin> {
  const packageMeta = await loadManifest(folderPath)
  const pluginId = packageMeta.pluginId

  const { addDevPlugin } = usePluginStore.getState()

  // If already dev-loaded, reload it first
  const existing = usePluginStore.getState().devPlugins[pluginId]
  if (existing) {
    await reloadDevPlugin(pluginId)
    return usePluginStore.getState().devPlugins[pluginId]!
  }

  const devRecord: DevPlugin = {
    pluginId,
    displayName: packageMeta.displayName,
    displayNameI18n: packageMeta.displayNameI18n,
    version: packageMeta.version,
    folderPath,
    packagePath: folderPath,
    source: 'local',
    capabilities: packageMeta.capabilities ?? [],
    permissions: packageMeta.permissions ?? [],
    status: 'active',
    loadedAt: Date.now(),
    updatedAt: Date.now(),
  }

  try {
    const definition = await loadDevPluginEntry(folderPath, packageMeta.entry)

    await loadAndRegisterPluginMessages(pluginId, folderPath)
    const localized = localizeContributions(pluginId, definition)
    pluginRegistry.registerDevPlugin(
      pluginId,
      localized.commands,
      localized.renderers,
      localized.panels,
      localized.toolbar,
      localized.definition,
      packageMeta.permissions ?? [],
    )

    addDevPlugin(devRecord)
    showToast(`[DEV] Plugin "${packageMeta.displayName}" loaded`, 'success')
    return devRecord
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    const errorRecord: DevPlugin = { ...devRecord, status: 'error', error: errMsg }
    addDevPlugin(errorRecord)
    throw err
  }
}

/**
 * Reload a dev plugin: dispose from dev registry, re-import with cache busting.
 */
export async function reloadDevPlugin(pluginId: string): Promise<void> {
  const { devPlugins, updateDevPluginStatus } = usePluginStore.getState()
  const record = devPlugins[pluginId]

  if (!record) throw new Error(`Dev plugin "${pluginId}" is not loaded`)

  // Remove from registry and clean up surfaces
  // Get panelIds before unregistering (they're removed from registry after)
  const panelIds = pluginRegistry.getPluginPanelIds(pluginId)
  void stopPluginBackground(pluginId, 'dev')
  pluginRegistry.unregisterDevPlugin(pluginId)

  cleanupPluginEditorContributions(pluginId, panelIds)

  try {
    const packageMeta = await loadManifest(record.folderPath)
    const definition = await loadDevPluginEntry(record.folderPath, packageMeta.entry)

    await loadAndRegisterPluginMessages(pluginId, record.folderPath)
    const localized = localizeContributions(pluginId, definition)
    pluginRegistry.registerDevPlugin(
      pluginId,
      localized.commands,
      localized.renderers,
      localized.panels,
      localized.toolbar,
      localized.definition,
      packageMeta.permissions ?? [],
    )

    updateDevPluginStatus(pluginId, 'active')
    showToast(`[DEV] Plugin "${record.displayName}" reloaded`, 'success')
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    updateDevPluginStatus(pluginId, 'error', errMsg)
    throw err
  }
}

/**
 * Start watching a dev plugin folder for file changes.
 * On any change, auto-reloads the dev plugin.
 */
export async function watchDevPlugin(pluginId: string): Promise<void> {
  const { devPlugins } = usePluginStore.getState()
  const record = devPlugins[pluginId]
  if (!record) throw new Error(`Dev plugin "${pluginId}" is not loaded`)

  // Already watching
  if (watcherCleanups.has(pluginId)) return

  const { watch } = await import('@tauri-apps/plugin-fs')

  let reloadTimeout: ReturnType<typeof setTimeout> | null = null

  const unwatch = await watch(
    record.folderPath,
    () => {
      // Debounce: wait 300ms after last change before reloading
      if (reloadTimeout) clearTimeout(reloadTimeout)
      reloadTimeout = setTimeout(async () => {
        reloadTimeout = null
        try {
          await reloadDevPlugin(pluginId)
        } catch (err: unknown) {
          console.error(`[hiven] Watch auto-reload failed for "${pluginId}":`, err)
        }
      }, 300)
    },
    { recursive: true }
  )

  watcherCleanups.set(pluginId, () => {
    if (reloadTimeout) clearTimeout(reloadTimeout)
    unwatch()
  })

  usePluginStore.getState().updateDevPluginWatching(pluginId, true)
  showToast(`[DEV] Watching "${record.displayName}" for changes`, 'info')
}

/**
 * Stop watching a dev plugin folder.
 */
export function unwatchDevPlugin(pluginId: string): void {
  const cleanup = watcherCleanups.get(pluginId)
  if (cleanup) {
    cleanup()
    watcherCleanups.delete(pluginId)
  }
  const { devPlugins } = usePluginStore.getState()
  if (devPlugins[pluginId]) {
    usePluginStore.getState().updateDevPluginWatching(pluginId, false)
  }
}

/**
 * Remove a dev plugin from the dev registry.
 */
export function removeDevPlugin(pluginId: string): void {
  const { devPlugins, removeDevPlugin: removeFromStore } = usePluginStore.getState()
  const record = devPlugins[pluginId]
  if (!record) return

  // Stop watching before removing
  unwatchDevPlugin(pluginId)

  // Get panelIds before unregistering (they're removed from registry after)
  const panelIds = pluginRegistry.getPluginPanelIds(pluginId)
  void stopPluginBackground(pluginId, 'dev')
  pluginRegistry.unregisterDevPlugin(pluginId)

  cleanupPluginEditorContributions(pluginId, panelIds)

  clearPluginHostState('dev', pluginId, { clearStorage: true })
  removeFromStore(pluginId)
}

/**
 * Clear all dev plugins on app close / session end.
 */
export function clearAllDevPlugins(): void {
  // Stop all watchers
  for (const [pluginId, cleanup] of watcherCleanups) {
    cleanup()
    watcherCleanups.delete(pluginId)
  }
  pluginRegistry.clearAllDev()
  const { clearAllDevPlugins: clearStore } = usePluginStore.getState()
  clearStore()
}

// ─── Open Local Folder Dialog ─────────────────────────────────────────────────

/**
 * Open a folder picker dialog and return the selected path.
 * Returns null if user cancels.
 */
export async function pickLocalPluginFolder(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({
      directory: true,
      multiple: false,
      title: 'Select Plugin Folder',
    })
    if (typeof result === 'string') return result
    return null
  } catch {
    return null
  }
}

export async function pickPluginZipFile(): Promise<string | null> {
  try {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const result = await open({
      multiple: false,
      title: 'Select Plugin Zip',
      filters: [{ name: 'Plugin Zip', extensions: ['zip'] }],
    })
    if (typeof result === 'string') return result
    return null
  } catch {
    return null
  }
}

export function rejectSingleFileRemoteImport(url: string): void {
  try {
    const pathname = new URL(url).pathname.toLowerCase()
    if (/\.(js|ts)(?:$|\?)/.test(pathname)) {
      throw new Error('Remote single-file plugin import is no longer supported. Install a plugin directory or zip package instead.')
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('single-file plugin import')) throw error
  }
}

export async function installPluginZip(zipPath: string, destinationRoot?: string): Promise<InstalledPlugin> {
  const root = destinationRoot ?? await getInstalledPluginRoot()
  const folderPath = await invokeCommand<string>('install_plugin_zip', {
    zipPath,
    destinationRoot: root,
  })
  return installLocalPlugin(folderPath, { source: 'zip', sourceUrl: zipPath })
}

export const importPluginZip = installPluginZip

export async function installPluginZipUrl(sourceUrl: string, destinationRoot?: string): Promise<InstalledPlugin> {
  rejectSingleFileRemoteImport(sourceUrl)
  if (!isRemoteZipUrl(sourceUrl)) {
    throw new Error('Remote zip plugin import expects an http(s) .zip URL.')
  }
  const root = destinationRoot ?? await getInstalledPluginRoot()
  const folderPath = await invokeCommand<string>('install_plugin_zip_url', {
    url: sourceUrl,
    destinationRoot: root,
  })
  return installLocalPlugin(folderPath, { source: 'zip', sourceUrl })
}

export const importPluginZipUrl = installPluginZipUrl

export async function importLocalPluginDirectory(folderPath: string, destinationRoot?: string): Promise<InstalledPlugin> {
  const root = destinationRoot ?? await getInstalledPluginRoot()
  const installedFolderPath = await invokeCommand<string>('install_plugin_dir', {
    sourcePath: folderPath,
    destinationRoot: root,
  })
  return installLocalPlugin(installedFolderPath, { source: 'local', sourceUrl: folderPath })
}

export async function importDevPluginDirectory(folderPath: string, destinationRoot?: string): Promise<DevPlugin> {
  const root = destinationRoot ?? await getDevPluginRoot()
  const installedFolderPath = await invokeCommand<string>('install_plugin_dir', {
    sourcePath: folderPath,
    destinationRoot: root,
  })
  return sideloadDevPlugin(installedFolderPath)
}

function parseGithubDirectoryUrl(sourceUrl: string): {
  owner: string
  repo: string
  branch: string
  path: string
} {
  rejectSingleFileRemoteImport(sourceUrl)
  const url = new URL(sourceUrl)
  if (url.hostname !== 'github.com') {
    throw new Error('Only github.com directory URLs are supported for remote plugin import.')
  }

  const parts = url.pathname.split('/').filter(Boolean)
  const ref = url.searchParams.get('ref')
  const [owner, repo, marker, branch, ...rest] = parts
  if (!owner || !repo) {
    throw new Error('GitHub URL must include owner and repository.')
  }
  if (!marker) {
    return { owner, repo, branch: ref || 'main', path: '' }
  }
  if (marker !== 'tree') {
    throw new Error('Remote plugin import expects a GitHub repository or /tree/{branch}/{path} directory URL.')
  }
  if (ref) {
    return { owner, repo, branch: ref, path: [branch, ...rest].filter(Boolean).join('/') }
  }
  return { owner, repo, branch: branch || 'main', path: rest.join('/') }
}

function githubRawFileUrls(sourceUrl: string, filePath: string, cacheBust = false): string[] {
  const target = parseGithubDirectoryUrl(sourceUrl)
  validatePackageRelativePath(filePath, 'GitHub plugin file path')
  const packagePath = [target.path, filePath].filter(Boolean).join('/')
  const encodedPath = packagePath.split('/').map(encodeURIComponent).join('/')
  const rawPath = [target.owner, target.repo, target.branch, encodedPath]
    .filter(Boolean)
    .map((part) => String(part).replace(/\/$/, ''))
    .join('/')
  const jsdelivrPath = `${target.owner}/${target.repo}@${target.branch}/${encodedPath}`
  const query = cacheBust ? `?t=${Date.now()}` : ''
  return REMOTE_GITHUB_RAW_BASE_URLS.map((base) => {
    const normalizedBase = base.replace(/\/$/, '')
    const path = normalizedBase.includes('cdn.jsdelivr.net') ? jsdelivrPath : rawPath
    return `${normalizedBase}/${path}${query}`
  })
}

async function fetchTextWithFallback(urls: string[]): Promise<string> {
  let lastError = ''
  for (const url of urls) {
    try {
      return await invokeCommand<string>('fetch_url', { url })
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
    }
  }
  throw new Error(`All remote plugin metadata requests failed. Last error: ${lastError}`)
}

async function fetchGithubManifest(sourceUrl: string, cacheBust = false): Promise<ResolvedPluginManifest> {
  const raw = await fetchTextWithFallback(githubRawFileUrls(sourceUrl, 'manifest.json', cacheBust))
  const manifest = JSON.parse(raw) as Partial<PluginManifest>
  if (!manifest.pluginId) {
    throw new Error('Remote GitHub plugin manifest is missing pluginId')
  }
  return {
    pluginId: manifest.pluginId,
    displayName: manifest.displayName || manifest.pluginId,
    displayNameI18n: manifest.displayNameI18n,
    version: typeof manifest.version === 'string' && manifest.version.trim() ? manifest.version : '1.0.0',
    entry: 'index.*',
    capabilities: manifest.capabilities || [],
    permissions: manifest.permissions || [],
  }
}

export async function fetchGithubDirectory(sourceUrl: string, destinationRoot?: string): Promise<string> {
  const root = destinationRoot ?? await getInstalledPluginRoot()
  const target = parseGithubDirectoryUrl(sourceUrl)
  return invokeCommand<string>('fetch_github_directory', {
    ...target,
    destinationRoot: root,
  })
}

export async function importGithubDirectory(sourceUrl: string, destinationRoot?: string): Promise<InstalledPlugin> {
  const folderPath = await fetchGithubDirectory(sourceUrl, destinationRoot)
  return installLocalPlugin(folderPath, { source: 'github', sourceUrl })
}

export const installGithubDirectory = importGithubDirectory

export async function checkInstalledPluginUpdate(pluginId: string): Promise<InstalledPluginUpdateResult> {
  const { plugins, updatePluginMetadata } = usePluginStore.getState()
  const record = plugins[pluginId]
  if (!record) throw new Error(`Plugin "${pluginId}" is not installed`)
  if (record.source !== 'github' || !record.sourceUrl) {
    const result: InstalledPluginUpdateResult = { status: 'error', error: 'Only GitHub-installed plugins support update checks.' }
    updatePluginMetadata(pluginId, { update: { ...result, status: 'error', checkedAt: Date.now() } })
    return result
  }

  updatePluginMetadata(pluginId, { update: { status: 'checking', checkedAt: Date.now() } })
  try {
    const remote = await fetchGithubManifest(record.sourceUrl, true)
    if (remote.pluginId !== pluginId) {
      throw new Error(`Remote manifest pluginId mismatch: expected ${pluginId}, got ${remote.pluginId}`)
    }
    const hasUpdate = comparePluginVersions(remote.version, record.version) > 0
    const result: InstalledPluginUpdateResult = {
      status: hasUpdate ? 'available' : 'up-to-date',
      latestVersion: remote.version,
    }
    updatePluginMetadata(pluginId, {
      update: { status: result.status, latestVersion: remote.version, checkedAt: Date.now() },
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updatePluginMetadata(pluginId, {
      update: { status: 'error', error: message, checkedAt: Date.now() },
    })
    return { status: 'error', error: message }
  }
}

export async function updateInstalledPlugin(pluginId: string): Promise<InstalledPlugin> {
  const { plugins, updatePluginMetadata, updatePluginVersion } = usePluginStore.getState()
  const record = plugins[pluginId]
  if (!record) throw new Error(`Plugin "${pluginId}" is not installed`)
  if (record.source !== 'github' || !record.sourceUrl) {
    throw new Error('Only GitHub-installed plugins support one-click updates.')
  }

  const wasEnabled = record.status === 'enabled'
  const installedRoot = await getInstalledPluginRoot()
  const stagingPluginId = `.plugin-update-${pluginId}-${Date.now()}`
  const stagingRoot = joinPath(installedRoot, stagingPluginId)
  updatePluginMetadata(pluginId, { update: { status: 'checking', checkedAt: Date.now() } })

  try {
    if (wasEnabled) disablePlugin(pluginId)
    const remote = await fetchGithubManifest(record.sourceUrl, true)
    if (remote.pluginId !== pluginId) {
      throw new Error(`Remote manifest pluginId mismatch: expected ${pluginId}, got ${remote.pluginId}`)
    }
    const stagedFolder = await fetchGithubDirectory(record.sourceUrl, stagingRoot)
    const stagedSummary = await getPluginPackageSummary(stagedFolder)
    if (stagedSummary.pluginId !== pluginId) {
      throw new Error(`Remote manifest pluginId mismatch: expected ${pluginId}, got ${stagedSummary.pluginId}`)
    }
    await invokeCommand<void>('replace_plugin_dir', {
      sourcePath: stagedFolder,
      rootPath: installedRoot,
      pluginId,
    })
    const nextFolderPath = joinPath(installedRoot, pluginId)
    const nextSummary = await getPluginPackageSummary(nextFolderPath)
    updatePluginVersion(pluginId, nextSummary.version, nextSummary.entry, nextSummary.capabilities)
    updatePluginMetadata(pluginId, {
      displayName: nextSummary.displayName,
      displayNameI18n: nextSummary.displayNameI18n,
      folderPath: nextFolderPath,
      packagePath: nextFolderPath,
      source: 'github',
      sourceUrl: record.sourceUrl,
      update: { status: 'up-to-date', latestVersion: nextSummary.version, checkedAt: Date.now() },
    })
    if (wasEnabled) await enablePlugin(pluginId)
    showToast(`Plugin "${nextSummary.displayName}" updated`, 'success')
    return usePluginStore.getState().plugins[pluginId]
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    updatePluginMetadata(pluginId, { update: { status: 'error', error: message, checkedAt: Date.now() } })
    if (wasEnabled && usePluginStore.getState().plugins[pluginId]?.status !== 'enabled') {
      await enablePlugin(pluginId).catch(() => undefined)
    }
    throw error
  } finally {
    await invokeCommand<void>('remove_plugin_dir', {
      rootPath: installedRoot,
      pluginId: stagingPluginId,
    }).catch(() => undefined)
  }
}

export async function createDevPluginScaffold(options: {
  pluginId?: string
  title?: string
  template?: 'default' | 'script-command'
} = {}): Promise<DevPlugin> {
  const root = await getDevPluginRoot()
  const suffix = Date.now().toString(36)
  const pluginId = options.pluginId?.trim() || `new-plugin-${suffix}`
  const title = options.title?.trim() || 'New Plugin'
  validatePackageRelativePath(pluginId, 'plugin id')
  const folderPath = joinPath(root, pluginId)
  const scaffold = createPluginScaffoldFiles({
    pluginId,
    title,
    template: options.template,
  })
  await savePluginFile(joinPath(folderPath, 'manifest.json'), JSON.stringify(scaffold.manifest, null, 2))
  await savePluginFile(joinPath(folderPath, 'index.js'), scaffold.indexSource)
  await savePluginFile(joinPath(folderPath, 'README.md'), scaffold.readmeSource)
  await savePluginFile(joinPath(folderPath, 'locales', 'en.json'), scaffold.localeEn)
  await savePluginFile(joinPath(folderPath, 'locales', 'zh.json'), scaffold.localeZh)
  return sideloadDevPlugin(folderPath)
}

export async function loadInstalledPluginsFromStore(): Promise<void> {
  const plugins = Object.values(usePluginStore.getState().plugins)
  for (const plugin of plugins) {
    try {
      await getPluginPackageSummary(plugin.folderPath)
      if (!samePluginActivationRecord(usePluginStore.getState().plugins[plugin.pluginId], plugin)) continue
      if (plugin.status === 'enabled' || plugin.status === 'loading') {
        await enablePlugin(plugin.pluginId)
      }
    } catch (error: unknown) {
      if (!samePluginActivationRecord(usePluginStore.getState().plugins[plugin.pluginId], plugin)) continue
      usePluginStore.getState().updatePluginStatus(
        plugin.pluginId,
        'error',
        error instanceof Error ? error.message : String(error),
      )
    }
  }
}

export async function listPluginDirs(path: string): Promise<PluginPackageSummary[]> {
  return invokeCommand<PluginPackageSummary[]>('list_plugin_dirs', { path })
}

export async function listPluginFiles(path: string): Promise<PluginFileTree[]> {
  return invokeCommand<PluginFileTree[]>('list_plugin_files', { path })
}

export async function readPluginFile(path: string): Promise<string> {
  return invokeCommand<string>('read_plugin_file', { path })
}

export async function savePluginFile(path: string, content: string): Promise<void> {
  await invokeCommand<void>('save_plugin_file', { path, content })
}

export async function openPluginDir(path: string): Promise<void> {
  await invokeCommand<void>('open_plugin_dir', { path })
}
