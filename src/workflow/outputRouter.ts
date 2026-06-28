import type { ActionResult, OutputTarget } from './outputTarget'
import { useAppStore } from '../store'
import { createPluginPaste } from '../workspace/pluginPaste'
import { useWorkspaceStore } from '../workspace/workspaceStore'
import { applyEffects } from '../workspace/effectRunner'
import { requestOpenEditorWindow } from '../workspace/editorWindow'
import { createPluginLauncherApi } from '../workspace/launcher/pluginApi'

export type OutputRouterContext = {
  copy(text: string): Promise<void> | void
  pasteToForegroundApp(text: string): Promise<void> | void
  replaceEditorSelection(text: string, options?: Extract<OutputTarget, { kind: 'replace-editor-selection' }>): Promise<void> | void
  insertIntoEditor(text: string, options?: Extract<OutputTarget, { kind: 'insert-into-editor' }>): Promise<void> | void
  openInEditor(text: string, options?: Extract<OutputTarget, { kind: 'open-in-editor' }>): Promise<void> | void
  openPluginSurface(options: Extract<OutputTarget, { kind: 'open-plugin-surface' }>): Promise<void> | void
  attachEditorPanel(text: string, options: Extract<OutputTarget, { kind: 'attach-editor-panel' }>): Promise<void> | void
  saveToShelf(text: string): Promise<void> | void
}

export function createDefaultOutputRouterContext(): OutputRouterContext {
  const launcherApi = createPluginLauncherApi()
  return {
    copy: (text) => launcherApi.copyText(text),
    pasteToForegroundApp: async (text) => {
      await createPluginPaste().pasteText(text)
    },
    replaceEditorSelection: (text) => launcherApi.replaceActiveText(text),
    insertIntoEditor: (text) => launcherApi.insertText(text),
    openInEditor: async (text, options) => {
      await requestOpenEditorWindow()
      useWorkspaceStore.getState().createPane({
        text,
        title: options?.title,
        language: options?.language,
        focus: true,
      })
    },
    openPluginSurface: (options) => {
      useAppStore.getState().openPluginSurfaceTool({
        source: options.source ?? 'builtin',
        pluginId: options.pluginId,
        surfaceId: options.surfaceId,
      })
    },
    attachEditorPanel: async (text, options) => {
      await requestOpenEditorWindow()
      const state = useWorkspaceStore.getState()
      state.openPanelV2({
        panelId: options.panelId,
        placement: options.placement,
        inputs: { text, target: options.pluginSurfaceTarget },
        scope: { type: 'pane', paneId: state.activePaneId },
      })
    },
    saveToShelf: (text) => {
      applyEffects([{
        type: 'panel.open',
        panelId: 'workflow-output-shelf',
        placement: 'right',
        scope: { type: 'workspace' },
        title: 'Output Shelf',
        props: { text },
      }])
    },
  }
}

export async function routeTextOutput(
  text: string,
  target: OutputTarget,
  ctx: OutputRouterContext,
): Promise<ActionResult> {
  switch (target.kind) {
    case 'copy':
      await ctx.copy(text)
      return { ok: true, text, outputTarget: target }
    case 'paste-to-foreground-app':
      await ctx.pasteToForegroundApp(text)
      return { ok: true, text, outputTarget: target }
    case 'replace-editor-selection':
      await ctx.replaceEditorSelection(text, target)
      return { ok: true, text, outputTarget: target }
    case 'insert-into-editor':
      await ctx.insertIntoEditor(text, target)
      return { ok: true, text, outputTarget: target }
    case 'open-in-editor':
      await ctx.openInEditor(text, target)
      return { ok: true, text, outputTarget: target }
    case 'open-plugin-surface':
      await ctx.openPluginSurface(target)
      return { ok: true, text, outputTarget: target }
    case 'attach-editor-panel':
      await ctx.attachEditorPanel(text, target)
      return { ok: true, text, outputTarget: target }
    case 'save-to-shelf':
      await ctx.saveToShelf(text)
      return { ok: true, text, outputTarget: target }
  }
}
