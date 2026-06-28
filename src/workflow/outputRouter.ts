import type { ActionResult, OutputTarget } from './outputTarget'
import { createPluginPaste } from '../workspace/pluginPaste'
import { applyEffects } from '../workspace/effectRunner'
import { createEditorPane, insertIntoEditor, openEditorPanel, replaceEditorSelection } from '../workspace/editorBridge'
import { createPluginLauncherApi } from '../workspace/launcher/pluginApi'
import { showPluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'

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
    replaceEditorSelection: (text, options) => replaceEditorSelection(text, {
      paneId: options?.paneId,
      range: options?.range,
    }),
    insertIntoEditor: (text, options) => insertIntoEditor(text, {
      paneId: options?.paneId,
    }),
    openInEditor: async (text, options) => {
      await createEditorPane({
        text,
        title: options?.title,
        language: options?.language,
      })
    },
    openPluginSurface: async (options) => {
      await showPluginSurfaceWindow({
        source: options.source ?? 'builtin',
        pluginId: options.pluginId,
        surfaceId: options.surfaceId,
      })
    },
    attachEditorPanel: async (text, options) => {
      await openEditorPanel({
        panelId: options.panelId,
        placement: options.placement,
        inputs: { text, target: options.pluginSurfaceTarget },
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
