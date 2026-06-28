import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import { createClipboardHistoryRepository } from '../plugins/clipboard-history/storage/clipboardHistoryRepository'
import { registerWorkActionProvider, registerWorkObjectProvider } from './workflowRegistry'
import { createDefaultOutputRouterContext, routeTextOutput } from './outputRouter'
import type { WorkAction, WorkContext } from './workAction'
import type { WorkObjectProvider, WorkObject } from './workObject'

let registered = false

export function registerClipboardHistoryWorkflowProvider(): void {
  if (registered) return
  registered = true
  registerWorkObjectProvider(clipboardHistoryWorkObjectProvider)
  registerWorkActionProvider(clipboardHistoryActionProvider)
}

export const clipboardHistoryWorkObjectProvider: WorkObjectProvider = {
  id: 'clipboard-history.work-objects',
  collect: async () => {
    const storage = createPluginPrivateStorage('builtin', 'clipboard-history')
    const items = await createClipboardHistoryRepository(storage).getAllItems()
    return items.slice(0, 20).flatMap((item): WorkObject[] => {
      if (item.kind === 'text') {
        return [{
          id: `clipboard-history:${item.id}`,
          type: 'clipboard',
          title: 'Clipboard History Item',
          subtitle: item.sourceApp ? `${item.sourceApp} · ${item.preview}` : item.preview,
          icon: 'Clipboard',
          source: 'plugin.clipboard-history',
          contentType: 'text',
          preview: item.text,
          createdAt: item.firstCopiedAt,
          updatedAt: item.lastCopiedAt,
        }]
      }
      if (item.kind === 'files') {
        return [{
          id: `clipboard-history:${item.id}`,
          type: 'clipboard',
          title: 'Clipboard Files',
          subtitle: item.fileNames.join(', '),
          icon: 'Files',
          source: 'plugin.clipboard-history',
          contentType: 'files',
          preview: item.paths.join('\n'),
          createdAt: item.firstCopiedAt,
          updatedAt: item.lastCopiedAt,
        }]
      }
      return [{
        id: `clipboard-history:${item.id}`,
        type: 'clipboard',
        title: 'Clipboard Image',
        subtitle: item.contentType,
        icon: 'Image',
        source: 'plugin.clipboard-history',
        contentType: 'image',
        preview: item.previewBlobId,
        createdAt: item.firstCopiedAt,
        updatedAt: item.lastCopiedAt,
      }]
    })
  },
}

const clipboardHistoryActionProvider = {
  id: 'clipboard-history.work-actions',
  getActions: (input: WorkObject, _ctx: WorkContext): WorkAction[] => {
    if (input.type !== 'clipboard' || input.source !== 'plugin.clipboard-history' || input.contentType !== 'text') return []
    const text = input.preview ?? ''
    if (!text) return []
    return [
      {
        id: 'workflow.paste-clipboard-history-item',
        title: 'Paste Clipboard History Item',
        icon: 'ClipboardPaste',
        accepts: ['clipboard'],
        defaultOutputTarget: 'paste-to-foreground-app',
        run: async () => routeTextOutput(text, { kind: 'paste-to-foreground-app' }, createDefaultOutputRouterContext()),
      },
      {
        id: 'workflow.open-clipboard-history-item-in-editor',
        title: 'Open Clipboard History Item in Editor',
        icon: 'PanelTopOpen',
        accepts: ['clipboard'],
        defaultOutputTarget: 'open-in-editor',
        run: async () => routeTextOutput(text, {
          kind: 'open-in-editor',
          title: input.title,
        }, createDefaultOutputRouterContext()),
      },
      {
        id: 'workflow.copy-clipboard-history-item',
        title: 'Copy Clipboard History Item',
        icon: 'Copy',
        accepts: ['clipboard'],
        defaultOutputTarget: 'copy',
        run: async () => routeTextOutput(text, { kind: 'copy' }, createDefaultOutputRouterContext()),
      },
    ]
  },
}
