import type { LauncherItem } from './types'
import { requestOpenEditorWindow } from '../editorWindow'

export function getEditorWindowItems(): LauncherItem[] {
  return [
    {
      systemKey: 'host:window:editor',
      kind: 'host',
      display: {
        title: 'Open Editor Window',
        titleI18n: { zh: '打开编辑器窗口' },
        subtitle: 'Open standalone editor',
        subtitleI18n: { zh: '打开独立编辑器' },
        icon: 'PanelTopOpen',
        aliases: ['editor', 'scratch', 'text', '编辑器', '文本', '草稿'],
      },
      behavior: { type: 'perform' },
      surfaces: ['global-launcher'],
      pinnable: false,
      staticPriority: 120,
      execute: async () => {
        await requestOpenEditorWindow()
        return { ok: true }
      },
    },
  ]
}
