/**
 * hiven Workspace Extension - Workspace Store
 * Zustand slice for workspace state. Only serializable state lives here.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { migrateLocalStorageKey } from '../utils/persistMigration'
import type {
  PaneId,
  EditorPane,
  WorkspaceLayout,
  SerializedSelection,
  PresentationSession,
  PanelInstance,
  SurfaceOccupancy,
  PaneRenderStackItem,
  PaneRendererState,
  PanelInstanceV2,
} from './types'

// ─── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_PANE_ID = 'pane-main'

migrateLocalStorageKey('fluxtext-workspace', 'hiven-workspace')

function generatePaneId(): PaneId {
  return `pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function normalizePane(id: PaneId, value: unknown, index: number): EditorPane {
  const pane = isPlainObject(value) ? value : {}
  const language = typeof pane.language === 'string' ? pane.language : 'plaintext'
  const detectedLanguage = typeof pane.detectedLanguage === 'string' ? pane.detectedLanguage : language
  const languageSource = pane.languageSource === 'manual' || pane.languageSource === 'auto'
    ? pane.languageSource
    : language !== 'plaintext' ? 'manual' : 'auto'

  return {
    id,
    title: typeof pane.title === 'string' ? pane.title : `${index + 1}`,
    text: typeof pane.text === 'string' ? pane.text : '',
    language,
    detectedLanguage,
    languageSource,
    stickyScroll: pane.stickyScroll === true,
  }
}

function normalizePanes(panes: unknown, paneOrder: PaneId[]): Record<PaneId, EditorPane> {
  const source = isPlainObject(panes) ? panes : {}
  const ids = paneOrder.length > 0 ? paneOrder : Object.keys(source)
  const normalized: Record<PaneId, EditorPane> = {}

  for (let i = 0; i < ids.length; i++) {
    const id = ids[i]
    normalized[id] = normalizePane(id, source[id], i)
  }

  if (Object.keys(normalized).length === 0) {
    normalized[DEFAULT_PANE_ID] = normalizePane(DEFAULT_PANE_ID, undefined, 0)
  }

  return normalized
}

function normalizeLayout(layout: unknown, paneOrder: PaneId[]): WorkspaceLayout {
  const paneSet = new Set(paneOrder)

  if (isPlainObject(layout)) {
    if (layout.type === 'grid' && Array.isArray(layout.rows)) {
      const rows = layout.rows
        .filter(Array.isArray)
        .map((row) => row.filter((id): id is PaneId => typeof id === 'string' && paneSet.has(id)))
        .filter((row) => row.length > 0)
      if (rows.length > 0) return { type: 'grid', rows }
    }

    if (
      layout.type === 'split' &&
      (layout.direction === 'horizontal' || layout.direction === 'vertical') &&
      Array.isArray(layout.panes)
    ) {
      const panes = layout.panes.filter((id): id is PaneId => typeof id === 'string' && paneSet.has(id))
      if (panes.length > 1) return { type: 'split', direction: layout.direction, panes }
    }
  }

  return paneOrder.length === 1
    ? { type: 'single', panes: [paneOrder[0]] }
    : { type: 'split', direction: 'horizontal', panes: paneOrder }
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

function rendererReferencesPane(renderer: PaneRendererState, paneId: PaneId): boolean {
  return valueReferencesPane(renderer.rendererInputs, paneId)
}

function findRendererForPane(paneRenderers: Record<PaneId, PaneRendererState>, paneId: PaneId): PaneId | undefined {
  if (paneRenderers[paneId]) return paneId
  return Object.entries(paneRenderers).find(([, renderer]) => rendererReferencesPane(renderer, paneId))?.[0]
}

function valueReferencesPane(value: unknown, paneId: PaneId): boolean {
  if (!value || typeof value !== 'object') return false
  if (
    (value as { kind?: unknown }).kind === 'pane' &&
    (value as { paneId?: unknown }).paneId === paneId
  ) {
    return true
  }
  if (Array.isArray(value)) return value.some((item) => valueReferencesPane(item, paneId))
  return Object.values(value as Record<string, unknown>).some((item) => valueReferencesPane(item, paneId))
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

  // Plugin system: pane renderer state (pane.setRenderer / pane.clearRenderer)
  paneRenderers: Record<PaneId, PaneRendererState>
  // Plugin system: panel instances V2 (single-instance by panelId)
  panelInstancesV2: Record<string, PanelInstanceV2>

  // Actions
  setActivePaneText: (text: string) => void
  setPaneText: (paneId: PaneId, text: string) => void
  setActivePaneId: (paneId: PaneId) => void
  setPaneSelection: (paneId: PaneId, selection: SerializedSelection | null) => void
  createPane: (options?: { text?: string; title?: string; language?: string; stickyScroll?: boolean; focus?: boolean; direction?: 'left' | 'right' | 'top' | 'bottom' }) => PaneId
  closePane: (paneId: PaneId) => boolean
  closeActiveSurfaceOrPane: () => boolean
  setLayout: (layout: WorkspaceLayout) => void
  updatePaneTitle: (paneId: PaneId, title: string) => void
  updatePaneLanguage: (paneId: PaneId, language: string) => void
  updatePaneDetectedLanguage: (paneId: PaneId, language: string) => void
  updatePaneLanguageSource: (paneId: PaneId, source: EditorPane['languageSource']) => void
  updatePaneStickyScroll: (paneId: PaneId, stickyScroll: boolean) => void

  // Presentation actions
  openPresentation: (session: PresentationSession) => void
  closePresentation: (sessionId: string) => void
  updatePresentationOptions: (sessionId: string, options: Record<string, unknown>) => void

  // Panel actions
  openPanel: (instance: PanelInstance) => void
  closePanel: (instanceId: string) => void
  updatePanel: (instanceId: string, props: Record<string, unknown>) => void

  // Panel V2 actions (new single-instance plugin panel model)
  openPanelV2: (instance: PanelInstanceV2) => void
  closePanelV2: (panelId: string) => void
  updatePanelV2Inputs: (panelId: string, inputs: unknown) => void

  // Pane renderer actions (plugin system)
  setPaneRenderer: (paneId: PaneId, state: PaneRendererState) => void
  updatePaneRendererStatus: (paneId: PaneId, label: string | null, level?: 'info' | 'error') => void
  clearPaneRenderer: (paneId: PaneId) => void
  clearPaneRenderersForPlugin: (pluginId: string) => void

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
        detectedLanguage: 'plaintext',
        languageSource: 'auto',
        stickyScroll: false,
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
    paneRenderers: {},
    panelInstancesV2: {},

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
      if (activePaneId === paneId) return
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
        detectedLanguage: options?.language || 'plaintext',
        languageSource: options?.language && options.language !== 'plaintext' ? 'manual' : 'auto',
        stickyScroll: options?.stickyScroll === true,
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
      const { panes, paneOrder, activePaneId, layout, paneRenderers } = get()
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

      const nextPaneRenderers = Object.fromEntries(
        Object.entries(paneRenderers).filter(([rendererPaneId, renderer]) => (
          rendererPaneId !== paneId && !rendererReferencesPane(renderer, paneId)
        ))
      ) as Record<PaneId, PaneRendererState>

      set({
        panes: renamePanesSequentially(newPanes, newOrder),
        paneOrder: newOrder,
        layout: newLayout,
        activePaneId: newActivePaneId,
        paneRenderers: nextPaneRenderers,
      })
      return true
    },

    closeActiveSurfaceOrPane: () => {
      const { activePaneId, paneRenderers, paneOrder } = get()
      const rendererPaneId = findRendererForPane(paneRenderers, activePaneId)
      if (rendererPaneId) {
        get().clearPaneRenderer(rendererPaneId)
        return true
      }
      if (paneOrder.length <= 1) {
        get().setActivePaneText('')
        return true
      }
      return get().closePane(activePaneId)
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

    updatePaneDetectedLanguage: (paneId, language) => {
      const { panes } = get()
      const pane = panes[paneId]
      if (!pane) return
      const languageSource = pane.languageSource ?? (pane.language && pane.language !== 'plaintext' ? 'manual' : 'auto')
      if (
        pane.detectedLanguage === language &&
        (languageSource === 'manual' || (pane.language === language && (pane.languageSource ?? 'auto') === 'auto'))
      ) {
        return
      }
      set({
        panes: {
          ...panes,
          [paneId]: {
            ...pane,
            detectedLanguage: language,
            ...(languageSource === 'manual' ? {} : { language, languageSource: 'auto' as const }),
          },
        },
      })
    },

    updatePaneLanguageSource: (paneId, source) => {
      const { panes } = get()
      const pane = panes[paneId]
      if (!pane) return
      const nextLanguage = source === 'auto' ? (pane.detectedLanguage || 'plaintext') : (pane.language || 'plaintext')
      set({ panes: { ...panes, [paneId]: { ...pane, languageSource: source, language: nextLanguage } } })
    },

    updatePaneStickyScroll: (paneId, stickyScroll) => {
      const { panes } = get()
      const pane = panes[paneId]
      if (!pane || pane.stickyScroll === stickyScroll) return
      set({ panes: { ...panes, [paneId]: { ...pane, stickyScroll } } })
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

    // ─── Panel V2 Actions ────────────────────────────────────────────────────

    openPanelV2: (instance) => {
      const { panelInstancesV2 } = get()
      set({ panelInstancesV2: { ...panelInstancesV2, [instance.panelId]: instance } })
    },

    closePanelV2: (panelId) => {
      const { panelInstancesV2 } = get()
      const next = { ...panelInstancesV2 }
      delete next[panelId]
      set({ panelInstancesV2: next })
    },

    updatePanelV2Inputs: (panelId, inputs) => {
      const { panelInstancesV2 } = get()
      const instance = panelInstancesV2[panelId]
      if (!instance) return
      set({ panelInstancesV2: { ...panelInstancesV2, [panelId]: { ...instance, inputs } } })
    },

    // ─── Pane Renderer Actions ───────────────────────────────────────────────

    setPaneRenderer: (paneId, state) => {
      const { paneRenderers } = get()
      set({ paneRenderers: { ...paneRenderers, [paneId]: state } })
    },

    updatePaneRendererStatus: (paneId, label, level = 'info') => {
      const { paneRenderers } = get()
      const state = paneRenderers[paneId]
      if (!state) return
      const nextLabel = label || undefined
      const nextLevel = nextLabel ? level : undefined
      if (state.statusLabel === nextLabel && state.statusLevel === nextLevel) return
      const nextState = label
        ? { ...state, statusLabel: label, statusLevel: level }
        : (({ statusLabel: _statusLabel, statusLevel: _statusLevel, ...rest }) => rest)(state)
      set({ paneRenderers: { ...paneRenderers, [paneId]: nextState } })
    },

    clearPaneRenderer: (paneId) => {
      const { paneRenderers } = get()
      const next = { ...paneRenderers }
      delete next[paneId]
      set({ paneRenderers: next })
    },

    clearPaneRenderersForPlugin: (pluginId) => {
      const { paneRenderers } = get()
      const next: Record<string, PaneRendererState> = {}
      for (const [paneId, state] of Object.entries(paneRenderers)) {
        if (state.ownerPluginId !== pluginId) {
          next[paneId] = state
        }
      }
      set({ paneRenderers: next })
    },
  }),
  {
    name: 'hiven-workspace',
    partialize: (state) => ({
      panes: Object.fromEntries(
        Object.entries(state.panes).map(([id, pane]) => [
          id,
          {
            id: pane.id,
            title: pane.title,
            text: pane.text ?? '',
            language: pane.language,
            detectedLanguage: pane.detectedLanguage,
            languageSource: pane.languageSource,
            stickyScroll: pane.stickyScroll,
          },
        ])
      ),
      paneOrder: state.paneOrder,
      activePaneId: state.activePaneId,
      layout: state.layout,
    }),
    merge: (persistedState, currentState) => {
      const persisted = isPlainObject(persistedState) ? persistedState : {}
      const rawPaneOrder = Array.isArray(persisted.paneOrder) ? persisted.paneOrder : currentState.paneOrder
      const paneOrder = rawPaneOrder.filter((id): id is PaneId => typeof id === 'string')
      const panes = normalizePanes(persisted.panes, paneOrder)
      const normalizedPaneOrder = paneOrder.filter((id) => panes[id])
      const nextPaneOrder = normalizedPaneOrder.length > 0 ? normalizedPaneOrder : [DEFAULT_PANE_ID]
      const activePaneId = typeof persisted.activePaneId === 'string' && panes[persisted.activePaneId]
        ? persisted.activePaneId
        : nextPaneOrder[0]

      return {
        ...currentState,
        ...persisted,
        panes: renamePanesSequentially(panes, nextPaneOrder),
        paneOrder: nextPaneOrder,
        activePaneId,
        layout: normalizeLayout(persisted.layout, nextPaneOrder),
      } as WorkspaceSlice
    },
    // Migration from legacy editorText
    migrate: (persisted: unknown, version: number) => {
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
