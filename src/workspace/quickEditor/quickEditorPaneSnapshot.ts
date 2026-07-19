import { useQuickEditorStore } from './quickEditorStore'
import type { QuickEditorPaneId, QuickEditorPaneState, QuickEditorState } from './quickEditorTypes'

export type QuickEditorPaneSnapshotPane = {
  title?: string
  language?: string
  text?: string
  origin: 'quick-editor'
}

export type QuickEditorPaneSnapshot = {
  activePaneId: string
  paneIds: string[]
  panes: Record<string, QuickEditorPaneSnapshotPane>
}

const PERSIST_KEY = 'hiven-quick-editor'

/**
 * Build a launcher-facing pane snapshot for Quick Editor.
 * Prefers the live store; falls back to localStorage so global launcher
 * (another webview) can still list recently-edited quick-editor panes.
 */
export function readQuickEditorPaneSnapshot(): QuickEditorPaneSnapshot | null {
  const live = useQuickEditorStore.getState()
  const fromStorage = readPersistedQuickEditorState()
  const state = pickFreshestQuickEditorState(live, fromStorage)
  if (!state) return null
  return toQuickEditorPaneSnapshot(state)
}

function toQuickEditorPaneSnapshot(state: Pick<QuickEditorState, 'panes' | 'paneOrder' | 'activePaneId'>): QuickEditorPaneSnapshot | null {
  const paneIds = (state.paneOrder ?? []).filter((id) => Boolean(state.panes[id]))
  if (paneIds.length === 0) return null

  const panes: Record<string, QuickEditorPaneSnapshotPane> = {}
  paneIds.forEach((paneId, index) => {
    const pane = state.panes[paneId]
    if (!pane) return
    panes[paneId] = {
      title: defaultQuickPaneTitle(pane, index),
      language: pane.language,
      text: pane.text ?? '',
      origin: 'quick-editor',
    }
  })

  const activePaneId = panes[state.activePaneId] ? state.activePaneId : paneIds[0]
  return { activePaneId, paneIds, panes }
}

function defaultQuickPaneTitle(pane: QuickEditorPaneState, index: number): string {
  return `Pane ${index + 1}`
}

function pickFreshestQuickEditorState(
  live: QuickEditorState,
  stored: Pick<QuickEditorState, 'panes' | 'paneOrder' | 'activePaneId'> | null,
): Pick<QuickEditorState, 'panes' | 'paneOrder' | 'activePaneId'> | null {
  const liveHasPanes = Object.keys(live.panes ?? {}).length > 0
  if (!stored) return liveHasPanes ? live : null

  // Prefer stored when it has more total text (cross-window edits) and live is empty-ish.
  const liveTextLen = totalTextLength(live.panes)
  const storedTextLen = totalTextLength(stored.panes)
  if (!liveHasPanes) return stored
  if (storedTextLen > liveTextLen) return stored
  return live
}

function totalTextLength(panes: Record<string, { text?: string }> | undefined): number {
  if (!panes) return 0
  return Object.values(panes).reduce((sum, pane) => sum + (pane?.text?.length ?? 0), 0)
}

function readPersistedQuickEditorState(): Pick<QuickEditorState, 'panes' | 'paneOrder' | 'activePaneId'> | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const raw = localStorage.getItem(PERSIST_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { state?: Partial<QuickEditorState> } | Partial<QuickEditorState>
    const state = 'state' in parsed && parsed.state ? parsed.state : parsed as Partial<QuickEditorState>
    if (!state?.panes || typeof state.panes !== 'object') return null
    const panes = state.panes as Record<QuickEditorPaneId, QuickEditorPaneState>
    const paneOrder = Array.isArray(state.paneOrder)
      ? state.paneOrder.filter((id): id is string => typeof id === 'string' && Boolean(panes[id]))
      : Object.keys(panes)
    if (paneOrder.length === 0) return null
    const activePaneId = typeof state.activePaneId === 'string' && panes[state.activePaneId]
      ? state.activePaneId
      : paneOrder[0]
    return { panes, paneOrder, activePaneId }
  } catch {
    return null
  }
}
