import type { PluginEditorState } from './pluginEditorState'

export const PLUGIN_EDITOR_SURFACE_OPEN_EVENT = 'hiven://plugin-editor-surface-open'

const PLUGIN_EDITOR_SURFACE_PENDING_KEY = 'hiven:plugin-editor-surface-pending-opens'
const listeners = new Set<(pluginEditor: PluginEditorState) => void>()
const pendingPluginEditorOpenRequests: PluginEditorState[] = []

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
  drainPersistedPluginEditorOpenRequests()
  drainPendingPluginEditorOpenRequests()

  let disposed = false
  let unlistenTauri: (() => void) | undefined
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
        }
      })
      .catch(() => undefined)
  }

  return () => {
    disposed = true
    listeners.delete(listener)
    unlistenTauri?.()
  }
}

function dispatchPluginEditorOpen(pluginEditor: PluginEditorState): void {
  if (listeners.size === 0) {
    pendingPluginEditorOpenRequests.push(pluginEditor)
    return
  }
  removePendingPluginEditorOpen(pluginEditor)
  for (const listener of listeners) listener(pluginEditor)
}

function drainPendingPluginEditorOpenRequests(): void {
  const pending = pendingPluginEditorOpenRequests.splice(0)
  for (const pluginEditor of pending) {
    dispatchPluginEditorOpen(pluginEditor)
  }
}

function drainPersistedPluginEditorOpenRequests(): void {
  const pending = readPendingPluginEditorOpens()
  if (pending.length === 0) return
  writePendingPluginEditorOpens([])
  for (const pluginEditor of pending) {
    dispatchPluginEditorOpen(pluginEditor)
  }
}

function persistPendingPluginEditorOpen(pluginEditor: PluginEditorState): void {
  const pending = readPendingPluginEditorOpens()
  const key = pluginEditorOpenKey(pluginEditor)
  writePendingPluginEditorOpens([
    ...pending.filter((item) => pluginEditorOpenKey(item) !== key),
    pluginEditor,
  ])
}

function removePendingPluginEditorOpen(pluginEditor: PluginEditorState): void {
  const pending = readPendingPluginEditorOpens()
  if (pending.length === 0) return
  const key = pluginEditorOpenKey(pluginEditor)
  writePendingPluginEditorOpens(pending.filter((item) => pluginEditorOpenKey(item) !== key))
}

function readPendingPluginEditorOpens(): PluginEditorState[] {
  try {
    const raw = window.localStorage.getItem(PLUGIN_EDITOR_SURFACE_PENDING_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(isPluginEditorState)
  } catch {
    return []
  }
}

function writePendingPluginEditorOpens(pending: PluginEditorState[]): void {
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
