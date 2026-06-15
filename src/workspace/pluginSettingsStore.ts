/**
 * hiven Plugin System - Plugin Settings Store
 * Zustand store for plugin settings persistence.
 * Settings are isolated by source + pluginId.
 */

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { migrateLocalStorageKey } from '../utils/persistMigration'

migrateLocalStorageKey('fluxtext-plugin-settings', 'hiven-plugin-settings')

// ─── Types ───────────────────────────────────────────────────────────────────

export type PluginSettingsSource = 'builtin' | 'installed' | 'dev'

export type PluginSettingsRecord = {
  version: number
  value: unknown
}

export type PluginSettingsStore = {
  builtin: Record<string, PluginSettingsRecord>
  installed: Record<string, PluginSettingsRecord>
  dev: Record<string, PluginSettingsRecord>
}

export type PluginSettingsDialogTarget = {
  pluginId: string
  source: PluginSettingsSource
  presentation?: 'dialog' | 'global-launcher'
  context?: {
    surfaceId?: 'command-palette' | 'global-launcher'
  }
} | null

// ─── Store Interface ─────────────────────────────────────────────────────────

interface PluginSettingsStoreState {
  /** Settings data isolated by source */
  pluginSettings: PluginSettingsStore

  /** Currently open settings dialog target */
  settingsDialogTarget: PluginSettingsDialogTarget

  // ─── Actions ───────────────────────────────────────────────────────────────

  /** Get resolved settings for a plugin (with migration and default fallback) */
  getPluginSettings: (source: PluginSettingsSource, pluginId: string) => PluginSettingsRecord | undefined

  /** Set plugin settings value (write-through, immediate persist) */
  setPluginSettings: (source: PluginSettingsSource, pluginId: string, value: unknown, version: number) => void

  /** Remove plugin settings */
  removePluginSettings: (source: PluginSettingsSource, pluginId: string) => void

  /** Open settings dialog */
  openSettingsDialog: (target: NonNullable<PluginSettingsDialogTarget>) => void

  /** Close settings dialog */
  closeSettingsDialog: () => void
}

// ─── Store Implementation ────────────────────────────────────────────────────

export const usePluginSettingsStore = create<PluginSettingsStoreState>()(
  persist(
    (set, get) => ({
      pluginSettings: {
        builtin: {},
        installed: {},
        dev: {},
      },

      settingsDialogTarget: null,

      getPluginSettings: (source, pluginId) => {
        return get().pluginSettings[source][pluginId] ?? undefined
      },

      setPluginSettings: (source, pluginId, value, version) =>
        set((state) => ({
          pluginSettings: {
            ...state.pluginSettings,
            [source]: {
              ...state.pluginSettings[source],
              [pluginId]: { version, value },
            },
          },
        })),

      removePluginSettings: (source, pluginId) =>
        set((state) => {
          const next = { ...state.pluginSettings[source] }
          delete next[pluginId]
          return {
            pluginSettings: {
              ...state.pluginSettings,
              [source]: next,
            },
          }
        }),

      openSettingsDialog: (target) => set({ settingsDialogTarget: target }),
      closeSettingsDialog: () => set({ settingsDialogTarget: null }),
    }),
    {
      name: 'hiven-plugin-settings',
      partialize: (state) => ({ pluginSettings: state.pluginSettings }),
    }
  )
)

// ─── Settings Resolution ─────────────────────────────────────────────────────

/**
 * Resolve plugin settings with migration and version handling.
 * Returns the resolved value or defaultValue on failure.
 */
export function resolvePluginSettings<TSettings>(
  source: PluginSettingsSource,
  pluginId: string,
  contribution: {
    version?: number
    defaultValue: TSettings
    migrate?: (stored: unknown, fromVersion: number) => TSettings
  }
): { value: TSettings; migrationError?: string } {
  const record = usePluginSettingsStore.getState().getPluginSettings(source, pluginId)
  const currentVersion = contribution.version ?? 1

  // No stored settings — use default
  if (!record) {
    return { value: contribution.defaultValue }
  }

  const storedVersion = record.version ?? 1

  // Same version — use stored value directly
  if (storedVersion === currentVersion) {
    return { value: record.value as TSettings }
  }

  // Downgrade (stored version > current) — fallback to default, keep stored data
  if (storedVersion > currentVersion) {
    return {
      value: contribution.defaultValue,
      migrationError: 'settings_version_higher_than_plugin',
    }
  }

  // Upgrade (stored version < current) — run migrate
  if (contribution.migrate) {
    try {
      const migrated = contribution.migrate(record.value, storedVersion)
      if (migrated == null) {
        return {
          value: contribution.defaultValue,
          migrationError: 'migration_returned_null',
        }
      }
      // Persist migrated value
      usePluginSettingsStore.getState().setPluginSettings(source, pluginId, migrated, currentVersion)
      return { value: migrated }
    } catch (error) {
      return {
        value: contribution.defaultValue,
        migrationError: error instanceof Error ? error.message : String(error),
      }
    }
  }

  // No migrate function — use stored value as-is (best effort)
  return { value: record.value as TSettings }
}
