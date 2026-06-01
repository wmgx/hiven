import { useWorkspaceStore } from '../workspace/workspaceStore'
import { useAppStore } from '../store'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import type { ActionContext, ActionDef } from '../store'

export const splitRightAction: ActionDef = {
  name: 'split',
  title: 'Split',
  titleI18n: { zh: '分栏' },
  icon: 'columns',
  tags: ['workspace', 'layout', 'split'],
  builtin: true,
  params: [
    { key: 'direction', label: 'Direction', labelI18n: { zh: '方向' }, type: 'single-select', options: ['right', 'left', 'down', 'up'], default: 'right' },
  ],
  run: (ctx: ActionContext) => {
    const ws = useWorkspaceStore.getState()
    const activePane = ws.panes[ws.activePaneId]
    const dirParam = ctx.params?.direction || 'right'
    const direction: 'left' | 'right' | 'top' | 'bottom' =
      dirParam === 'down' ? 'bottom' : dirParam === 'up' ? 'top' : dirParam === 'left' ? 'left' : 'right'
    ws.createPane({
      text: '',
      language: activePane?.language || 'plaintext',
      focus: true,
      direction,
    })
  },
}

export const closePaneAction: ActionDef = {
  name: 'close-pane',
  title: 'Close Pane',
  titleI18n: { zh: '关闭当前面板' },
  icon: 'x',
  tags: ['workspace', 'layout'],
  builtin: true,
  run: () => {
    const ws = useWorkspaceStore.getState()
    ws.closeActiveSurfaceOrPane()
    const newActivePaneId = useWorkspaceStore.getState().activePaneId
    const editor = runtimeRegistry.getCodeEditor(newActivePaneId)
    if (editor) {
      useAppStore.getState().setEditorInstance(editor)
    }
  },
}

export const workspaceActions: ActionDef[] = [
  splitRightAction,
  closePaneAction,
]
