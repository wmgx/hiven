/**
 * Plugin Launcher API (host implementation)
 *
 * The controlled API passed to plugin launcher execute handlers. This is the
 * ONLY way plugin launcher code touches the host: read active/selection/clipboard
 * text, and emit text via copy/insert/replace/open. Plugin item modules never
 * import workspace stores, monaco, or the effect runner — the host injects this.
 *
 * Host-owned launcher items may use richer host APIs directly; this object is the
 * boundary for *plugin* items.
 */

import { openExternalUrl } from '../effectRunner'
import { useAppStore } from '../../store'
import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'
import { openLauncherHostedPluginSurface } from '../pluginSurfaceOpenRequest'
import { createPluginPrivateStorage } from '../pluginStorage'
import { getPluginPermissionSnapshot, requirePluginPermissions } from '../pluginPermissions'
import {
  getActiveEditorContextSnapshot,
  getActiveEditorPaneSnapshot,
} from '../editorBridge'
import { createQuickEditorPane, overwriteQuickEditorText, showQuickEditorSurface } from '../quickEditor/quickEditorRequests'
import { readQuickEditorPaneSnapshot } from '../quickEditor/quickEditorPaneSnapshot'
import type { PluginPermission } from '../pluginTypes'
import type { PluginSettingsSource } from '../pluginSettingsStore'
import type { DiscoveredApp, PluginAppsApi, PluginLauncherApi } from './types'

export type PluginLauncherApiOptions = {
  pluginId?: string
  source?: PluginSettingsSource
  requestedPermissions?: readonly PluginPermission[]
}

function readActiveText(): string {
  return getActiveEditorContextSnapshot()?.activeText ?? ''
}

function readSelectionText(): string {
  return getActiveEditorContextSnapshot()?.selectedText ?? ''
}

type PaneSnapshot = ReturnType<PluginLauncherApi['getPaneSnapshot']>

function emptyPaneSnapshot(): PaneSnapshot {
  return {
    activePaneId: '',
    previousActivePaneId: undefined,
    paneIds: [],
    panes: {},
    renderers: {},
  }
}

function buildMergedPaneSnapshot(): PaneSnapshot {
  const editor = getActiveEditorPaneSnapshot()
  const editorContext = getActiveEditorContextSnapshot()
  const quick = readQuickEditorPaneSnapshot()

  const panes: PaneSnapshot['panes'] = {}
  const paneIds: string[] = []

  if (editor) {
    for (const paneId of editor.paneIds) {
      const meta = editor.panes[paneId] ?? {}
      const index = editor.paneIds.indexOf(paneId)
      paneIds.push(paneId)
      panes[paneId] = {
        title: meta.title || `Pane ${index + 1}`,
        language: meta.language,
        stickyScroll: meta.stickyScroll,
        text: paneId === editor.activePaneId ? (editorContext?.activeText ?? '') : '',
        origin: 'editor',
      }
    }
  }

  if (quick) {
    for (const paneId of quick.paneIds) {
      // Avoid colliding with editor pane ids.
      const snapshotId = paneIds.includes(paneId) ? `quick:${paneId}` : paneId
      paneIds.push(snapshotId)
      panes[snapshotId] = {
        title: quick.panes[paneId]?.title,
        language: quick.panes[paneId]?.language,
        text: quick.panes[paneId]?.text ?? '',
        origin: 'quick-editor',
      }
    }
  }

  const activePaneId = editor?.activePaneId
    ?? quick?.activePaneId
    ?? paneIds[0]
    ?? ''

  return {
    activePaneId,
    previousActivePaneId: editor?.previousActivePaneId,
    paneIds,
    panes,
    renderers: {},
  }
}

async function readClipboard(): Promise<string> {
  try {
    const { readText } = await import('@tauri-apps/plugin-clipboard-manager')
    return (await readText()) ?? ''
  } catch {
    try {
      return await navigator.clipboard.readText()
    } catch {
      return ''
    }
  }
}

async function writeClipboard(text: string): Promise<void> {
  try {
    const { writeText } = await import('@tauri-apps/plugin-clipboard-manager')
    await writeText(text)
  } catch {
    try {
      await navigator.clipboard.writeText(text)
    } catch (error) {
      console.warn('[launcher] clipboard write failed:', error)
    }
  }
}

async function openEditorWindow(): Promise<string | undefined> {
  try {
    await showQuickEditorSurface()
  } catch (error) {
    console.warn('[launcher] failed to show quick editor:', error)
    return undefined
}
}

async function showPluginsPage(): Promise<void> {
  await requestOpenLauncherHostSurface('system-plugins')
}

async function showSettingsPage(): Promise<void> {
  await requestOpenLauncherHostSurface('system-settings')
}

/**
 * Build a PluginLauncherApi. The host owns the implementation, so plugins get a
 * stable, narrow surface. All text targets resolve against the active pane.
 */
export function createPluginAppsApi(options: PluginLauncherApiOptions = {}): PluginAppsApi {
  const permissions = () => options.pluginId && options.source
    ? getPluginPermissionSnapshot(options.source, options.pluginId, options.requestedPermissions ?? [])
    : undefined

  return {
    discoverApps: async () => {
      const snapshot = permissions()
      if (snapshot) requirePluginPermissions(snapshot, ['app.discover'])
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke('discover_installed_apps') as DiscoveredApp[]
    },
    cacheAppIcons: async (appIds: string[]) => {
      const snapshot = permissions()
      if (snapshot) requirePluginPermissions(snapshot, ['app.discover'])
      const { invoke } = await import('@tauri-apps/api/core')
      return await invoke('cache_installed_app_icons', { appIds }) as number
    },
    launchApp: async (appId: string) => {
      const snapshot = permissions()
      if (snapshot) requirePluginPermissions(snapshot, ['app.launch'])
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('launch_installed_app', { appId })
    },
  }
}

export function createPluginLauncherApi(options: PluginLauncherApiOptions = {}): PluginLauncherApi {
  return {
    getActiveText: () => readActiveText(),
    getSelectionText: () => readSelectionText(),
    getPaneSnapshot: () => {
      const snapshot = buildMergedPaneSnapshot()
      if (snapshot.paneIds.length === 0) return emptyPaneSnapshot()
      return snapshot
    },
    isPanePanelOpen: () => {
      return false
    },
    getClipboardText: () => readClipboard(),
    replaceActiveText: async (text: string) => {
      // Default host path: overwrite Quick Editor active pane with one-step rollback.
      // Pane-bound surfaces (quick-editor-command) override this with real in-place replace.
      await overwriteQuickEditorText(text, { source: 'replace-active' })
    },
    insertText: async (text: string) => {
      await createQuickEditorPane({ text })
    },
    // Real implementation lives in src/launcher/clipboard/globalLauncherApi.ts,
    // injected via useLauncherSession's makeApi for the global-launcher surface
    // (the only surface that ever calls this — see output.ts textResult()).
    // This fallback only exists so the interface is total; unreachable in practice.
    returnToLauncher: async (text: string) => {
      await createQuickEditorPane({ text })
    },
    copyText: async (text: string) => {
      await writeClipboard(text)
    },
    openUrl: async (url: string) => {
      await openExternalUrl(url)
    },
    showEditorWindow: openEditorWindow,
    showPluginsPage,
    showSettingsPage,
    createPane: (options) => createQuickEditorPane(options),
    dispatchEffects: () => {
      return { applied: [], errors: ['dispatchEffects is only available in the editor window'] }
    },
    showMessage: (message: string, level = 'info') => {
      useAppStore.getState().setLastCommandStatus({
        title: message,
        status: level === 'error' ? 'error' : 'success',
        message,
        updatedAt: Date.now(),
      })
    },
    openDiffPage: (payload) => {
      const original = payload?.original
      const modified = payload?.modified
      // Preserve pane binding metadata so TextDiffSurface can write edits back.
      const serializeSide = (side: typeof original) => ({
        sourceId: side?.sourceId,
        kind: side?.kind,
        paneId: side?.paneId,
        origin: side?.origin,
        title: side?.title ?? '',
        language: side?.language,
        text: side?.text ?? '',
      })
      const initialText = JSON.stringify({
        original: serializeSide(original),
        modified: serializeSide(modified),
      })
      openLauncherHostedPluginSurface({
        source: 'builtin',
        pluginId: 'text-diff',
        surfaceId: 'main',
        initialText,
      })
    },
    apps: createPluginAppsApi(options),
  }
}

export function createPluginLauncherStorage(options: PluginLauncherApiOptions = {}) {
  const source = options.source ?? 'builtin'
  const pluginId = options.pluginId ?? ''
  const permissions = options.pluginId && options.source
    ? getPluginPermissionSnapshot(options.source, options.pluginId, options.requestedPermissions ?? [])
    : undefined
  return createPluginPrivateStorage(source, pluginId, permissions)
}
