/**
 * FluxText Plugin System - Plugin Store
 * Zustand store for installed plugin state (persisted) and dev plugin state (session-only).
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InstalledPlugin, DevPlugin, InstalledPluginStatus } from './pluginTypes'

// ─── Store Interface ──────────────────────────────────────────────────────────

interface PluginStoreState {
  /** Installed (production) plugins - persisted */
  plugins: Record<string, InstalledPlugin>

  /** Dev (side-loaded) plugins - session-scoped, NOT persisted */
  devPlugins: Record<string, DevPlugin>

  // ─── Production Plugin Actions ──────────────────────────────────────────────

  installPlugin: (plugin: InstalledPlugin) => void
  updatePluginStatus: (pluginId: string, status: InstalledPluginStatus, error?: string) => void
  updatePluginVersion: (pluginId: string, version: string, entry: string, capabilities: string[]) => void
  updatePluginMetadata: (pluginId: string, patch: Partial<InstalledPlugin>) => void
  uninstallPlugin: (pluginId: string) => void

  // ─── Dev Plugin Actions ─────────────────────────────────────────────────────

  addDevPlugin: (plugin: DevPlugin) => void
  updateDevPluginStatus: (pluginId: string, status: 'active' | 'error', error?: string) => void
  updateDevPluginWatching: (pluginId: string, watching: boolean) => void
  removeDevPlugin: (pluginId: string) => void
  clearAllDevPlugins: () => void
}

// ─── Store Implementation ─────────────────────────────────────────────────────

export const usePluginStore = create<PluginStoreState>()(
  persist(
    (set) => ({
      plugins: {},
      devPlugins: {},

      installPlugin: (plugin) =>
        set((state) => ({
          plugins: { ...state.plugins, [plugin.pluginId]: plugin },
        })),

      updatePluginStatus: (pluginId, status, error) =>
        set((state) => {
          const plugin = state.plugins[pluginId]
          if (!plugin) return state
          return {
            plugins: {
              ...state.plugins,
              [pluginId]: { ...plugin, status, error },
            },
          }
        }),

      updatePluginVersion: (pluginId, version, entry, capabilities) =>
        set((state) => {
          const plugin = state.plugins[pluginId]
          if (!plugin) return state
          return {
            plugins: {
              ...state.plugins,
              [pluginId]: { ...plugin, version, entry, capabilities, updatedAt: Date.now() },
            },
          }
        }),

      updatePluginMetadata: (pluginId, patch) =>
        set((state) => {
          const plugin = state.plugins[pluginId]
          if (!plugin) return state
          return {
            plugins: {
              ...state.plugins,
              [pluginId]: { ...plugin, ...patch, updatedAt: Date.now() },
            },
          }
        }),

      uninstallPlugin: (pluginId) =>
        set((state) => {
          const next = { ...state.plugins }
          delete next[pluginId]
          return { plugins: next }
        }),

      addDevPlugin: (plugin) =>
        set((state) => ({
          devPlugins: { ...state.devPlugins, [plugin.pluginId]: plugin },
        })),

      updateDevPluginStatus: (pluginId, status, error) =>
        set((state) => {
          const plugin = state.devPlugins[pluginId]
          if (!plugin) return state
          return {
            devPlugins: {
              ...state.devPlugins,
              [pluginId]: { ...plugin, status, error },
            },
          }
        }),

      updateDevPluginWatching: (pluginId, watching) =>
        set((state) => {
          const plugin = state.devPlugins[pluginId]
          if (!plugin) return state
          return {
            devPlugins: {
              ...state.devPlugins,
              [pluginId]: { ...plugin, watching },
            },
          }
        }),

      removeDevPlugin: (pluginId) =>
        set((state) => {
          const next = { ...state.devPlugins }
          delete next[pluginId]
          return { devPlugins: next }
        }),

      clearAllDevPlugins: () => set({ devPlugins: {} }),
    }),
    {
      name: 'fluxtext-plugins',
      // Only persist production plugins, not dev plugins
      partialize: (state) => ({ plugins: state.plugins }),
    }
  )
)
