import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { PluginSurfaceOpenTarget } from '../store'

export type PluginSurfaceShortcutStatus = 'registered' | 'conflict' | 'failed' | 'disabled' | 'pending'

export type PluginSurfaceShortcut = {
  target: PluginSurfaceOpenTarget
  accelerator: string
  enabled: boolean
  registrationStatus?: PluginSurfaceShortcutStatus
  registrationError?: string
  updatedAt: number
}

type PluginSurfaceShortcutState = {
  shortcuts: Record<string, PluginSurfaceShortcut>
  version: number
  setShortcut: (target: PluginSurfaceOpenTarget, accelerator: string) => void
  clearShortcut: (target: PluginSurfaceOpenTarget) => void
  clearPluginShortcuts: (source: PluginSurfaceOpenTarget['source'], pluginId: string) => void
  setShortcutEnabled: (target: PluginSurfaceOpenTarget, enabled: boolean) => void
  updateRegistration: (key: string, patch: Pick<PluginSurfaceShortcut, 'registrationStatus'> & Partial<Pick<PluginSurfaceShortcut, 'registrationError'>>) => void
}

export function pluginSurfaceShortcutKey(target: PluginSurfaceOpenTarget): string {
  return `${target.source}:${target.pluginId}:${target.surfaceId}`
}

export function parsePluginSurfaceShortcutKey(key: string): PluginSurfaceOpenTarget | null {
  const [source, pluginId, surfaceId, ...rest] = key.split(':')
  if (rest.length > 0 || !pluginId || !surfaceId) return null
  if (source !== 'builtin' && source !== 'installed' && source !== 'dev') return null
  return { source, pluginId, surfaceId }
}

export const usePluginSurfaceShortcutStore = create<PluginSurfaceShortcutState>()(
  persist(
    (set) => ({
      shortcuts: {},
      version: 0,
      setShortcut: (target, accelerator) => set((state) => {
        const key = pluginSurfaceShortcutKey(target)
        return {
          shortcuts: {
            ...state.shortcuts,
            [key]: {
              target,
              accelerator: accelerator.trim(),
              enabled: true,
              registrationStatus: 'pending',
              updatedAt: Date.now(),
            },
          },
          version: state.version + 1,
        }
      }),
      clearShortcut: (target) => set((state) => {
        const key = pluginSurfaceShortcutKey(target)
        const next = { ...state.shortcuts }
        delete next[key]
        return { shortcuts: next, version: state.version + 1 }
      }),
      clearPluginShortcuts: (source, pluginId) => set((state) => {
        const next = { ...state.shortcuts }
        let changed = false
        for (const [key, shortcut] of Object.entries(state.shortcuts)) {
          if (shortcut.target.source !== source || shortcut.target.pluginId !== pluginId) continue
          delete next[key]
          changed = true
        }
        return changed ? { shortcuts: next, version: state.version + 1 } : state
      }),
      setShortcutEnabled: (target, enabled) => set((state) => {
        const key = pluginSurfaceShortcutKey(target)
        const current = state.shortcuts[key]
        if (!current) return state
        return {
          shortcuts: {
            ...state.shortcuts,
            [key]: {
              ...current,
              enabled,
              registrationStatus: enabled ? 'pending' : 'disabled',
              registrationError: undefined,
              updatedAt: Date.now(),
            },
          },
          version: state.version + 1,
        }
      }),
      updateRegistration: (key, patch) => set((state) => {
        const current = state.shortcuts[key]
        if (!current) return state
        return {
          shortcuts: {
            ...state.shortcuts,
            [key]: {
              ...current,
              ...patch,
            },
          },
          version: state.version + 1,
        }
      }),
    }),
    {
      name: 'hiven-plugin-surface-shortcuts',
      partialize: (state) => ({ shortcuts: state.shortcuts }),
    },
  ),
)
