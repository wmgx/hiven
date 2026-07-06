import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { QuickEditorPaneId, QuickEditorPaneState, QuickEditorStore, QuickEditorState } from './quickEditorTypes'

const DEFAULT_PANE_ID: QuickEditorPaneId = 'quick-pane-1'

function createPaneState(input: Partial<QuickEditorPaneState> & { id: QuickEditorPaneId }): QuickEditorPaneState {
  return {
    id: input.id,
    text: input.text ?? '',
    language: input.language ?? 'plaintext',
    languageSource: input.languageSource ?? 'auto',
    cursorPosition: input.cursorPosition ?? { lineNumber: 1, column: 1 },
    scrollPosition: input.scrollPosition ?? { scrollTop: 0, scrollLeft: 0 },
  }
}

function activePaneSnapshot(state: Pick<QuickEditorState, 'panes' | 'activePaneId'>): QuickEditorPaneState {
  return state.panes[state.activePaneId] ?? state.panes[DEFAULT_PANE_ID] ?? createPaneState({ id: DEFAULT_PANE_ID })
}

function withActivePane(
  state: QuickEditorState,
  patch: Partial<Omit<QuickEditorPaneState, 'id'>>,
): Partial<QuickEditorState> {
  const current = activePaneSnapshot(state)
  const pane = { ...current, ...patch }
  return {
    panes: { ...state.panes, [pane.id]: pane },
    text: pane.text,
    language: pane.language,
    languageSource: pane.languageSource,
    cursorPosition: pane.cursorPosition,
    scrollPosition: pane.scrollPosition,
  }
}

const initialPane = createPaneState({ id: DEFAULT_PANE_ID })

const INITIAL_STATE: QuickEditorState = {
  panes: { [DEFAULT_PANE_ID]: initialPane },
  paneOrder: [DEFAULT_PANE_ID],
  activePaneId: DEFAULT_PANE_ID,
  splitDirection: 'horizontal',
  text: initialPane.text,
  language: initialPane.language,
  languageSource: initialPane.languageSource,
  cursorPosition: initialPane.cursorPosition,
  scrollPosition: initialPane.scrollPosition,
}

export const useQuickEditorStore = create<QuickEditorStore>()(
  persist(
    (set) => ({
      ...INITIAL_STATE,

      setText: (text) => set((state) => withActivePane(state, { text })),
      setLanguage: (language) => set((state) => withActivePane(state, { language, languageSource: 'manual' })),
      setDetectedLanguage: (language) => set((state) => withActivePane(state, { language, languageSource: 'auto' })),
      setCursorPosition: (cursorPosition) => set((state) => withActivePane(state, { cursorPosition })),
      setScrollPosition: (scrollPosition) => set((state) => withActivePane(state, { scrollPosition })),
      setActivePaneId: (paneId) => set((state) => {
        const pane = state.panes[paneId]
        if (!pane) return {}
        return {
          activePaneId: paneId,
          text: pane.text,
          language: pane.language,
          languageSource: pane.languageSource,
          cursorPosition: pane.cursorPosition,
          scrollPosition: pane.scrollPosition,
        }
      }),
      createPane: (options = {}) => {
        const id = `quick-pane-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`
        set((state) => {
          const activeIndex = Math.max(0, state.paneOrder.indexOf(state.activePaneId))
          const insertIndex = options.direction === 'bottom' ? activeIndex + 1 : activeIndex + 1
          const pane = createPaneState({
            id,
            text: options.text ?? '',
            language: options.language ?? activePaneSnapshot(state).language,
          })
          const paneOrder = [
            ...state.paneOrder.slice(0, insertIndex),
            id,
            ...state.paneOrder.slice(insertIndex),
          ]
          return {
            panes: { ...state.panes, [id]: pane },
            paneOrder,
            activePaneId: id,
            splitDirection: options.direction === 'bottom' ? 'vertical' : 'horizontal',
            text: pane.text,
            language: pane.language,
            languageSource: pane.languageSource,
            cursorPosition: pane.cursorPosition,
            scrollPosition: pane.scrollPosition,
          }
        })
        return id
      },
      closePane: (paneId) => {
        let didClose = false
        set((state) => {
          if (state.paneOrder.length <= 1 || !state.panes[paneId]) return {}
          const nextPaneOrder = state.paneOrder.filter((id) => id !== paneId)
          const nextPanes = { ...state.panes }
          delete nextPanes[paneId]
          const closedIndex = state.paneOrder.indexOf(paneId)
          const nextActivePaneId = state.activePaneId === paneId
            ? nextPaneOrder[Math.max(0, Math.min(closedIndex, nextPaneOrder.length - 1))]
            : state.activePaneId
          const active = nextPanes[nextActivePaneId] ?? activePaneSnapshot({
            panes: nextPanes,
            activePaneId: nextPaneOrder[0] ?? DEFAULT_PANE_ID,
          })
          didClose = true
          return {
            panes: nextPanes,
            paneOrder: nextPaneOrder,
            activePaneId: active.id,
            splitDirection: nextPaneOrder.length > 1 ? state.splitDirection : 'horizontal',
            text: active.text,
            language: active.language,
            languageSource: active.languageSource,
            cursorPosition: active.cursorPosition,
            scrollPosition: active.scrollPosition,
          }
        })
        return didClose
      },
      closeActivePane: () => {
        const state = useQuickEditorStore.getState()
        return state.closePane(state.activePaneId)
      },
      reset: () => set(INITIAL_STATE),
    }),
    {
      name: 'hiven-quick-editor',
      partialize: (state) => ({
        panes: state.panes,
        paneOrder: state.paneOrder,
        activePaneId: state.activePaneId,
        splitDirection: state.splitDirection,
        text: state.text,
        language: state.language,
        languageSource: state.languageSource,
        cursorPosition: state.cursorPosition,
        scrollPosition: state.scrollPosition,
      }),
      merge: (persisted, current) => {
        const source = persisted as Partial<QuickEditorState> | undefined
        if (!source) return current
        const panes = source.panes && Object.keys(source.panes).length > 0
          ? source.panes
          : {
              [DEFAULT_PANE_ID]: createPaneState({
                id: DEFAULT_PANE_ID,
                text: source.text,
                language: source.language,
                languageSource: source.languageSource,
                cursorPosition: source.cursorPosition,
                scrollPosition: source.scrollPosition,
              }),
            }
        const paneOrder = source.paneOrder?.filter((id) => panes[id]) ?? Object.keys(panes)
        const activePaneId = source.activePaneId && panes[source.activePaneId] ? source.activePaneId : paneOrder[0] ?? DEFAULT_PANE_ID
        const active = panes[activePaneId] ?? createPaneState({ id: DEFAULT_PANE_ID })
        return {
          ...current,
          ...source,
          panes,
          paneOrder: paneOrder.length > 0 ? paneOrder : [activePaneId],
          activePaneId,
          splitDirection: source.splitDirection ?? 'horizontal',
          text: active.text,
          language: active.language,
          languageSource: active.languageSource,
          cursorPosition: active.cursorPosition,
          scrollPosition: active.scrollPosition,
        }
      },
    }
  )
)
