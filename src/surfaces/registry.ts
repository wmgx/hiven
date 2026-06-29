import { useSyncExternalStore } from 'react'

export type SurfaceInstanceKind =
  | 'launcher'
  | 'editor'
  | 'plugin-surface'
  | 'settings'
  | 'plugins'

export type SurfaceInstanceState = 'visible' | 'hidden' | 'destroyed'

export type SurfaceInstance = {
  id: string
  kind: SurfaceInstanceKind
  windowLabel: string
  title: string
  pluginId?: string
  surfaceId?: string
  state: SurfaceInstanceState
  canReceiveText?: boolean
  canProvideText?: boolean
  canAttachToEditor?: boolean
  lastActiveAt: number
}

type SurfaceRegistrySnapshot = {
  surfaces: SurfaceInstance[]
}

const surfaces = new Map<string, SurfaceInstance>()
const listeners = new Set<() => void>()
const SURFACE_REGISTRY_EVENT = 'hiven://surface-registry-sync'
const registrySourceId = `surface-registry-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
let syncListenerStarted = false
let rustSnapshotRequested = false

type SurfaceRegistryMutation =
  | { sourceId: string; type: 'upsert'; surface: SurfaceInstance }
  | { sourceId: string; type: 'mark-state'; id: string; state: SurfaceInstanceState; lastActiveAt: number }
  | { sourceId: string; type: 'remove'; id: string }

const SURFACE_INSTANCE_KINDS = new Set<SurfaceInstanceKind>(['launcher', 'editor', 'plugin-surface', 'settings', 'plugins'])
const SURFACE_INSTANCE_STATES = new Set<SurfaceInstanceState>(['visible', 'hidden', 'destroyed'])

export function upsertSurfaceInstance(input: Omit<SurfaceInstance, 'lastActiveAt'> & { lastActiveAt?: number }): void {
  ensureSurfaceRegistrySync()
  const previous = surfaces.get(input.id)
  const surface = {
    ...previous,
    ...input,
    lastActiveAt: input.lastActiveAt ?? Date.now(),
  }
  surfaces.set(input.id, surface)
  emit()
  persistSurfaceRegistryMutation({ sourceId: registrySourceId, type: 'upsert', surface })
  broadcastSurfaceRegistryMutation({ sourceId: registrySourceId, type: 'upsert', surface })
}

export function markSurfaceInstanceState(id: string, state: SurfaceInstanceState): void {
  ensureSurfaceRegistrySync()
  const previous = surfaces.get(id)
  if (!previous) return
  const lastActiveAt = Date.now()
  surfaces.set(id, { ...previous, state, lastActiveAt })
  emit()
  persistSurfaceRegistryMutation({ sourceId: registrySourceId, type: 'mark-state', id, state, lastActiveAt })
  broadcastSurfaceRegistryMutation({ sourceId: registrySourceId, type: 'mark-state', id, state, lastActiveAt })
}

export function removeSurfaceInstance(id: string): void {
  ensureSurfaceRegistrySync()
  surfaces.delete(id)
  emit()
  persistSurfaceRegistryMutation({ sourceId: registrySourceId, type: 'remove', id })
  broadcastSurfaceRegistryMutation({ sourceId: registrySourceId, type: 'remove', id })
}

export function getSurfaceInstances(): SurfaceInstance[] {
  ensureSurfaceRegistrySync()
  return Array.from(surfaces.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

export function getSurfaceInstance(id: string): SurfaceInstance | undefined {
  ensureSurfaceRegistrySync()
  return surfaces.get(id)
}

export function useSurfaceRegistrySnapshot(): SurfaceRegistrySnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  ensureSurfaceRegistrySync()
  return () => listeners.delete(listener)
}

function getSnapshot(): SurfaceRegistrySnapshot {
  return { surfaces: getSurfaceInstances() }
}

function emit(): void {
  for (const listener of listeners) listener()
}

function ensureSurfaceRegistrySync(): void {
  if (!isTauriRuntime()) return
  hydrateSurfaceRegistryFromRust()
  if (syncListenerStarted) return
  syncListenerStarted = true
  import('@tauri-apps/api/event')
    .then(({ listen }) => listen<unknown>(SURFACE_REGISTRY_EVENT, (event) => {
      if (!isSurfaceRegistryMutation(event.payload)) return
      if (event.payload.sourceId === registrySourceId) return
      applyRemoteSurfaceRegistryMutation(event.payload)
    }))
    .catch(() => {
      syncListenerStarted = false
    })
}

function hydrateSurfaceRegistryFromRust(force = false): void {
  if (rustSnapshotRequested && !force) return
  rustSnapshotRequested = true
  import('@tauri-apps/api/core')
    .then(({ invoke }) => invoke<unknown[]>('surface_registry_snapshot'))
    .then((snapshot) => {
      let changed = false
      for (const candidate of snapshot) {
        if (!isSurfaceInstance(candidate)) continue
        surfaces.set(candidate.id, candidate)
        changed = true
      }
      if (changed) emit()
    })
    .catch(() => {
      rustSnapshotRequested = false
    })
}

function applyRemoteSurfaceRegistryMutation(mutation: SurfaceRegistryMutation): void {
  switch (mutation.type) {
    case 'upsert':
      surfaces.set(mutation.surface.id, mutation.surface)
      break
    case 'mark-state': {
      const previous = surfaces.get(mutation.id)
      if (!previous) {
        hydrateSurfaceRegistryFromRust(true)
        return
      }
      surfaces.set(mutation.id, {
        ...previous,
        state: mutation.state,
        lastActiveAt: mutation.lastActiveAt,
      })
      break
    }
    case 'remove':
      surfaces.delete(mutation.id)
      break
  }
  emit()
}

function persistSurfaceRegistryMutation(mutation: SurfaceRegistryMutation): void {
  if (!isTauriRuntime()) return
  import('@tauri-apps/api/core')
    .then(({ invoke }) => {
      if (mutation.type === 'upsert') {
        return invoke('surface_registry_upsert', { surface: mutation.surface })
      }
      if (mutation.type === 'mark-state') {
        return invoke('surface_registry_mark_state', {
          id: mutation.id,
          state: mutation.state,
          lastActiveAt: mutation.lastActiveAt,
        })
      }
      return invoke('surface_registry_remove', { id: mutation.id })
    })
    .catch(() => undefined)
}

function broadcastSurfaceRegistryMutation(mutation: SurfaceRegistryMutation): void {
  if (!isTauriRuntime()) return
  import('@tauri-apps/api/event')
    .then(({ emit }) => emit(SURFACE_REGISTRY_EVENT, mutation))
    .catch(() => undefined)
}

function isSurfaceRegistryMutation(value: unknown): value is SurfaceRegistryMutation {
  const mutation = value as Partial<SurfaceRegistryMutation> | undefined
  if (!mutation || typeof mutation !== 'object' || typeof mutation.sourceId !== 'string') return false
  if (mutation.type === 'upsert') return isSurfaceInstance(mutation.surface)
  if (mutation.type === 'mark-state') {
    return typeof mutation.id === 'string' &&
      typeof mutation.lastActiveAt === 'number' &&
      isSurfaceInstanceState(mutation.state)
  }
  return mutation.type === 'remove' && typeof mutation.id === 'string'
}

function isSurfaceInstance(value: unknown): value is SurfaceInstance {
  const surface = value as Partial<SurfaceInstance> | undefined
  return Boolean(surface &&
    typeof surface === 'object' &&
    typeof surface.id === 'string' &&
    isSurfaceInstanceKind(surface.kind) &&
    typeof surface.windowLabel === 'string' &&
    typeof surface.title === 'string' &&
    isSurfaceInstanceState(surface.state) &&
    typeof surface.lastActiveAt === 'number')
}

function isSurfaceInstanceKind(value: unknown): value is SurfaceInstanceKind {
  return typeof value === 'string' && SURFACE_INSTANCE_KINDS.has(value as SurfaceInstanceKind)
}

function isSurfaceInstanceState(value: unknown): value is SurfaceInstanceState {
  return typeof value === 'string' && SURFACE_INSTANCE_STATES.has(value as SurfaceInstanceState)
}

function isTauriRuntime(): boolean {
  return Boolean((window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}
