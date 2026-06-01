import { useWorkspaceStore } from '../workspace/workspaceStore'
import { useAppStore } from '../store'
import { runtimeRegistry } from '../workspace/runtimeRegistry'
import { applyEffects } from '../workspace/effectRunner'
import { showToast } from '../workspace/toast'
import type { ActionDef } from '../store'

function getPaneOptions(): { label: string; value: string }[] {
  const ws = useWorkspaceStore.getState()
  return ws.paneOrder.map((id) => ({
    label: `面板 ${ws.panes[id]?.title || id}`,
    value: id,
  }))
}

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
  run: (ctx: any) => {
    const ws = useWorkspaceStore.getState()
    const activePane = ws.panes[ws.activePaneId]
    const dirParam = ctx.params?.direction || 'right'
    const direction = dirParam === 'down' ? 'bottom' : dirParam === 'up' ? 'top' : dirParam
    ws.createPane({
      text: '',
      language: activePane?.language || 'plaintext',
      focus: true,
      direction: direction as any,
    })
    return undefined as any
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
    if (ws.paneOrder.length <= 1) {
      ws.setActivePaneText('')
      return undefined as any
    }
    ws.closePane(ws.activePaneId)
    const newActivePaneId = useWorkspaceStore.getState().activePaneId
    const editor = runtimeRegistry.getCodeEditor(newActivePaneId)
    if (editor) {
      useAppStore.getState().setEditorInstance(editor)
    }
    return undefined as any
  },
}

export const diffPanesAction: ActionDef = {
  name: 'diff',
  title: 'Toggle Diff',
  titleI18n: { zh: '切换对比' },
  icon: 'git-compare',
  tags: ['workspace', 'presentation', 'diff'],
  builtin: true,
  params: [
    {
      key: 'panes',
      label: 'Select panes to compare',
      labelI18n: { zh: '选择对比面板' },
      type: 'multi-select',
      maxSelect: 2,
      hint: 'Select 2 panes to compare',
      hintI18n: { zh: '选择 2 个面板进行对比' },
      optionsFn: getPaneOptions,
    },
  ],
  run: (ctx: any) => {
    const ws = useWorkspaceStore.getState()

    // If already in any diff mode, exit it (ignore params)
    const activeDiff = Object.entries(ws.presentations).find(
      ([, session]) => session.renderer === 'monaco-diff' || session.renderer === 'json-object-diff'
    )
    if (activeDiff) {
      applyEffects([{ type: 'presentation.close', sessionId: activeDiff[0] }])
      return undefined as any
    }

    const paneOrder = ws.paneOrder

    if (paneOrder.length === 1) {
      // 1 pane: auto-create right pane and enter diff
      const newPaneId = ws.createPane({ text: '', focus: false, direction: 'right' })
      applyEffects([{
        type: 'presentation.open',
        renderer: 'monaco-diff',
        mode: 'split-view',
        targetPaneIds: [paneOrder[0], newPaneId],
        options: { renderSideBySide: true },
      }])
      return undefined as any
    }

    if (paneOrder.length === 2) {
      // 2 panes: directly execute diff (skip param step)
      applyEffects([{
        type: 'presentation.open',
        renderer: 'monaco-diff',
        mode: 'split-view',
        targetPaneIds: [paneOrder[0], paneOrder[1]],
        options: { renderSideBySide: true },
      }])
      return undefined as any
    }

    // 3+ panes: use selected panes from params
    const selectedPanes: string[] = ctx.params?.panes || []
    if (selectedPanes.length < 2) {
      showToast('请选择 2 个面板', 'warning')
      return undefined as any
    }
    applyEffects([{
      type: 'presentation.open',
      renderer: 'monaco-diff',
      mode: 'split-view',
      targetPaneIds: [selectedPanes[0], selectedPanes[1]],
      options: { renderSideBySide: true },
    }])

    return undefined as any
  },
}

export const jsonDiffAction: ActionDef = {
  name: 'json-diff',
  title: 'JSON Diff',
  titleI18n: { zh: 'JSON 对比' },
  icon: 'braces',
  tags: ['workspace', 'presentation', 'diff', 'json'],
  builtin: true,
  params: [
    {
      key: 'panes',
      label: 'Select panes for JSON Diff',
      labelI18n: { zh: '选择 JSON 对比面板' },
      type: 'multi-select',
      maxSelect: 2,
      hint: 'Both panes must contain valid JSON',
      hintI18n: { zh: '两个面板内容需为合法 JSON' },
      optionsFn: getPaneOptions,
    },
  ],
  run: (ctx: any) => {
    const ws = useWorkspaceStore.getState()

    // If already in json diff mode, exit it
    const activeDiff = Object.entries(ws.presentations).find(
      ([, session]) => session.renderer === 'json-object-diff'
    )
    if (activeDiff) {
      applyEffects([{ type: 'presentation.close', sessionId: activeDiff[0] }])
      return undefined as any
    }

    // Also exit text diff if active
    const textDiff = Object.entries(ws.presentations).find(
      ([, session]) => session.renderer === 'monaco-diff'
    )
    if (textDiff) {
      applyEffects([{ type: 'presentation.close', sessionId: textDiff[0] }])
    }

    const paneOrder = ws.paneOrder

    if (paneOrder.length === 1) {
      const newPaneId = ws.createPane({ text: '', focus: false, direction: 'right' })
      applyEffects([{
        type: 'presentation.open',
        renderer: 'json-object-diff',
        mode: 'split-view',
        targetPaneIds: [paneOrder[0], newPaneId],
        options: { renderSideBySide: true },
      }])
      return undefined as any
    }

    if (paneOrder.length === 2) {
      applyEffects([{
        type: 'presentation.open',
        renderer: 'json-object-diff',
        mode: 'split-view',
        targetPaneIds: [paneOrder[0], paneOrder[1]],
        options: { renderSideBySide: true },
      }])
      return undefined as any
    }

    // 3+ panes: use selected panes from params
    const selectedPanes: string[] = ctx.params?.panes || []
    if (selectedPanes.length < 2) {
      showToast('请选择 2 个面板', 'warning')
      return undefined as any
    }
    applyEffects([{
      type: 'presentation.open',
      renderer: 'json-object-diff',
      mode: 'split-view',
      targetPaneIds: [selectedPanes[0], selectedPanes[1]],
      options: { renderSideBySide: true },
    }])

    return undefined as any
  },
}

export const regexTesterAction: ActionDef = {
  name: 'regex-tester',
  title: 'Regex Tester',
  titleI18n: { zh: '正则测试器' },
  icon: 'regex',
  tags: ['panel', 'regex', 'search'],
  builtin: true,
  run: () => {
    applyEffects([{
      type: 'panel.open',
      panelId: 'regex-tester',
      placement: 'bottom',
      title: 'Regex Tester',
      bind: { activePane: true, selection: true },
    }])
    return undefined as any
  },
}

export const workspaceActions: ActionDef[] = [
  splitRightAction,
  closePaneAction,
  diffPanesAction,
  jsonDiffAction,
  regexTesterAction,
]
