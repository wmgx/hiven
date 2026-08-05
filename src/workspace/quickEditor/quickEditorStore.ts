import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  QuickEditorExternalVersion,
  QuickEditorPaneId,
  QuickEditorPaneState,
  QuickEditorStore,
  QuickEditorState,
} from './quickEditorTypes'

const DEFAULT_PANE_ID: QuickEditorPaneId = 'quick-pane-1'
/** Cap external-overwrite history; oldest entries drop off. */
export const QUICK_EDITOR_EXTERNAL_VERSION_LIMIT = 20
const VERSION_PREVIEW_CHARS = 80

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

function previewFromText(text: string): string {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? ''
  const compact = firstLine.replace(/\s+/g, ' ').trim()
  if (!compact) return text.length > 0 ? `(${text.length} chars)` : ''
  return compact.length > VERSION_PREVIEW_CHARS
    ? `${compact.slice(0, VERSION_PREVIEW_CHARS)}…`
    : compact
}

function toExternalVersion(
  pane: QuickEditorPaneState,
  source?: string,
): QuickEditorExternalVersion {
  return {
    id: `qe-ver-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    paneId: pane.id,
    text: pane.text,
    language: pane.language,
    languageSource: pane.languageSource,
    at: Date.now(),
    source,
    preview: previewFromText(pane.text),
  }
}

function pushExternalVersion(
  history: QuickEditorExternalVersion[],
  entry: QuickEditorExternalVersion,
): QuickEditorExternalVersion[] {
  // Skip empty content and exact duplicate of the newest entry.
  if (!entry.text) return history
  if (history[0]?.text === entry.text && history[0]?.paneId === entry.paneId) return history
  return [entry, ...history].slice(0, QUICK_EDITOR_EXTERNAL_VERSION_LIMIT)
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
  externalVersionHistory: [],
}

export const useQuickEditorStore = create<QuickEditorStore>()(
  persist(
    (set, get) => ({
      ...INITIAL_STATE,

      setText: (text) => set((state) => withActivePane(state, { text })),
      setPaneText: (paneId, text) => {
        const pane = get().panes[paneId]
        if (!pane) return false
        const isActive = get().activePaneId === paneId
        set((state) => ({
          panes: { ...state.panes, [paneId]: { ...pane, text } },
          ...(isActive ? { text } : {}),
        }))
        return true
      },
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
        const { activePaneId, closePane } = get()
        return closePane(activePaneId)
      },
      focusNextPane: () => {
        const { paneOrder, activePaneId, setActivePaneId } = get()
        if (paneOrder.length <= 1) return
        const currentIndex = paneOrder.indexOf(activePaneId)
        const nextIndex = (currentIndex + 1) % paneOrder.length
        setActivePaneId(paneOrder[nextIndex])
      },
      focusPreviousPane: () => {
        const { paneOrder, activePaneId, setActivePaneId } = get()
        if (paneOrder.length <= 1) return
        const currentIndex = paneOrder.indexOf(activePaneId)
        const prevIndex = (currentIndex - 1 + paneOrder.length) % paneOrder.length
        setActivePaneId(paneOrder[prevIndex])
      },
      overwriteActiveText: (text, options = {}) => {
        const state = get()
        const current = activePaneSnapshot(state)
        const language = options.language ?? current.language
        const languageSource = options.language ? 'manual' as const : current.languageSource
        // Archive only the pre-overwrite content. User typing never calls this path.
        const history = pushExternalVersion(
          state.externalVersionHistory,
          toExternalVersion(current, options.source),
        )
        set({
          ...withActivePane(state, {
            text,
            language,
            languageSource,
            cursorPosition: { lineNumber: 1, column: 1 },
          }),
          externalVersionHistory: history,
        })
        return current.id
      },
      restoreExternalVersion: (versionId) => {
        const state = get()
        const version = state.externalVersionHistory.find((entry) => entry.id === versionId)
        if (!version) return false
        const targetPane = state.panes[version.paneId] ?? activePaneSnapshot(state)
        const restoredPane: QuickEditorPaneState = {
          ...targetPane,
          id: version.paneId,
          text: version.text,
          language: version.language,
          languageSource: version.languageSource,
          cursorPosition: { lineNumber: 1, column: 1 },
        }
        const panes = { ...state.panes, [restoredPane.id]: restoredPane }
        const paneOrder = state.paneOrder.includes(restoredPane.id)
          ? state.paneOrder
          : [...state.paneOrder, restoredPane.id]
        // Restore does not append history — only external overwrite does.
        set({
          panes,
          paneOrder,
          activePaneId: restoredPane.id,
          text: restoredPane.text,
          language: restoredPane.language,
          languageSource: restoredPane.languageSource,
          cursorPosition: restoredPane.cursorPosition,
          scrollPosition: restoredPane.scrollPosition,
        })
        return true
      },
      clearExternalVersionHistory: () => set({ externalVersionHistory: [] }),
      applyOverwriteFromRemote: (input) => {
        const state = get()
        const pane = state.panes[input.paneId] ?? activePaneSnapshot(state)
        const nextPane: QuickEditorPaneState = {
          ...pane,
          id: input.paneId,
          text: input.text,
          language: input.language ?? pane.language,
          languageSource: input.languageSource ?? (input.language ? 'manual' : pane.languageSource),
          cursorPosition: { lineNumber: 1, column: 1 },
        }
        const panes = { ...state.panes, [nextPane.id]: nextPane }
        const paneOrder = state.paneOrder.includes(nextPane.id)
          ? state.paneOrder
          : [...state.paneOrder, nextPane.id]
        set({
          panes,
          paneOrder,
          activePaneId: nextPane.id,
          text: nextPane.text,
          language: nextPane.language,
          languageSource: nextPane.languageSource,
          cursorPosition: nextPane.cursorPosition,
          scrollPosition: nextPane.scrollPosition,
          externalVersionHistory: input.externalVersionHistory === undefined
            ? state.externalVersionHistory
            : input.externalVersionHistory,
        })
        return true
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
        externalVersionHistory: state.externalVersionHistory,
      }),
      merge: (persisted, current) => {
        const source = persisted as Partial<QuickEditorState> & {
          /** Legacy single-slot snapshot from older builds. */
          overwriteSnapshot?: {
            paneId?: string
            text?: string
            language?: string
            languageSource?: 'manual' | 'auto'
            at?: number
            source?: string
          } | null
        } | undefined
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

        let externalVersionHistory = Array.isArray(source.externalVersionHistory)
          ? source.externalVersionHistory
          : []
        // Migrate legacy single overwriteSnapshot into the history list once.
        if (externalVersionHistory.length === 0 && source.overwriteSnapshot?.text) {
          const legacy = source.overwriteSnapshot
          externalVersionHistory = [{
            id: `qe-ver-legacy-${legacy.at ?? Date.now()}`,
            paneId: typeof legacy.paneId === 'string' ? legacy.paneId : activePaneId,
            text: legacy.text,
            language: legacy.language ?? 'plaintext',
            languageSource: legacy.languageSource ?? 'auto',
            at: typeof legacy.at === 'number' ? legacy.at : Date.now(),
            source: legacy.source,
            preview: previewFromText(legacy.text),
          }]
        }

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
          externalVersionHistory,
        }
      },
    }
  )
)
