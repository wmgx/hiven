/**
 * FluxText Plugin System - Plugin Runtime
 * Handles loading, installing, enabling, disabling, and side-loading plugins.
 *
 * Spike validations this module assumes:
 *   1. Tauri asset protocol + convertFileSrc can load local ESM (verified in spike)
 *   2. Plugin bundles externalize React/ReactDOM (host provides them via window)
 *   3. Dynamic import with cache-busting timestamp works for dev reload
 *
 * Loading strategy:
 *   - Production plugins: manifest.json + entry.js loaded from installed folder
 *   - Dev plugins: same, but registered to dev registry only, session-scoped
 *   - Cache busting: append ?t=<timestamp> to entry URL on every reload
 */

import { pluginRegistry } from './pluginRegistry'
import { useWorkspaceStore } from './workspaceStore'
import { usePluginStore } from './pluginStore'
import { showToast } from './toast'
import type { PluginDefinition, PluginManifest, InstalledPlugin, DevPlugin } from './pluginTypes'

/** Maps pluginId → watcher unlisten fn for dev plugins */
const watcherCleanups = new Map<string, () => void>()

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
  const { readTextFile } = await import('@tauri-apps/plugin-fs')
  return readTextFile(path)
}

/** Join path segments (simple cross-platform helper) */
function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

// ─── Manifest Loading ─────────────────────────────────────────────────────────

/**
 * Load and validate a plugin manifest from a folder.
 * Throws if manifest is missing or invalid.
 */
async function loadManifest(folderPath: string): Promise<PluginManifest> {
  const manifestPath = joinPath(folderPath, 'manifest.json')
  const raw = await readFileText(manifestPath)
  const manifest = JSON.parse(raw) as Partial<PluginManifest>

  if (!manifest.pluginId || typeof manifest.pluginId !== 'string') {
    throw new Error(`Invalid manifest: missing pluginId in ${manifestPath}`)
  }
  if (!manifest.version || typeof manifest.version !== 'string') {
    throw new Error(`Invalid manifest: missing version in ${manifestPath}`)
  }
  if (!manifest.entry || typeof manifest.entry !== 'string') {
    throw new Error(`Invalid manifest: missing entry in ${manifestPath}`)
  }

  return {
    pluginId: manifest.pluginId,
    displayName: manifest.displayName || manifest.pluginId,
    version: manifest.version,
    entry: manifest.entry,
    capabilities: manifest.capabilities || [],
  }
}

// ─── Plugin Entry Loading ─────────────────────────────────────────────────────

/**
 * Dynamically import a plugin entry and get its PluginDefinition.
 * Entry must export a PluginDefinition as default export.
 */
async function loadPluginEntry(folderPath: string, entryFile: string, cacheBust = false): Promise<PluginDefinition> {
  const entryPath = joinPath(folderPath, entryFile)
  const url = await toAssetUrl(entryPath, cacheBust)

  const mod = await import(/* @vite-ignore */ url)

  const definition: PluginDefinition | undefined = mod.default

  if (!definition) {
    throw new Error(`Plugin entry at "${entryPath}" has no default export`)
  }
  if (!definition.id || typeof definition.id !== 'string') {
    throw new Error(`Plugin entry at "${entryPath}" default export is missing id`)
  }
  if (!definition.version || typeof definition.version !== 'string') {
    throw new Error(`Plugin entry at "${entryPath}" default export is missing version`)
  }

  return definition
}

// ─── Validation ───────────────────────────────────────────────────────────────

/**
 * Validate that PluginDefinition.id matches manifest.pluginId.
 */
function validatePluginIdMatch(definition: PluginDefinition, manifest: PluginManifest): void {
  if (definition.id !== manifest.pluginId) {
    throw new Error(
      `Plugin id mismatch: manifest says "${manifest.pluginId}", entry says "${definition.id}"`
    )
  }
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
export async function installLocalPlugin(folderPath: string): Promise<InstalledPlugin> {
  const manifest = await loadManifest(folderPath)
  const pluginId = manifest.pluginId

  const { plugins, installPlugin, updatePluginVersion } = usePluginStore.getState()

  // Check for existing plugin with same id
  if (plugins[pluginId]) {
    const existing = plugins[pluginId]
    if (existing.folderPath === folderPath) {
      // Re-installing from same folder → update version info only
      updatePluginVersion(pluginId, manifest.version, manifest.entry, manifest.capabilities ?? [])
      return { ...existing, version: manifest.version, entry: manifest.entry, capabilities: manifest.capabilities ?? [] }
    }
    // Different folder → conflict: caller should ask user to overwrite
    throw new Error(`Plugin "${pluginId}" is already installed from "${existing.folderPath}". Uninstall it first.`)
  }

  const record: InstalledPlugin = {
    pluginId,
    displayName: manifest.displayName,
    version: manifest.version,
    entry: manifest.entry,
    capabilities: manifest.capabilities ?? [],
    folderPath,
    status: 'disabled',
    installedAt: Date.now(),
  }

  installPlugin(record)
  return record
}

/**
 * Enable an installed plugin: load entry, validate, register to production registry.
 */
export async function enablePlugin(pluginId: string): Promise<void> {
  const { plugins, updatePluginStatus } = usePluginStore.getState()
  const record = plugins[pluginId]

  if (!record) {
    throw new Error(`Plugin "${pluginId}" is not installed`)
  }
  if (record.status === 'enabled') {
    return // already enabled
  }

  updatePluginStatus(pluginId, 'loading')

  try {
    const definition = await loadPluginEntry(record.folderPath, record.entry)
    validatePluginIdMatch(definition, { pluginId, displayName: record.displayName, version: record.version, entry: record.entry, capabilities: record.capabilities })
    validateContributionIds(definition, 'production')

    pluginRegistry.registerProductionPlugin(
      pluginId,
      definition.commands ?? [],
      definition.renderers ?? [],
      definition.panels ?? []
    )

    updatePluginStatus(pluginId, 'enabled')
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    updatePluginStatus(pluginId, 'error', errMsg)
    throw err
  }
}

/**
 * Disable an enabled plugin: unregister contributions, clean up active surfaces.
 */
export function disablePlugin(pluginId: string): void {
  const { plugins, updatePluginStatus } = usePluginStore.getState()
  const record = plugins[pluginId]

  if (!record || record.status !== 'enabled') return

  // Unregister from production registry
  // Get panelIds before unregistering (they're removed from registry after)
  const panelIds = pluginRegistry.getPluginPanelIds(pluginId)
  pluginRegistry.unregisterProductionPlugin(pluginId)

  // Clean up pane renderers using this plugin
  const ws = useWorkspaceStore.getState()
  ws.clearPaneRenderersForPlugin(pluginId)

  // Clean up panels using this plugin
  for (const panelId of panelIds) {
    ws.closePanelV2(panelId)
  }

  updatePluginStatus(pluginId, 'disabled')
  showToast(`Plugin "${record.displayName}" disabled`, 'info')
}

/**
 * Reload a plugin: disable → re-import → enable.
 */
export async function reloadPlugin(pluginId: string): Promise<void> {
  const { plugins, updatePluginStatus } = usePluginStore.getState()
  const record = plugins[pluginId]

  if (!record) throw new Error(`Plugin "${pluginId}" is not installed`)

  const oldCapabilities = record.capabilities ?? []

  // Disable first (if enabled)
  if (record.status === 'enabled') {
    disablePlugin(pluginId)
  }

  updatePluginStatus(pluginId, 'loading')

  try {
    // Load new manifest to get updated capabilities
    const newManifest = await loadManifest(record.folderPath)
    const newCapabilities = newManifest.capabilities ?? []

    const definition = await loadPluginEntry(record.folderPath, record.entry, true /* cache bust */)
    validatePluginIdMatch(definition, { pluginId, displayName: record.displayName, version: record.version, entry: record.entry, capabilities: record.capabilities })
    validateContributionIds(definition, 'production', pluginId)

    pluginRegistry.registerProductionPlugin(
      pluginId,
      definition.commands ?? [],
      definition.renderers ?? [],
      definition.panels ?? []
    )

    // Update stored capabilities
    usePluginStore.getState().updatePluginVersion(pluginId, newManifest.version, newManifest.entry, newCapabilities)
    updatePluginStatus(pluginId, 'enabled')

    // Show capability diff
    const added = newCapabilities.filter((c) => !oldCapabilities.includes(c))
    const removed = oldCapabilities.filter((c) => !newCapabilities.includes(c))
    if (added.length > 0 || removed.length > 0) {
      const parts: string[] = []
      if (added.length > 0) parts.push(`added: ${added.join(', ')}`)
      if (removed.length > 0) parts.push(`removed: ${removed.join(', ')}`)
      showToast(`"${record.displayName}" capabilities changed — ${parts.join(' | ')}`, 'info')
    }

    showToast(`Plugin "${record.displayName}" reloaded`, 'success')
  } catch (err: unknown) {
    const errMsg = err instanceof Error ? err.message : String(err)
    updatePluginStatus(pluginId, 'error', errMsg)
    throw err
  }
}

/**
 * Uninstall a plugin: disable it, then remove from store.
 */
export function uninstallPlugin(pluginId: string): void {
  const { plugins, uninstallPlugin: removeFromStore } = usePluginStore.getState()
  const record = plugins[pluginId]
  if (!record) return

  if (record.status === 'enabled') {
    disablePlugin(pluginId)
  }

  removeFromStore(pluginId)
}

// ─── Dev Plugin Operations ────────────────────────────────────────────────────

/**
 * Side-load a dev plugin from a local folder into dev registry.
 * Session-scoped, not persisted.
 */
export async function sideloadDevPlugin(folderPath: string): Promise<DevPlugin> {
  const manifest = await loadManifest(folderPath)
  const pluginId = manifest.pluginId

  const { addDevPlugin } = usePluginStore.getState()

  // If already dev-loaded, reload it first
  const existing = usePluginStore.getState().devPlugins[pluginId]
  if (existing) {
    await reloadDevPlugin(pluginId)
    return usePluginStore.getState().devPlugins[pluginId]!
  }

  const devRecord: DevPlugin = {
    pluginId,
    displayName: manifest.displayName,
    version: manifest.version,
    folderPath,
    status: 'active',
    loadedAt: Date.now(),
  }

  try {
    const definition = await loadPluginEntry(folderPath, manifest.entry)
    validatePluginIdMatch(definition, manifest)

    pluginRegistry.registerDevPlugin(
      pluginId,
      definition.commands ?? [],
      definition.renderers ?? [],
      definition.panels ?? []
    )

    addDevPlugin(devRecord)
    showToast(`[DEV] Plugin "${manifest.displayName}" loaded`, 'success')
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
  pluginRegistry.unregisterDevPlugin(pluginId)

  const ws = useWorkspaceStore.getState()
  ws.clearPaneRenderersForPlugin(pluginId)
  for (const panelId of panelIds) {
    ws.closePanelV2(panelId)
  }

  try {
    const manifest = await loadManifest(record.folderPath)
    const definition = await loadPluginEntry(record.folderPath, manifest.entry, true /* cache bust */)
    validatePluginIdMatch(definition, manifest)

    pluginRegistry.registerDevPlugin(
      pluginId,
      definition.commands ?? [],
      definition.renderers ?? [],
      definition.panels ?? []
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
          console.error(`[FluxText] Watch auto-reload failed for "${pluginId}":`, err)
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
  pluginRegistry.unregisterDevPlugin(pluginId)

  const ws = useWorkspaceStore.getState()
  ws.clearPaneRenderersForPlugin(pluginId)
  for (const panelId of panelIds) {
    ws.closePanelV2(panelId)
  }

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
