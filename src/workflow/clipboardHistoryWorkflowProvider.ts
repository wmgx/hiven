import { createPluginPrivateStorage } from '../workspace/pluginStorage'
import { createClipboardHistoryRepository } from '../plugins/clipboard-history/storage/clipboardHistoryRepository'
import { registerWorkObjectProvider } from './workflowRegistry'
import type { WorkObjectProvider, WorkObject } from './workObject'

let registered = false

export function registerClipboardHistoryWorkflowProvider(): void {
  if (registered) return
  registered = true
  registerWorkObjectProvider(clipboardHistoryWorkObjectProvider)
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
