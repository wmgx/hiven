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

export function upsertSurfaceInstance(input: Omit<SurfaceInstance, 'lastActiveAt'> & { lastActiveAt?: number }): void {
  const previous = surfaces.get(input.id)
  surfaces.set(input.id, {
    ...previous,
    ...input,
    lastActiveAt: input.lastActiveAt ?? Date.now(),
  })
  emit()
}

export function markSurfaceInstanceState(id: string, state: SurfaceInstanceState): void {
  const previous = surfaces.get(id)
  if (!previous) return
  surfaces.set(id, { ...previous, state, lastActiveAt: Date.now() })
  emit()
}

export function removeSurfaceInstance(id: string): void {
  surfaces.delete(id)
  emit()
}

export function getSurfaceInstances(): SurfaceInstance[] {
  return Array.from(surfaces.values()).sort((a, b) => b.lastActiveAt - a.lastActiveAt)
}

export function getSurfaceInstance(id: string): SurfaceInstance | undefined {
  return surfaces.get(id)
}

export function useSurfaceRegistrySnapshot(): SurfaceRegistrySnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

function getSnapshot(): SurfaceRegistrySnapshot {
  return { surfaces: getSurfaceInstances() }
}

function emit(): void {
  for (const listener of listeners) listener()
}
