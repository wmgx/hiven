import { createDefaultWorkContextSnapshot } from '../launcher/context/contextBroker'
import { focusSurfaceInstance } from '../surfaces/actions'
import { getSurfaceInstances } from '../surfaces/registry'
import { useAppStore } from '../store'
import { getHostAppWorkObjects, launchHostAppObject } from '../workspace/appLauncher/hostAppLauncher'
import { requestOpenEditorWindow } from '../workspace/editorWindow'
import { showPluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import { PLUGIN_SURFACE_PANEL_ID } from '../components/pluginSurface/PluginSurfacePanel'
import { registerClipboardHistoryWorkflowProvider } from './clipboardHistoryWorkflowProvider'
import { createDefaultOutputRouterContext, routeTextOutput } from './outputRouter'
import { registerWorkActionProvider, registerWorkObjectProvider } from './workflowRegistry'
import type { WorkAction, WorkContext } from './workAction'
import type { WorkObject, WorkObjectProvider } from './workObject'

let registered = false

export function registerDefaultWorkflowProviders(): void {
  if (registered) return
  registered = true
  registerClipboardHistoryWorkflowProvider()
  registerWorkObjectProvider(currentContextObjectProvider)
  registerWorkObjectProvider(hostAppObjectProvider)
  registerWorkObjectProvider(surfaceObjectProvider)
  registerWorkActionProvider(defaultTextActionProvider)
  registerWorkActionProvider(defaultEditorDocumentActionProvider)
  registerWorkActionProvider(defaultAppActionProvider)
  registerWorkActionProvider(defaultSurfaceActionProvider)
}

export const currentContextObjectProvider: WorkObjectProvider = {
  id: 'workflow.context-objects',
  collect: async () => {
    const snapshot = await createDefaultWorkContextSnapshot('global-hotkey')
    const objects: WorkObject[] = []

    const selectedText = snapshot.editor?.selectedText?.trim()
    if (selectedText) {
      objects.push({
        id: 'context:selected-text',
        type: 'text',
        title: 'Selected Text',
        subtitle: preview(selectedText),
        icon: 'TextSelect',
        source: 'context.editor-selection',
        text: selectedText,
        language: snapshot.editor?.language,
        updatedAt: snapshot.invocation.timestamp,
      })
    }

    const clipboardText = snapshot.clipboard?.kind === 'text'
      ? snapshot.clipboard.text?.trim()
      : ''
    if (clipboardText) {
      objects.push({
        id: 'context:clipboard-text',
        type: 'clipboard',
        title: 'Clipboard Text',
        subtitle: preview(clipboardText),
        icon: 'Clipboard',
        source: 'context.clipboard',
        contentType: 'text',
        preview: clipboardText,
        updatedAt: snapshot.invocation.timestamp,
      })
      objects.push({
        id: 'context:clipboard-text-as-text',
        type: 'text',
        title: 'Clipboard as Text',
        subtitle: preview(clipboardText),
        icon: 'Text',
        source: 'context.clipboard',
        text: clipboardText,
        updatedAt: snapshot.invocation.timestamp,
      })
    }

    if (snapshot.editor) {
      objects.push({
        id: `editor:${snapshot.editor.activePaneId}`,
        type: 'editor-document',
        title: 'Current Editor Document',
        subtitle: snapshot.editor.language ?? snapshot.editor.activePaneId,
        icon: 'PanelTop',
        source: 'context.editor',
        windowLabel: 'editor',
        paneId: snapshot.editor.activePaneId,
        language: snapshot.editor.language,
        updatedAt: snapshot.invocation.timestamp,
      })
    }

    return objects
  },
}

export const hostAppObjectProvider: WorkObjectProvider = {
  id: 'workflow.host-app-objects',
  collect: () => getHostAppWorkObjects('', useAppStore.getState().locale),
}

export const surfaceObjectProvider: WorkObjectProvider = {
  id: 'workflow.surface-objects',
  collect: () => getSurfaceInstances()
    .filter((surface) => surface.state !== 'destroyed')
    .map((surface): WorkObject => {
      if (surface.kind === 'plugin-surface' && surface.pluginId && surface.surfaceId) {
        return {
          id: surface.id,
          type: 'plugin-surface',
          title: surface.title,
          subtitle: surface.windowLabel,
          icon: 'PanelTopOpen',
          source: 'surface-registry',
          pluginId: surface.pluginId,
          surfaceId: surface.surfaceId,
          sourceKind: surface.id.split(':')[1] === 'installed' || surface.id.split(':')[1] === 'dev'
            ? surface.id.split(':')[1] as 'installed' | 'dev'
            : 'builtin',
          windowLabel: surface.windowLabel,
          updatedAt: surface.lastActiveAt,
        }
      }
      return {
        id: surface.id,
        type: 'window',
        title: surface.title,
        subtitle: surface.kind,
        icon: 'PanelTop',
        source: 'surface-registry',
        windowTitle: surface.title,
        updatedAt: surface.lastActiveAt,
      }
    }),
}

const defaultTextActionProvider = {
  id: 'workflow.default-text-actions',
  getActions: (input: WorkObject, ctx: WorkContext): WorkAction[] => {
    const text = textForObject(input)
    if (!text) return []
    return [
      textAction('workflow.copy', 'Copy', 'Copy', async () => (
        routeTextOutput(text, { kind: 'copy' }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.paste', 'Paste to Foreground App', 'ClipboardPaste', async () => (
        routeTextOutput(text, { kind: 'paste-to-foreground-app' }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.open-in-editor', 'Open in Editor', 'PanelTopOpen', async () => (
        routeTextOutput(text, {
          kind: 'open-in-editor',
          language: languageForObject(input),
          title: input.title,
        }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.replace-selection', 'Replace Editor Selection', 'Replace', async () => (
        routeTextOutput(text, { kind: 'replace-editor-selection', range: ctx.snapshot.editor?.selectionRange }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.insert-editor', 'Insert into Editor', 'TextCursorInput', async () => (
        routeTextOutput(text, { kind: 'insert-into-editor' }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.save-shelf', 'Save to Shelf', 'Archive', async () => (
        routeTextOutput(text, { kind: 'save-to-shelf' }, createDefaultOutputRouterContext())
      )),
    ]
  },
}

const defaultEditorDocumentActionProvider = {
  id: 'workflow.default-editor-document-actions',
  getActions: (input: WorkObject): WorkAction[] => {
    if (input.type !== 'editor-document') return []
    return [
      {
        id: 'workflow.focus-editor-document',
        title: 'Focus Editor',
        icon: 'PanelTopOpen',
        accepts: ['editor-document'],
        run: async () => {
          await requestOpenEditorWindow()
          return { ok: true }
        },
      },
    ]
  },
}

const defaultAppActionProvider = {
  id: 'workflow.default-app-actions',
  getActions: (input: WorkObject): WorkAction[] => {
    if (input.type !== 'app' || !input.bundleId) return []
    return [
      {
        id: 'workflow.open-app',
        title: 'Open App',
        icon: 'ExternalLink',
        accepts: ['app'],
        run: async () => {
          await launchHostAppObject(input.bundleId ?? '')
          return { ok: true }
        },
      },
    ]
  },
}

const defaultSurfaceActionProvider = {
  id: 'workflow.default-surface-actions',
  getActions: (input: WorkObject): WorkAction[] => {
    if (input.type === 'plugin-surface') {
      return [
        {
          id: 'workflow.focus-plugin-surface',
          title: 'Focus Surface',
          icon: 'PanelTopOpen',
          accepts: ['plugin-surface'],
          run: async () => {
            const focused = await focusSurfaceInstance(input.id)
            return focused ? { ok: true } : { ok: false, error: 'Surface not found' }
          },
        },
        {
          id: 'workflow.open-plugin-surface-window',
          title: 'Open Surface Window',
          icon: 'PanelTopOpen',
          accepts: ['plugin-surface'],
          run: async () => {
            await showPluginSurfaceWindow({
              source: input.sourceKind,
              pluginId: input.pluginId,
              surfaceId: input.surfaceId,
            })
            return { ok: true }
          },
        },
        {
          id: 'workflow.attach-plugin-surface-editor-panel',
          title: 'Attach to Editor Panel',
          icon: 'PanelRightOpen',
          accepts: ['plugin-surface'],
          defaultOutputTarget: 'attach-editor-panel',
          run: async () => {
            await routeTextOutput('', {
              kind: 'attach-editor-panel',
              panelId: PLUGIN_SURFACE_PANEL_ID,
              placement: 'right',
              pluginSurfaceTarget: {
                source: input.sourceKind,
                pluginId: input.pluginId,
                surfaceId: input.surfaceId,
              },
            }, createDefaultOutputRouterContext())
            return { ok: true }
          },
        },
      ]
    }
    if (input.type === 'window' && input.id === 'editor') {
      return defaultEditorDocumentActionProvider.getActions({
        id: 'editor',
        type: 'editor-document',
        title: input.title,
        source: input.source,
        windowLabel: 'editor',
        paneId: '',
      })
    }
    if (input.type === 'window') {
      return [
        {
          id: 'workflow.focus-window-surface',
          title: 'Focus Window',
          icon: 'PanelTopOpen',
          accepts: ['window'],
          run: async () => {
            const focused = await focusSurfaceInstance(input.id)
            return focused ? { ok: true } : { ok: false, error: 'Window surface not found' }
          },
        },
      ]
    }
    return []
  },
}

function textAction(
  id: string,
  title: string,
  icon: string,
  run: WorkAction['run'],
): WorkAction {
  return { id, title, icon, accepts: ['text', 'clipboard', 'url'], run }
}

function textForObject(input: WorkObject): string {
  if (input.type === 'text') return input.text
  if (input.type === 'clipboard' && input.contentType === 'text') return input.preview ?? ''
  if (input.type === 'url') return input.url
  return ''
}

function languageForObject(input: WorkObject): string | undefined {
  if (input.type === 'text') return input.language
  if (input.type === 'editor-document') return input.language
  return undefined
}

function preview(text: string): string {
  return text.replace(/\s+/g, ' ').slice(0, 120)
}
