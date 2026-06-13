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
import type { FluxEffect, SerializedRange } from '../types'
import type { PluginLauncherApi } from './types'

function readActiveText(): string {
  return useWorkspaceStore.getState().getActivePaneText()
}

function readSelectionText(): string {
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

async function showMainPanel(): Promise<void> {
  const effects: FluxEffect[] = [{ type: 'app.showMainPanel' }]
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    try {
      const [{ emitTo }, { invoke }] = await Promise.all([
        import('@tauri-apps/api/event'),
        import('@tauri-apps/api/core'),
      ])
      await emitTo('main', 'hiven://show-main-panel')
      await invoke('show_and_focus_window')
      return
    } catch (error) {
      console.warn('[launcher] failed to show main panel via Tauri:', error)
    }
  }
  applyEffects(effects)
}

/**
 * Build a PluginLauncherApi. The host owns the implementation, so plugins get a
 * stable, narrow surface. All text targets resolve against the active pane.
 */
export function createPluginLauncherApi(): PluginLauncherApi {
  return {
    getActiveText: () => readActiveText(),
    getSelectionText: () => readSelectionText(),
    getPaneSnapshot: () => {
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
      const state = useWorkspaceStore.getState()
      const existing = state.panelInstancesV2[panelId]
      return existing?.scope?.type === 'pane' && existing.scope.paneId === state.activePaneId
    },
    getClipboardText: () => readClipboard(),
    replaceActiveText: async (text: string) => {
      const range = activeSelectionRange()
      const paneId = useWorkspaceStore.getState().activePaneId
      // If there is a selection, replace only that range; otherwise replace all.
      const effects: FluxEffect[] = range
        ? [{ type: 'text.replace', target: { paneId, range }, text }]
        : [{ type: 'text.replace', target: 'active-input', text }]
      applyEffects(effects)
    },
    insertText: async (text: string) => {
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
    showMainPanel,
    createPane: (options) => useWorkspaceStore.getState().createPane(options),
    dispatchEffects: (effects: FluxEffect[]) => applyEffects(effects),
    showMessage: (message: string, level = 'info') => {
      useAppStore.getState().setLastCommandStatus({
        title: message,
        status: level === 'error' ? 'error' : 'success',
        message,
        updatedAt: Date.now(),
      })
    },
  }
}
