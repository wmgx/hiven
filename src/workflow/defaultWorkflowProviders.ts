import { createDefaultWorkContextSnapshot } from '../launcher/context/contextBroker'
import { focusSurfaceInstance } from '../surfaces/actions'
import { getSurfaceInstances } from '../surfaces/registry'
import { useAppStore } from '../store'
import { getHostAppWorkObjects, launchHostAppObject } from '../workspace/appLauncher/hostAppLauncher'
import { createEditorPane, openEditorPanel } from '../workspace/editorBridge'
import { showEditorWindow } from '../workspace/windowManager/editorWindow'
import { EDITOR_WINDOW_LABEL } from '../workspace/windowManager/windowLabels'
import { showPluginSurfaceWindow } from '../workspace/windowManager/pluginSurfaceWindows'
import { PLUGIN_SURFACE_PANEL_ID } from '../components/pluginSurface/PluginSurfacePanel'
import { registerClipboardHistoryWorkflowProvider } from './clipboardHistoryWorkflowProvider'
import { createDefaultOutputRouterContext, routeTextOutput } from './outputRouter'
import type { OutputTarget } from './outputTarget'
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
  registerWorkActionProvider(jsonClipboardActionProvider)
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

    const externalSelectionText = snapshot.externalSelection?.text?.trim()
    if (externalSelectionText) {
      objects.push({
        id: 'context:external-selected-text',
        type: 'text',
        title: 'Selected Text',
        subtitle: preview(externalSelectionText),
        icon: 'TextSelect',
        source: 'context.external-selection',
        text: externalSelectionText,
        updatedAt: snapshot.invocation.timestamp,
      })
    }

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
        windowLabel: EDITOR_WINDOW_LABEL,
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


const jsonClipboardActionProvider = {
  id: 'workflow.json-clipboard-actions',
  getActions: (input: WorkObject): WorkAction[] => {
    if (input.type !== 'clipboard' || input.contentType !== 'text') return []
    const text = textForObject(input)
    const formatted = tryFormatJsonClipboardText(text)
    if (!formatted) return []
    return [
      {
        id: 'workflow.format-json-clipboard',
        title: 'Format Clipboard JSON',
        icon: 'Braces',
        accepts: ['clipboard'],
        defaultOutputTarget: 'open-in-editor',
        run: async () => routeTextOutput(formatted, {
          kind: 'open-in-editor',
          language: 'json',
          title: 'Formatted Clipboard JSON',
        }, createDefaultOutputRouterContext()),
      },
      {
        id: 'workflow.copy-formatted-json',
        title: 'Copy Formatted JSON',
        icon: 'Copy',
        accepts: ['clipboard'],
        defaultOutputTarget: 'copy',
        run: async () => routeTextOutput(formatted, { kind: 'copy' }, createDefaultOutputRouterContext()),
      },
      {
        id: 'workflow.paste-formatted-json',
        title: 'Paste Formatted JSON',
        icon: 'ClipboardPaste',
        accepts: ['clipboard'],
        defaultOutputTarget: 'paste-to-foreground-app',
        requiresContext: [{ kind: 'foreground-app' }],
        run: async () => routeTextOutput(formatted, { kind: 'paste-to-foreground-app' }, createDefaultOutputRouterContext()),
      },
    ]
  },
}

const defaultTextActionProvider = {
  id: 'workflow.default-text-actions',
  getActions: (input: WorkObject, ctx: WorkContext): WorkAction[] => {
    const text = textForObject(input)
    if (!text) return []
    return [
      textAction('workflow.copy', 'Copy', 'Copy', 'copy', async () => (
        routeTextOutput(text, { kind: 'copy' }, createDefaultOutputRouterContext())
      )),
      {
        id: 'workflow.paste',
        title: 'Paste to Foreground App',
        icon: 'ClipboardPaste',
        accepts: ['text', 'clipboard', 'url'],
        defaultOutputTarget: 'paste-to-foreground-app',
        requiresContext: [{ kind: 'foreground-app' }],
        run: async () => routeTextOutput(text, { kind: 'paste-to-foreground-app' }, createDefaultOutputRouterContext()),
      },
      textAction('workflow.open-in-editor', 'Open in Editor', 'PanelTopOpen', 'open-in-editor', async () => (
        routeTextOutput(text, {
          kind: 'open-in-editor',
          language: languageForObject(input),
          title: input.title,
        }, createDefaultOutputRouterContext())
      )),
      {
        id: 'workflow.replace-selection',
        title: 'Replace Editor Selection',
        icon: 'Replace',
        accepts: ['text', 'clipboard', 'url'],
        defaultOutputTarget: 'replace-editor-selection',
        requiresContext: [{ kind: 'editor-pane' }],
        run: async () => routeTextOutput(text, {
          kind: 'replace-editor-selection',
          range: ctx.snapshot.editor?.selectionRange,
        }, createDefaultOutputRouterContext()),
      },
      {
        id: 'workflow.insert-editor',
        title: 'Insert into Editor',
        icon: 'TextCursorInput',
        accepts: ['text', 'clipboard', 'url'],
        defaultOutputTarget: 'insert-into-editor',
        requiresContext: [{ kind: 'editor-pane' }],
        run: async () => routeTextOutput(text, { kind: 'insert-into-editor' }, createDefaultOutputRouterContext()),
      },
      {
        id: 'workflow.draft-polite-reply',
        title: 'Draft Polite Reply',
        icon: 'MessageSquareReply',
        accepts: ['text', 'clipboard', 'url'],
        defaultOutputTarget: 'paste-to-foreground-app',
        requiresContext: [{ kind: 'foreground-app' }],
        run: async () => routeTextOutput(draftPoliteReply(text), {
          kind: 'paste-to-foreground-app',
        }, createDefaultOutputRouterContext()),
      },
      textAction('workflow.open-reply-draft-in-editor', 'Open Reply Draft in Editor', 'PanelTopOpen', 'open-in-editor', async () => (
        routeTextOutput(draftPoliteReply(text), {
          kind: 'open-in-editor',
          title: 'Reply Draft',
          language: 'markdown',
        }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.extract-todos', 'Extract Todos', 'ListTodo', 'open-in-editor', async () => (
        routeTextOutput(extractTodoDraft(text), {
          kind: 'open-in-editor',
          title: 'Extracted Todos',
          language: 'markdown',
        }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.open-json-surface', 'Open JSON Surface', 'Braces', 'open-plugin-surface', async () => (
        routeTextOutput(text, {
          kind: 'open-plugin-surface',
          source: 'builtin',
          pluginId: 'json',
          surfaceId: 'main',
          initialText: text,
        }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.attach-json-panel', 'Attach JSON Panel', 'Braces', 'attach-editor-panel', async () => (
        routeTextOutput(text, {
          kind: 'attach-editor-panel',
          panelId: PLUGIN_SURFACE_PANEL_ID,
          placement: 'right',
          pluginSurfaceTarget: {
            source: 'builtin',
            pluginId: 'json',
            surfaceId: 'main',
            initialText: text,
          },
        }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.translate-in-surface', 'Translate in Surface', 'Languages', 'open-plugin-surface', async () => (
        routeTextOutput(text, {
          kind: 'open-plugin-surface',
          source: 'builtin',
          pluginId: 'translate',
          surfaceId: 'main',
          initialText: text,
        }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.attach-translate-panel', 'Attach Translate Panel', 'PanelRightOpen', 'attach-editor-panel', async () => (
        routeTextOutput(text, {
          kind: 'attach-editor-panel',
          panelId: PLUGIN_SURFACE_PANEL_ID,
          placement: 'right',
          pluginSurfaceTarget: {
            source: 'builtin',
            pluginId: 'translate',
            surfaceId: 'main',
            initialText: text,
          },
        }, createDefaultOutputRouterContext())
      )),
      textAction('workflow.open-editor-with-translate-panel', 'Open Editor with Translate Panel', 'PanelRightOpen', 'open-in-editor', async () => {
        const paneId = await createEditorPane({
          text,
          title: input.title,
          language: languageForObject(input),
        })
        await openEditorPanel({
          panelId: PLUGIN_SURFACE_PANEL_ID,
          placement: 'right',
          paneId,
          inputs: {
            text,
            target: {
              source: 'builtin',
              pluginId: 'translate',
              surfaceId: 'main',
              initialText: text,
            },
          },
        })
        return { ok: true, text }
      }),
      textAction('workflow.save-shelf', 'Save to Shelf', 'Archive', 'save-to-shelf', async () => (
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
          await showEditorWindow()
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
    if (input.type === 'window' && input.id === EDITOR_WINDOW_LABEL) {
      return defaultEditorDocumentActionProvider.getActions({
        id: EDITOR_WINDOW_LABEL,
        type: 'editor-document',
        title: input.title,
        source: input.source,
        windowLabel: EDITOR_WINDOW_LABEL,
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
  defaultOutputTarget: OutputTarget['kind'],
  run: WorkAction['run'],
): WorkAction {
  return { id, title, icon, accepts: ['text', 'clipboard', 'url'], defaultOutputTarget, run }
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

export function tryFormatJsonClipboardText(text: string): string | null {
  const trimmed = text.trim()
  if (!trimmed) return null
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2)
  } catch {
    return null
  }
}

export function draftPoliteReply(text: string): string {
  const normalized = normalizeChatText(text)
  const hasQuestion = /[?？]\s*$/.test(normalized) || /\b(can|could|would|please|是否|能否|可以|需要|吗|么)\b/i.test(normalized)
  const acknowledgement = hasQuestion
    ? 'Thanks for the context. I can help with this.'
    : 'Thanks for the update. I have received it.'
  return [
    acknowledgement,
    '',
    `My understanding: ${normalized}`,
    '',
    'Next step: I will follow up after checking the details.',
  ].join('\n')
}

export function extractTodoDraft(text: string): string {
  const normalized = normalizeChatText(text)
  const lines = normalized
    .split(/(?:\n|[。；;])/)
    .map((line) => line.trim())
    .filter(Boolean)
  const candidates = lines.filter((line) => /todo|待办|action|跟进|确认|处理|修复|完成|需要|please|请/i.test(line))
  const items = (candidates.length > 0 ? candidates : [normalized]).slice(0, 8)
  return ['Action items:', ...items.map((item) => `- TODO: ${item}`)].join('\n')
}

function normalizeChatText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}
