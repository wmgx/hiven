import type { WorkObject } from './workObject'

export function resolveIconForWorkObject(object: WorkObject): string {
  if (object.icon) return object.icon
  switch (object.type) {
    case 'text':
      return 'Text'
    case 'clipboard':
      return 'Clipboard'
    case 'app':
      return 'AppWindow'
    case 'window':
      return 'PanelTop'
    case 'file':
      return 'FileText'
    case 'url':
      return 'Link'
    case 'plugin-surface':
      return 'PanelTopOpen'
    case 'editor-document':
      return 'PanelTop'
  }
}
