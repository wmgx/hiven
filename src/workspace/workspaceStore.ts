/**
 * FluxText Workspace Extension - Workspace Store
 * Zustand slice for workspace state. Only serializable state lives here.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  PaneId,
  EditorPane,
  WorkspaceLayout,
  SerializedSelection,
  PresentationSession,
  PanelInstance,
  SurfaceOccupancy,
  PaneRenderStackItem,
} from './types'
import type { PaneSelectionRequest } from './paneSelection'

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PANE_ID = 'pane-main'

function generatePaneId(): PaneId {
  return `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/** Rename all panes sequentially: 1, 2, 3, 4... based on paneOrder */
function renamePanesSequentially(panes: Record<PaneId, EditorPane>, paneOrder: PaneId[]): Record<PaneId, EditorPane> {
  const updated = { ...panes }
  for (let i = 0; i < paneOrder.length; i++) {
    const id = paneOrder[i]
    if (updated[id]) {
      updated[id] = { ...updated[id], title: `${i + 1}` }
    }
  }
  return updated
}

// ─── Store Shape ────────────────────────────────────────────────────────────

interface WorkspaceSlice {
  // Pane state
  panes: Record<PaneId, EditorPane>
  paneOrder: PaneId[]
  activePaneId: PaneId
  previousActivePaneId?: PaneId
  layout: WorkspaceLayout
  selections: Record<PaneId, SerializedSelection | null>
  viewStates: Record<PaneId, unknown>

  // Presentation / Panel / Surface (M3+, initialized empty)
  presentations: Record<string, PresentationSession>
  panels: Record<string, PanelInstance>
  occupancies: Record<string, SurfaceOccupancy>
  renderStacks: Record<PaneId, PaneRenderStackItem[]>

  // Pane selection
  paneSelectionRequest: PaneSelectionRequest | null
  setPaneSelectionRequest: (req: PaneSelectionRequest | null) => void

  // Actions
  setActivePaneText: (text: string) => void
  setPaneText: (paneId: PaneId, text: string) => void
  setActivePaneId: (paneId: PaneId) => void
  setPaneSelection: (paneId: PaneId, selection: SerializedSelection | null) => void
  createPane: (options?: { text?: string; title?: string; language?: string; focus?: boolean; direction?: 'left' | 'right' | 'top' | 'bottom' }) => PaneId
  closePane: (paneId: PaneId) => boolean
  setLayout: (layout: WorkspaceLayout) => void
  updatePaneTitle: (paneId: PaneId, title: string) => void
  updatePaneLanguage: (paneId: PaneId, language: string) => void

  // Presentation actions
  openPresentation: (session: PresentationSession) => void
  closePresentation: (sessionId: string) => void
  updatePresentationOptions: (sessionId: string, options: Record<string, unknown>) => void

  // Panel actions
  openPanel: (instance: PanelInstance) => void
  closePanel: (instanceId: string) => void
  updatePanel: (instanceId: string, props: Record<string, unknown>) => void

  // Compat: legacy editorText getter
  getActivePaneText: () => string
}

// ─── Store ──────────────────────────────────────────────────────────────────

export const useWorkspaceStore = create<WorkspaceSlice>()(persist(
  (set, get) => ({
    // Default state: single pane
    panes: {
      [DEFAULT_PANE_ID]: {
        id: DEFAULT_PANE_ID,
        title: '1',
        text: '',
        language: 'plaintext',
      },
    },
    paneOrder: [DEFAULT_PANE_ID],
    activePaneId: DEFAULT_PANE_ID,
    previousActivePaneId: undefined,
    layout: { type: 'single', panes: [DEFAULT_PANE_ID] },
    selections: {},
    viewStates: {},

    presentations: {},
    panels: {},
    occupancies: {},
    renderStacks: {},

    paneSelectionRequest: null,
    setPaneSelectionRequest: (req) => set({ paneSelectionRequest: req }),

    setActivePaneText: (text) => {
      const { activePaneId, panes } = get()
      const pane = panes[activePaneId]
      if (!pane) return
      set({
        panes: { ...panes, [activePaneId]: { ...pane, text } },
      })
    },

    setPaneText: (paneId, text) => {
      const { panes } = get()
      const pane = panes[paneId]
      if (!pane) return
      set({
        panes: { ...panes, [paneId]: { ...pane, text } },
      })
    },

    setActivePaneId: (paneId) => {
      const { activePaneId, panes } = get()
      if (!panes[paneId]) return
      set({
        previousActivePaneId: activePaneId,
        activePaneId: paneId,
      })
    },

    setPaneSelection: (paneId, selection) => {
      const { selections } = get()
      set({ selections: { ...selections, [paneId]: selection } })
    },

    createPane: (options) => {
      const id = generatePaneId()
      const { panes, paneOrder, activePaneId } = get()
      const newPane: EditorPane = {
        id,
        title: '', // will be set by renamePanesSequentially
        text: options?.text || '',
        language: options?.language || 'plaintext',
      }
      const newPanes = { ...panes, [id]: newPane }

      // Determine insertion position based on direction
      const direction = options?.direction || 'right'
      let newOrder: PaneId[]
      const currentIdx = paneOrder.indexOf(activePaneId)

      if (direction === 'left' || direction === 'top') {
        // Insert before active pane
        newOrder = [...paneOrder]
        newOrder.splice(currentIdx, 0, id)
      } else {
        // Insert after active pane (right/bottom)
        newOrder = [...paneOrder]
        newOrder.splice(currentIdx + 1, 0, id)
      }

      const splitDirection: 'horizontal' | 'vertical' =
        direction === 'top' || direction === 'bottom' ? 'vertical' : 'horizontal'

      const newLayout: WorkspaceLayout = newOrder.length === 1
        ? { type: 'single', panes: [newOrder[0]] }
        : { type: 'split', direction: splitDirection, panes: newOrder }

      set({
        panes: renamePanesSequentially(newPanes, newOrder),
        paneOrder: newOrder,
        layout: newLayout,
        ...(options?.focus ? { previousActivePaneId: activePaneId, activePaneId: id } : {}),
      })
      return id
    },

    closePane: (paneId) => {
      const { panes, paneOrder, activePaneId, layout } = get()
      if (paneOrder.length <= 1) return false
      if (!panes[paneId]) return false

      const newPanes = { ...panes }
      delete newPanes[paneId]
      const newOrder = paneOrder.filter((id) => id !== paneId)
      const currentDirection = layout.type === 'split' ? layout.direction : 'horizontal'
      const newLayout: WorkspaceLayout = newOrder.length === 1
        ? { type: 'single', panes: [newOrder[0]] }
        : { type: 'split', direction: currentDirection, panes: newOrder }

      let newActivePaneId = activePaneId
      if (activePaneId === paneId) {
        const idx = paneOrder.indexOf(paneId)
        newActivePaneId = newOrder[Math.min(idx, newOrder.length - 1)]
      }

      set({
        panes: renamePanesSequentially(newPanes, newOrder),
        paneOrder: newOrder,
        layout: newLayout,
        activePaneId: newActivePaneId,
      })
      return true
    },

    setLayout: (layout) => set({ layout }),

    updatePaneTitle: (paneId, title) => {
      const { panes } = get()
      const pane = panes[paneId]
      if (!pane) return
      set({ panes: { ...panes, [paneId]: { ...pane, title } } })
    },

    updatePaneLanguage: (paneId, language) => {
      const { panes } = get()
      const pane = panes[paneId]
      if (!pane) return
      set({ panes: { ...panes, [paneId]: { ...pane, language } } })
    },

    getActivePaneText: () => {
      const { activePaneId, panes } = get()
      return panes[activePaneId]?.text || ''
    },

    openPresentation: (session) => {
      const { presentations } = get()
      set({ presentations: { ...presentations, [session.id]: session } })
    },

    closePresentation: (sessionId) => {
      const { presentations } = get()
      const next = { ...presentations }
      delete next[sessionId]
      set({ presentations: next })
    },

    updatePresentationOptions: (sessionId, options) => {
      const { presentations } = get()
      const session = presentations[sessionId]
      if (!session) return
      set({
        presentations: {
          ...presentations,
          [sessionId]: { ...session, options: { ...session.options, ...options } },
        },
      })
    },

    openPanel: (instance) => {
      const { panels } = get()
      set({ panels: { ...panels, [instance.id]: instance } })
    },

    closePanel: (instanceId) => {
      const { panels } = get()
      const next = { ...panels }
      delete next[instanceId]
      set({ panels: next })
    },

    updatePanel: (instanceId, props) => {
      const { panels } = get()
      const panel = panels[instanceId]
      if (!panel) return
      set({ panels: { ...panels, [instanceId]: { ...panel, ...props } } })
    },
  }),
  {
    name: 'fluxtext-workspace',
    partialize: (state) => ({
      panes: Object.fromEntries(
        Object.entries(state.panes).map(([id, pane]) => [
          id,
          { id: pane.id, title: pane.title, text: pane.text, language: pane.language },
        ])
      ),
      paneOrder: state.paneOrder,
      activePaneId: state.activePaneId,
      layout: state.layout,
    }),
    // Migration from legacy editorText
    migrate: (persisted: any, version: number) => {
      if (version === 0 || !persisted) {
        return persisted
      }
      return persisted
    },
    version: 1,
  }
))

/**
 * Migrate legacy editorText from the old store into workspace pane.
 * Call this once at app startup.
 */
export function migrateLegacyEditorText(legacyText: string) {
  const state = useWorkspaceStore.getState()
  const activePaneId = state.activePaneId
  const pane = state.panes[activePaneId]
  // Only migrate if current pane is empty (fresh init)
  if (pane && !pane.text && legacyText) {
    state.setActivePaneText(legacyText)
  }
}
