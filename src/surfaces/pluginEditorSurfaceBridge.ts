import type { PluginEditorState } from './pluginEditorState'

export const PLUGIN_EDITOR_SURFACE_OPEN_EVENT = 'hiven://plugin-editor-surface-open'

const listeners = new Set<(pluginEditor: PluginEditorState) => void>()
const pendingPluginEditorOpenRequests: PluginEditorState[] = []

export function requestOpenPluginEditorSurface(pluginEditor: PluginEditorState): void {
  dispatchPluginEditorOpen(pluginEditor)

  if (!isTauriRuntime()) return
  import('@tauri-apps/api/event')
    .then(({ emit }) => emit(PLUGIN_EDITOR_SURFACE_OPEN_EVENT, pluginEditor))
    .catch(() => undefined)
}

export function subscribePluginEditorSurfaceOpen(listener: (pluginEditor: PluginEditorState) => void): () => void {
  listeners.add(listener)
  drainPendingPluginEditorOpenRequests()

  let disposed = false
  let unlistenTauri: (() => void) | undefined
  if (isTauriRuntime()) {
    import('@tauri-apps/api/event')
      .then(({ listen }) => listen<unknown>(PLUGIN_EDITOR_SURFACE_OPEN_EVENT, (event) => {
        if (isPluginEditorState(event.payload)) listener(event.payload)
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
  for (const listener of listeners) listener(pluginEditor)
}

function drainPendingPluginEditorOpenRequests(): void {
  const pending = pendingPluginEditorOpenRequests.splice(0)
  for (const pluginEditor of pending) {
    dispatchPluginEditorOpen(pluginEditor)
  }
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
