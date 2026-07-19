import type { PluginEditorState } from './pluginEditorState'

export const PLUGIN_EDITOR_SURFACE_OPEN_EVENT = 'hiven://plugin-editor-surface-open'

const PLUGIN_EDITOR_SURFACE_PENDING_KEY = 'hiven:plugin-editor-surface-pending-opens'
const PLUGIN_EDITOR_SURFACE_PENDING_TTL_MS = 30_000
const listeners = new Set<(pluginEditor: PluginEditorState) => void>()
const pendingPluginEditorOpenRequests: PendingPluginEditorOpen[] = []

type PendingPluginEditorOpen = {
  pluginEditor: PluginEditorState
  createdAt: number
}

export function requestOpenPluginEditorSurface(pluginEditor: PluginEditorState): void {
  persistPendingPluginEditorOpen(pluginEditor)
  dispatchPluginEditorOpen(pluginEditor)

  if (!isTauriRuntime()) return
  import('@tauri-apps/api/event')
    .then(({ emit }) => emit(PLUGIN_EDITOR_SURFACE_OPEN_EVENT, pluginEditor))
    .catch(() => undefined)
}

export function subscribePluginEditorSurfaceOpen(listener: (pluginEditor: PluginEditorState) => void): () => void {
  listeners.add(listener)

  let disposed = false
  let unlistenTauri: (() => void) | undefined
  const drainQueuedOpens = () => {
    if (disposed) return
    drainPersistedPluginEditorOpenRequests()
    drainPendingPluginEditorOpenRequests()
  }

  if (isTauriRuntime()) {
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<unknown>(PLUGIN_EDITOR_SURFACE_OPEN_EVENT, (event) => {
        if (isPluginEditorState(event.payload)) dispatchPluginEditorOpen(event.payload)
      }))
      .then((unlisten) => {
        if (disposed) {
          unlisten()
        } else {
          unlistenTauri = unlisten
          drainQueuedOpens()
        }
      })
      .catch(() => {
        drainQueuedOpens()
      })
  } else {
    drainQueuedOpens()
  }

  return () => {
    disposed = true
    listeners.delete(listener)
    unlistenTauri?.()
  }
}

function dispatchPluginEditorOpen(pluginEditor: PluginEditorState): void {
  if (listeners.size === 0) {
    enqueuePendingPluginEditorOpen(pluginEditor)
    return
  }
  removePendingPluginEditorOpen(pluginEditor)
  for (const listener of listeners) listener(pluginEditor)
}

function enqueuePendingPluginEditorOpen(pluginEditor: PluginEditorState): void {
  const key = pluginEditorOpenKey(pluginEditor)
  pendingPluginEditorOpenRequests.splice(
    0,
    pendingPluginEditorOpenRequests.length,
    ...pendingPluginEditorOpenRequests
      .filter((item) => isPendingPluginEditorOpenFresh(item) && pluginEditorOpenKey(item.pluginEditor) !== key),
    { pluginEditor, createdAt: Date.now() },
  )
}

function drainPendingPluginEditorOpenRequests(): void {
  const pending = pendingPluginEditorOpenRequests.splice(0).filter(isPendingPluginEditorOpenFresh)
  for (const item of pending) {
    dispatchPluginEditorOpen(item.pluginEditor)
  }
}

function drainPersistedPluginEditorOpenRequests(): void {
  const pending = readPendingPluginEditorOpens()
  if (pending.length === 0) return
  writePendingPluginEditorOpens([])
  for (const item of pending) {
    dispatchPluginEditorOpen(item.pluginEditor)
  }
}

function persistPendingPluginEditorOpen(pluginEditor: PluginEditorState): void {
  const pending = readPendingPluginEditorOpens()
  const key = pluginEditorOpenKey(pluginEditor)
  writePendingPluginEditorOpens([
    ...pending.filter((item) => pluginEditorOpenKey(item.pluginEditor) !== key),
    { pluginEditor, createdAt: Date.now() },
  ])
}

function removePendingPluginEditorOpen(pluginEditor: PluginEditorState): void {
  const pending = readPendingPluginEditorOpens()
  if (pending.length === 0) return
  const key = pluginEditorOpenKey(pluginEditor)
  writePendingPluginEditorOpens(pending.filter((item) => pluginEditorOpenKey(item.pluginEditor) !== key))
}

function readPendingPluginEditorOpens(): PendingPluginEditorOpen[] {
  try {
    const raw = window.localStorage.getItem(PLUGIN_EDITOR_SURFACE_PENDING_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    const pending = parsed.map(normalizePendingPluginEditorOpen).filter((item): item is PendingPluginEditorOpen => Boolean(item))
    const fresh = pending.filter(isPendingPluginEditorOpenFresh)
    if (fresh.length !== pending.length) writePendingPluginEditorOpens(fresh)
    return fresh
  } catch {
    return []
  }
}

function normalizePendingPluginEditorOpen(value: unknown): PendingPluginEditorOpen | null {
  if (isPluginEditorState(value)) {
    return { pluginEditor: value, createdAt: Date.now() }
  }
  const candidate = value as Partial<PendingPluginEditorOpen> | undefined
  if (!candidate || typeof candidate !== 'object') return null
  if (!isPluginEditorState(candidate.pluginEditor) || typeof candidate.createdAt !== 'number') return null
  return { pluginEditor: candidate.pluginEditor, createdAt: candidate.createdAt }
}

function isPendingPluginEditorOpenFresh(value: PendingPluginEditorOpen): boolean {
  return Number.isFinite(value.createdAt) && Date.now() - value.createdAt <= PLUGIN_EDITOR_SURFACE_PENDING_TTL_MS
}

function writePendingPluginEditorOpens(pending: PendingPluginEditorOpen[]): void {
  try {
    if (pending.length === 0) {
      window.localStorage.removeItem(PLUGIN_EDITOR_SURFACE_PENDING_KEY)
      return
    }
    window.localStorage.setItem(PLUGIN_EDITOR_SURFACE_PENDING_KEY, JSON.stringify(pending))
  } catch {
    // Ignore storage failures; same-webview and Tauri event delivery still apply.
  }
}

function pluginEditorOpenKey(pluginEditor: PluginEditorState): string {
  return [
    pluginEditor.source ?? 'installed',
    pluginEditor.pluginId,
    pluginEditor.folderPath,
    pluginEditor.activeFile ?? '',
  ].join(':')
}

function isPluginEditorState(value: unknown): value is PluginEditorState {
  const candidate = value as Partial<PluginEditorState> | undefined
  return Boolean(candidate &&
    typeof candidate === 'object' &&
    typeof candidate.pluginId === 'string' &&
    typeof candidate.folderPath === 'string' &&
    (candidate.activeFile === undefined || typeof candidate.activeFile === 'string') &&
    (candidate.readOnly === undefined || typeof candidate.readOnly === 'boolean') &&
    (candidate.source === undefined || candidate.source === 'builtin' || candidate.source === 'installed' || candidate.source === 'dev'))
}

function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
