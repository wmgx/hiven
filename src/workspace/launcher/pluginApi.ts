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

import { useWorkspaceStore } from '../workspaceStore'
import { runtimeRegistry } from '../runtimeRegistry'
import { applyEffects, openExternalUrl } from '../effectRunner'
import { useAppStore } from '../../store'
import { requestOpenLauncherHostSurface } from '../launcherHostSurfaceBridge'
import { createPluginPrivateStorage } from '../pluginStorage'
import { getPluginPermissionSnapshot, requirePluginPermissions } from '../pluginPermissions'
import { showEditorWindow } from '../windowManager/editorWindow'
import {
  createEditorPane,
  getActiveEditorContextSnapshot,
  getActiveEditorPaneSnapshot,
  insertIntoEditor,
  replaceEditorSelection,
} from '../editorBridge'
import type { FluxEffect, SerializedRange } from '../types'
import type { PluginPermission } from '../pluginTypes'
import type { PluginSettingsSource } from '../pluginSettingsStore'
import type { DiscoveredApp, PluginAppsApi, PluginLauncherApi } from './types'

export type PluginLauncherApiOptions = {
  pluginId?: string
  source?: PluginSettingsSource
  requestedPermissions?: readonly PluginPermission[]
}

function readActiveText(): string {
  if (!isEditorWindowRuntime()) {
    return getActiveEditorContextSnapshot()?.activeText ?? ''
  }
  return useWorkspaceStore.getState().getActivePaneText()
}

function readSelectionText(): string {
  if (!isEditorWindowRuntime()) {
    return getActiveEditorContextSnapshot()?.selectedText ?? ''
  }
  const state = useWorkspaceStore.getState()
  const editor = runtimeRegistry.getCodeEditor(state.activePaneId)
  if (!editor) return ''
  const sel = editor.getSelection?.()
  if (!sel || sel.isEmpty?.()) return ''
  return editor.getModel?.()?.getValueInRange(sel) ?? ''
}

function activeSelectionRange(): SerializedRange | undefined {
  const state = useWorkspaceStore.getState()
  const editor = runtimeRegistry.getCodeEditor(state.activePaneId)
  if (!editor) return undefined
  const sel = editor.getSelection?.()
  if (!sel || sel.isEmpty?.()) return undefined
  return {
    startLineNumber: sel.startLineNumber,
    startColumn: sel.startColumn,
    endLineNumber: sel.endLineNumber,
    endColumn: sel.endColumn,
  }
}

function activeEditorTextTarget(): { paneId?: string; range?: SerializedRange } {
  const snapshot = getActiveEditorContextSnapshot()
  if (!snapshot) return {}
  return {
    paneId: snapshot.activePaneId,
    range: snapshot.selectionRange,
  }
}

function emptyPaneSnapshot() {
  return {
    activePaneId: '',
    previousActivePaneId: undefined,
    paneIds: [],
    panes: {},
    renderers: {},
  }
}

function isEditorWindowRuntime(): boolean {
  try {
    return new URLSearchParams(window.location.search).get('window') === 'editor'
  } catch {
    return false
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

async function openEditorWindow(): Promise<void> {
  try {
    await showEditorWindow()
  } catch (error) {
    console.warn('[launcher] failed to show editor window:', error)
  }
}

async function showPluginsPage(): Promise<void> {
  await requestOpenLauncherHostSurface('plugins')
}

async function showSettingsPage(): Promise<void> {
  await requestOpenLauncherHostSurface('settings')
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
      if (!isEditorWindowRuntime()) {
        const snapshot = getActiveEditorPaneSnapshot()
        if (!snapshot) return emptyPaneSnapshot()
        return {
          activePaneId: snapshot.activePaneId,
          previousActivePaneId: snapshot.previousActivePaneId,
          paneIds: snapshot.paneIds,
          panes: snapshot.panes,
          renderers: {},
        }
      }
      const state = useWorkspaceStore.getState()
      return {
        activePaneId: state.activePaneId,
        previousActivePaneId: state.previousActivePaneId,
        paneIds: state.paneOrder,
        panes: Object.fromEntries(
          state.paneOrder.map((paneId) => [
            paneId,
            {
              title: state.panes[paneId]?.title,
              language: state.panes[paneId]?.language,
              stickyScroll: state.panes[paneId]?.stickyScroll === true,
            },
          ]),
        ),
        renderers: Object.fromEntries(
          Object.entries(state.paneRenderers).map(([paneId, renderer]) => [
            paneId,
            {
              rendererId: renderer.rendererId,
              ownerPluginId: renderer.ownerPluginId,
              ownerContributionId: renderer.ownerContributionId,
            },
          ]),
        ),
      }
    },
    isPanePanelOpen: (panelId: string) => {
      if (!isEditorWindowRuntime()) return false
      const state = useWorkspaceStore.getState()
      const existing = state.panelInstancesV2[panelId]
      return existing?.scope?.type === 'pane' && existing.scope.paneId === state.activePaneId
    },
    getClipboardText: () => readClipboard(),
    replaceActiveText: async (text: string) => {
      if (!isEditorWindowRuntime()) {
        await replaceEditorSelection(text, activeEditorTextTarget())
        return
      }
      const range = activeSelectionRange()
      const paneId = useWorkspaceStore.getState().activePaneId
      // If there is a selection, replace only that range; otherwise replace all.
      const effects: FluxEffect[] = range
        ? [{ type: 'text.replace', target: { paneId, range }, text }]
        : [{ type: 'text.replace', target: 'active-input', text }]
      applyEffects(effects)
    },
    insertText: async (text: string) => {
      if (!isEditorWindowRuntime()) {
        await insertIntoEditor(text, activeEditorTextTarget())
        return
      }
      const range = activeSelectionRange()
      const paneId = useWorkspaceStore.getState().activePaneId
      // Insert at cursor: a zero-width replace at the selection start, or append.
      if (range) {
        const collapsed: SerializedRange = {
          startLineNumber: range.startLineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.startLineNumber,
          endColumn: range.startColumn,
        }
        applyEffects([{ type: 'text.replace', target: { paneId, range: collapsed }, text }])
      } else {
        const current = readActiveText()
        applyEffects([{ type: 'text.replace', target: 'active-input', text: current + text }])
      }
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
    createPane: (options) => createEditorPane(options),
    dispatchEffects: (effects: FluxEffect[]) => {
      if (!isEditorWindowRuntime()) {
        return { applied: [], errors: ['dispatchEffects is only available in the editor window'] }
      }
      return applyEffects(effects)
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
      useWorkspaceStore.getState().openDiffPage(payload)
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
