import { useEffect, useState } from 'react'
import { useAppStore } from '../store'
import { readLocalEditorContextSnapshot } from '../launcher/context/contextBroker'
import { closeEditorWindow } from '../workspace/windowManager/editorWindow'
import { EDITOR_WINDOW_LABEL } from '../workspace/windowManager/windowLabels'
import { markSurfaceInstanceState, upsertSurfaceInstance } from '../surfaces/registry'
import {
  registerActiveEditorContext,
  registerEditorBridgeHandlers,
  updateActivePaneSnapshot,
  type EditorBridgeCreatePaneInput,
  type EditorBridgePanelInput,
  type EditorBridgeTextInput,
} from '../workspace/editorBridge'
import { applyEffects } from '../workspace/effectRunner'
import { ensurePluginRuntimeReady } from '../workspace/pluginRuntimeBootstrap'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import type { SerializedRange } from '../workspace/types'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { EditorView } from '../views/EditorView'
import { CommandPalette } from './CommandPalette'
import { PluginSettingsDialog } from './PluginSettingsDialog'
import './EditorWindow.css'
import '../panels/register'

export function EditorWindow() {
  const theme = useAppStore((s) => s.settings.theme)
  const fontSize = useAppStore((s) => s.settings.fontSize)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    upsertSurfaceInstance({
      id: EDITOR_WINDOW_LABEL,
      kind: 'editor',
      windowLabel: EDITOR_WINDOW_LABEL,
      title: 'Hiven Editor',
      state: 'visible',
      canReceiveText: true,
      canProvideText: true,
      canAttachToEditor: true,
    })
    const onPageHide = () => markSurfaceInstanceState(EDITOR_WINDOW_LABEL, 'destroyed')
    window.addEventListener('pagehide', onPageHide)
    return () => {
      window.removeEventListener('pagehide', onPageHide)
      markSurfaceInstanceState(EDITOR_WINDOW_LABEL, 'hidden')
    }
  }, [])

  useEffect(() => {
    let disposed = false
    ensurePluginRuntimeReady()
      .catch((err) => {
        if (!disposed) setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (!disposed) setReady(true)
      })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    if (!ready || error) return
    let disposed = false
    let cleanup: (() => void) | undefined
    registerEditorBridgeHandlers({
      getEditorContext: () => readLocalEditorContextSnapshot(),
      createEditorPane: (input) => applyCreateEditorPane(input),
      replaceEditorSelection: (input) => applyReplaceEditorSelection(input),
      insertIntoEditor: (input) => applyInsertIntoEditor(input),
      openEditorPanel: (input) => applyOpenEditorPanel(input),
    })
      .then((registeredCleanup) => {
        if (disposed) registeredCleanup()
        else cleanup = registeredCleanup
      })
      .catch((err) => {
        console.warn('[hiven] Failed to register editor bridge handlers:', err)
      })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [ready, error])

  useEffect(() => {
    if (!ready || error) return
    publishEditorSnapshots()
    const unsubscribe = useWorkspaceStore.subscribe(() => {
      publishEditorSnapshots()
    })
    return unsubscribe
  }, [ready, error])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const hasPrimary = event.metaKey || event.ctrlKey
      if (!hasPrimary || event.key.toLowerCase() !== 'w') return
      event.preventDefault()
      event.stopPropagation()
      void closeCurrentWindow()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  return (
    <div className="flux-spatial-shell editor-window-shell" data-theme={theme} style={{ fontSize }}>
      <div className="editor-window-chrome" data-tauri-drag-region>
        <div className="editor-window-title" data-tauri-drag-region>Hiven · 编辑器</div>
        <button className="editor-window-close" type="button" onClick={() => { void closeCurrentWindow() }}>×</button>
      </div>
      <div className="editor-window-content">
        {!ready ? (
          <WindowStateMessage title="Loading editor…" />
        ) : error ? (
          <WindowStateMessage title="Editor runtime failed" message={error} />
        ) : (
          <EditorView />
        )}
      </div>
      <CommandPalette />
      <PluginSettingsDialog />
    </div>
  )
}

function applyCreateEditorPane(input: EditorBridgeCreatePaneInput): string | undefined {
  const workspace = useWorkspaceStore.getState()
  return workspace.createPane({
    text: input.text ?? '',
    title: input.title,
    language: input.language,
    focus: input.focus ?? true,
    direction: input.direction ?? 'right',
  })
}

function applyReplaceEditorSelection(input: EditorBridgeTextInput): void {
  const workspace = useWorkspaceStore.getState()
  const paneId = input.paneId ?? workspace.activePaneId
  const range = input.range ?? getActiveSelectionRange(paneId)
  applyEffects([{
    type: 'text.replace',
    target: range ? { paneId, range } : 'active-input',
    text: input.text,
  }])
}

function applyInsertIntoEditor(input: EditorBridgeTextInput): void {
  const workspace = useWorkspaceStore.getState()
  const paneId = input.paneId ?? workspace.activePaneId
  const range = input.range ?? getActiveSelectionRange(paneId)
  if (range) {
    applyEffects([{
      type: 'text.replace',
      target: {
        paneId,
        range: {
          startLineNumber: range.startLineNumber,
          startColumn: range.startColumn,
          endLineNumber: range.startLineNumber,
          endColumn: range.startColumn,
        },
      },
      text: input.text,
    }])
    return
  }

  const current = workspace.panes[paneId]?.text ?? ''
  applyEffects([{
    type: 'text.replace',
    target: { paneId },
    text: current + input.text,
  }])
}

function applyOpenEditorPanel(input: EditorBridgePanelInput): void {
  const workspace = useWorkspaceStore.getState()
  workspace.openPanelV2({
    panelId: input.panelId,
    placement: input.placement,
    inputs: input.inputs,
    title: input.title,
    scope: { type: 'pane', paneId: workspace.activePaneId },
  })
}

function getActiveSelectionRange(paneId: string): SerializedRange | undefined {
  const editor = runtimeRegistry.getCodeEditor(paneId)
  const selection = editor?.getSelection?.()
  if (!selection || selection.isEmpty?.()) return undefined
  return {
    startLineNumber: selection.startLineNumber,
    startColumn: selection.startColumn,
    endLineNumber: selection.endLineNumber,
    endColumn: selection.endColumn,
  }
}

function publishEditorSnapshots(): void {
  const context = readLocalEditorContextSnapshot()
  if (context) registerActiveEditorContext(context)
  const state = useWorkspaceStore.getState()
  updateActivePaneSnapshot({
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
  })
}

async function closeCurrentWindow(): Promise<void> {
  if ((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__) {
    await closeEditorWindow().catch(() => undefined)
    return
  }
  window.close()
}

function WindowStateMessage({ title, message }: { title: string; message?: string }) {
  return (
    <div className="editor-window-message">
      <div>{title}</div>
      {message && <small>{message}</small>}
    </div>
  )
}
