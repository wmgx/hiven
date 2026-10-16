import { create, type StoreApi } from 'zustand'
import { persist } from 'zustand/middleware'
import type {
  QuickEditorExternalVersion,
  QuickEditorPaneId,
  QuickEditorPaneState,
  QuickEditorStore,
  QuickEditorState,
  QuickEditorVersionRestoreRequest,
} from './quickEditorTypes'

const DEFAULT_PANE_ID: QuickEditorPaneId = 'quick-pane-1'
/** Cap external-overwrite history; oldest entries drop off. */
export const QUICK_EDITOR_EXTERNAL_VERSION_LIMIT = 20
const VERSION_PREVIEW_CHARS = 80

function createPaneState(input: Partial<QuickEditorPaneState> & { id: QuickEditorPaneId }): QuickEditorPaneState {
  return {
    id: input.id,
    text: input.text ?? '',
    revision: input.revision ?? 0,
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
  const changed = 'text' in patch || 'language' in patch || 'languageSource' in patch
  const pane = { ...current, ...patch, revision: (current.revision ?? 0) + (changed ? 1 : 0) }
  return {
    ...(changed ? { pendingPaneClose: null } : {}),
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
  if (history[0]?.text === entry.text
    && history[0]?.paneId === entry.paneId
    && history[0]?.language === entry.language
    && history[0]?.languageSource === entry.languageSource) return history
  return [entry, ...history].slice(0, QUICK_EDITOR_EXTERNAL_VERSION_LIMIT)
}

const initialPane = createPaneState({ id: DEFAULT_PANE_ID })

const INITIAL_STATE: QuickEditorState = {
  pendingPaneClose: null,
  pendingVersionRestore: null,
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
  panelInstancesV2: {},
}

type LegacyPersistedQuickEditorState = Partial<QuickEditorState> & {
  /** Legacy single-slot snapshot from older builds. */
  overwriteSnapshot?: {
    paneId?: string
    text?: string
    language?: string
    languageSource?: 'manual' | 'auto'
    at?: number
    source?: string
  } | null
}

function mergePersistedState(
  persisted: unknown,
  current: QuickEditorStore,
): QuickEditorStore {
  const source = persisted as LegacyPersistedQuickEditorState | undefined
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
  const activePaneId = source.activePaneId && panes[source.activePaneId]
    ? source.activePaneId
    : paneOrder[0] ?? DEFAULT_PANE_ID
  const active = panes[activePaneId] ?? createPaneState({ id: DEFAULT_PANE_ID })

  let externalVersionHistory = Array.isArray(source.externalVersionHistory)
    ? source.externalVersionHistory
    : []
  // Migrate the legacy single overwriteSnapshot into the history list. If the
  // old entry had no timestamp, reuse the in-memory migration identity when
  // comparing durable state so the same legacy payload remains stable.
  if (externalVersionHistory.length === 0 && source.overwriteSnapshot?.text) {
    const legacy = source.overwriteSnapshot
    const currentLegacy = current.externalVersionHistory[0]?.id.startsWith('qe-ver-legacy-')
      ? current.externalVersionHistory[0]
      : undefined
    const at = typeof legacy.at === 'number' ? legacy.at : currentLegacy?.at ?? Date.now()
    externalVersionHistory = [{
      id: `qe-ver-legacy-${at}`,
      paneId: typeof legacy.paneId === 'string' ? legacy.paneId : activePaneId,
      text: legacy.text ?? '',
      language: legacy.language ?? 'plaintext',
      languageSource: legacy.languageSource ?? 'auto',
      at,
      source: legacy.source,
      preview: previewFromText(legacy.text ?? ''),
    }]
  }

  return {
    ...current,
    ...source,
    pendingPaneClose: null,
    pendingVersionRestore: null,
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
}

let publishCommittedState: StoreApi<QuickEditorStore>['setState']

// External replacement must not publish B before the snapshot containing A is durable.
// This store uses synchronous localStorage; keep the existing persist key and format.
function commitReplacement(state: QuickEditorStore, patch: Partial<QuickEditorState>) {
  if (!useQuickEditorStore.persist.hasHydrated()) throw new Error('QuickEditorStorageUnavailable')
  const options = useQuickEditorStore.persist.getOptions()
  if (!options.name) throw new Error('QuickEditorStorageUnavailable')
  const next = { ...state, ...patch }
  localStorage.setItem(options.name, JSON.stringify({
    state: options.partialize ? options.partialize(next) : next,
    version: options.version ?? 0,
  }))
  publishCommittedState(patch)
}

function readDurableStateMatch(state: QuickEditorStore): 'match' | 'stale' | 'unavailable' {
  if (!useQuickEditorStore.persist.hasHydrated()) return 'unavailable'
  const options = useQuickEditorStore.persist.getOptions()
  if (!options.name) return 'unavailable'
  try {
    const stored = JSON.parse(localStorage.getItem(options.name) ?? 'null')?.state
    if (!stored) return 'unavailable'
    const normalizedStored = mergePersistedState(stored, state)
    const current = options.partialize ? options.partialize(state) : state
    const durable = options.partialize ? options.partialize(normalizedStored) : normalizedStored
    return JSON.stringify(durable) === JSON.stringify(current) ? 'match' : 'stale'
  } catch {
    return 'unavailable'
  }
}

function sameVersion(
  current: QuickEditorExternalVersion | undefined,
  snapshot: Readonly<QuickEditorExternalVersion>,
): boolean {
  return Boolean(current
    && current.id === snapshot.id
    && current.paneId === snapshot.paneId
    && current.text === snapshot.text
    && current.language === snapshot.language
    && current.languageSource === snapshot.languageSource
    && current.at === snapshot.at
    && current.source === snapshot.source
    && current.preview === snapshot.preview)
}

function samePane(
  current: QuickEditorPaneState | undefined,
  snapshot: Readonly<QuickEditorPaneState> | null,
): boolean {
  if (!snapshot) return current === undefined
  return Boolean(current
    && current.id === snapshot.id
    && (current.revision ?? 0) === (snapshot.revision ?? 0)
    && current.text === snapshot.text
    && current.language === snapshot.language
    && current.languageSource === snapshot.languageSource)
}

function createVersionRestoreRequest(
  state: QuickEditorStore,
  version: QuickEditorExternalVersion,
): QuickEditorVersionRestoreRequest {
  const targetPane = state.panes[version.paneId]
  return {
    version: { ...version },
    targetPane: targetPane ? {
      ...targetPane,
      cursorPosition: { ...targetPane.cursorPosition },
      scrollPosition: { ...targetPane.scrollPosition },
    } : null,
  }
}

/** Delete only after durable state still matches this window's complete pane set. */
function commitPaneClose(state: QuickEditorStore, paneId: QuickEditorPaneId): boolean {
  if (state.paneOrder.length <= 1 || !state.panes[paneId]) return false
  try {
    const stored = JSON.parse(localStorage.getItem('hiven-quick-editor') ?? 'null')?.state
    if (!stored || JSON.stringify(stored.panes) !== JSON.stringify(state.panes)
      || JSON.stringify(stored.paneOrder) !== JSON.stringify(state.paneOrder)) return false
    const panes = { ...state.panes }
    delete panes[paneId]
    const paneOrder = state.paneOrder.filter((id) => id !== paneId)
    const index = state.paneOrder.indexOf(paneId)
    const activePaneId = state.activePaneId === paneId
      ? paneOrder[Math.max(0, Math.min(index, paneOrder.length - 1))] : state.activePaneId
    const active = panes[activePaneId]
    const panelInstancesV2 = Object.fromEntries(Object.entries(state.panelInstancesV2).filter(([, panel]) => (
      panel.scope?.type !== 'pane' || panel.scope.paneId !== paneId
    )))
    commitReplacement(state, {
      pendingPaneClose: null, panes, paneOrder, activePaneId, panelInstancesV2,
      splitDirection: paneOrder.length > 1 ? state.splitDirection : 'horizontal',
      text: active.text, language: active.language, languageSource: active.languageSource,
      cursorPosition: active.cursorPosition, scrollPosition: active.scrollPosition,
    })
    return true
  } catch { return false }
}

const quickEditorInitializer = persist<QuickEditorStore, [], [], Omit<QuickEditorState, 'panelInstancesV2' | 'pendingPaneClose' | 'pendingVersionRestore'>>(
    (set, get) => ({
      ...INITIAL_STATE,

      setText: (text) => set((state) => withActivePane(state, { text })),
      setPaneText: (paneId, text) => {
        const pane = get().panes[paneId]
        if (!pane) return false
        const isActive = get().activePaneId === paneId
        set((state) => ({
          pendingPaneClose: null,
          panes: { ...state.panes, [paneId]: { ...pane, text, revision: (pane.revision ?? 0) + 1 } },
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
          pendingPaneClose: paneId === state.activePaneId ? state.pendingPaneClose : null,
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
            pendingPaneClose: null,
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
        const state = get()
        const pane = state.panes[paneId]
        if (state.paneOrder.length <= 1 || !pane) return false
        if (pane.text.length > 0) {
          // Repeated close shortcuts never replace or implicitly approve an intent.
          if (!state.pendingPaneClose) publishCommittedState({ pendingPaneClose: { paneId, revision: pane.revision ?? 0, text: pane.text } })
          return false
        }
        return commitPaneClose(state, paneId)
      },
      confirmPaneClose: (request) => {
        const state = get()
        const pane = state.panes[request.paneId]
        if (state.pendingPaneClose !== request || !pane
          || (pane.revision ?? 0) !== request.revision || pane.text !== request.text) return false
        return commitPaneClose(state, request.paneId)
      },
      cancelPaneClose: (request) => {
        if (get().pendingPaneClose === request) publishCommittedState({ pendingPaneClose: null })
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
        commitReplacement(state, {
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
      requestExternalVersionRestore: (versionId) => {
        const state = get()
        const version = state.externalVersionHistory.find((entry) => entry.id === versionId)
        if (!version || state.pendingVersionRestore) return null
        const request = createVersionRestoreRequest(state, version)
        // Preview state is runtime-only and must not cause a persistence write.
        publishCommittedState({ pendingVersionRestore: request })
        return request
      },
      confirmExternalVersionRestore: (request) => {
        const state = get()
        const version = state.externalVersionHistory.find((entry) => entry.id === request.version.id)
        const targetPane = state.panes[request.version.paneId]
        if (state.pendingVersionRestore !== request
          || !sameVersion(version, request.version)
          || !samePane(targetPane, request.targetPane)) return 'stale'

        const durableMatch = readDurableStateMatch(state)
        if (durableMatch === 'stale') return 'stale'
        if (durableMatch === 'unavailable') return 'storage-error'

        const history = targetPane
          ? pushExternalVersion(
              state.externalVersionHistory,
              toExternalVersion(targetPane, 'history-restore'),
            )
          : state.externalVersionHistory
        const basePane = targetPane ?? createPaneState({ id: request.version.paneId })
        const restoredPane: QuickEditorPaneState = {
          ...basePane,
          revision: (basePane.revision ?? 0) + 1,
          id: request.version.paneId,
          text: request.version.text,
          language: request.version.language,
          languageSource: request.version.languageSource,
          cursorPosition: { lineNumber: 1, column: 1 },
        }
        const panes = { ...state.panes, [restoredPane.id]: restoredPane }
        const paneOrder = state.paneOrder.includes(restoredPane.id)
          ? state.paneOrder
          : [...state.paneOrder, restoredPane.id]
        try {
          commitReplacement(state, {
            pendingPaneClose: null,
            pendingVersionRestore: null,
            panes,
            paneOrder,
            activePaneId: restoredPane.id,
            text: restoredPane.text,
            language: restoredPane.language,
            languageSource: restoredPane.languageSource,
            cursorPosition: restoredPane.cursorPosition,
            scrollPosition: restoredPane.scrollPosition,
            externalVersionHistory: history,
          })
          return 'restored'
        } catch {
          return 'storage-error'
        }
      },
      cancelExternalVersionRestore: (request) => {
        if (get().pendingVersionRestore === request) publishCommittedState({ pendingVersionRestore: null })
      },
      clearExternalVersionHistory: () => set({ externalVersionHistory: [] }),
      openPanelV2: (instance) => set((state) => ({
        panelInstancesV2: { ...state.panelInstancesV2, [instance.panelId]: instance },
      })),
      closePanelV2: (panelId) => set((state) => {
        const panelInstancesV2 = { ...state.panelInstancesV2 }
        delete panelInstancesV2[panelId]
        return { panelInstancesV2 }
      }),
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
      merge: mergePersistedState,
    }
)

const withCommittedPublisher: typeof quickEditorInitializer = (set, get, api) => {
  publishCommittedState = set
  return quickEditorInitializer(set, get, api)
}
export const useQuickEditorStore = create<QuickEditorStore>()(withCommittedPublisher)
